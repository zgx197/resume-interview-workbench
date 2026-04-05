import { config } from "../config.js";
import { loadInterviewCatalog, findJob, findRole } from "./catalog-loader.js";
import {
  assessInterviewAnswer,
  buildInterviewPlan,
  generateInterviewQuestion,
  generateInterviewReport
} from "./llm-provider.js";
import { buildInterviewDecision, buildInterviewPolicy } from "./interview-policy.js";
import { loadResumePackage } from "./resume-loader.js";
import { publishSession } from "./session-events.js";
import { createSessionId, listSessions, loadSession, saveSession } from "./session-store.js";
import { listInterviewTemplates, loadInterviewTemplate, markInterviewTemplateUsed } from "./template-service.js";

const RUN_PHASES = ["observe", "deliberate", "decide", "execute", "feedback"];
const inFlightRuns = new Set();
const pendingPlanRefreshes = new Set();

// interview-service 是运行时状态机的唯一入口。
// HTTP 层只调用这里，不直接修改会话状态。
function configuredProviderKey() {
  return config.moonshotApiKey;
}

function compactLines(parts) {
  return parts
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function nowIso() {
  return new Date().toISOString();
}

function diffMs(startedAt, endedAt) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(endedAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

function buildModelStrategyInfo(providerMeta) {
  if (!providerMeta) {
    return null;
  }

  const thinkingEnabled = providerMeta.thinkingType === "enabled";
  return {
    provider: providerMeta.provider || "unknown",
    model: providerMeta.model || "unknown",
    purpose: providerMeta.purpose || "default",
    thinkingType: providerMeta.thinkingType || "disabled",
    toolMode: Boolean(providerMeta.toolMode),
    label: providerMeta.strategyLabel || `${providerMeta.purpose || "default"} / thinking ${thinkingEnabled ? "enabled" : "disabled"}`
  };
}

// coverage 负责记录“类别维度的覆盖进度”，
// 它和 thread 的叙事线是两套不同但互补的视角。
function buildCoverage(plan) {
  const coverage = {};
  for (const stage of plan.stages || []) {
    coverage[stage.category] = {
      planned: (coverage[stage.category]?.planned || 0) + 1,
      asked: 0,
      averageScore: null
    };
  }
  return coverage;
}

function buildTemplateDrivenRole(baseRole, template) {
  if (!template) {
    return baseRole;
  }

  return {
    ...baseRole,
    name: template.interviewerRoleName || baseRole.name,
    summary: compactLines([
      baseRole.summary,
      `Current interviewer title: ${template.interviewerRoleName || baseRole.name}`
    ])
  };
}

function buildTemplateDrivenJob(baseJob, template) {
  if (!template) {
    return baseJob;
  }

  return {
    ...baseJob,
    title: `${template.companyName} · ${template.jobDirection}`,
    description: compactLines([
      template.companyIntro && `Company context: ${template.companyIntro}`,
      `Job direction: ${template.jobDirection}`,
      `Job description: ${template.jobDescription}`
    ])
  };
}

function buildTemplateNotes(template, freeformNotes = "") {
  return compactLines([
    template?.companyIntro && `Company intro:\n${template.companyIntro}`,
    template?.jobDescription && `Job brief:\n${template.jobDescription}`,
    template?.additionalContext && `Additional requirements:\n${template.additionalContext}`,
    freeformNotes && `Temporary notes:\n${freeformNotes}`
  ]);
}

// draft plan 的目标只有一个：先把首题跑起来。
// 更完整的正式计划可以在后台异步补齐，不阻塞会话激活。
function buildDraftPlan(job, role, normalizedResume) {
  const recentExperienceTopics = normalizedResume.experiences.slice(0, 2).map((experience) => ({
    label: `${experience.company} / ${experience.role}`,
    evidence: [experience.summary, ...(experience.bullets || []).slice(0, 2)],
    sourceRefs: [{ sourceType: "experience", sourceId: experience.id }]
  }));
  const topicsByCategory = Object.groupBy(normalizedResume.topicInventory || [], (topic) => topic.category);

  const stages = [
    {
      id: "project-warmup",
      category: "game_framework",
      title: "项目切入",
      goal: `先由 ${role.name} 建立候选人与岗位的主线映射。`,
      promptHint: "等待正式计划生成。",
      targetTopics: recentExperienceTopics
    },
    ...(job.questionAreas || []).map((area) => ({
      id: `area-${area}`,
      category: area,
      title: area,
      goal: `覆盖 ${area} 相关能力。`,
      promptHint: "等待正式计划生成。",
      targetTopics: (topicsByCategory[area] || []).slice(0, 3).map((topic) => ({
        label: topic.label,
        evidence: topic.evidence.slice(0, 2),
        sourceRefs: topic.sourceRefs
      }))
    }))
  ];

  return {
    strategy: "draft_plan",
    summary: "正在生成正式面试计划。",
    targetTurnCount: Math.max(6, stages.length),
    stages
  };
}

function getCurrentStage(session) {
  return session.plan?.stages?.[session.stageIndex] || session.plan?.stages?.at(-1) || null;
}

function recomputeCoverage(session) {
  const next = buildCoverage(session.plan || { stages: [] });
  for (const turn of session.turns) {
    const bucket = next[turn.question.topicCategory] || (next[turn.question.topicCategory] = { planned: 0, asked: 0, averageScore: null });
    bucket.asked += 1;
  }

  for (const [category, bucket] of Object.entries(next)) {
    const scores = session.turns
      .filter((turn) => turn.question.topicCategory === category && turn.assessment)
      .map((turn) => turn.assessment.score);
    if (scores.length) {
      bucket.averageScore = Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2));
    }
  }

  return next;
}

// currentRun 会按 phase 记录时间线，
// 这样前端可以在一轮处理中实时看到热路径状态。
function initializePhaseStatus(currentPhase, startedAt = nowIso()) {
  return RUN_PHASES.map((phase) => ({
    name: phase,
    status: phase === currentPhase ? "running" : "pending",
    summary: "",
    startedAt: phase === currentPhase ? startedAt : null,
    endedAt: null,
    durationMs: phase === currentPhase ? 0 : null,
    strategy: null,
    strategyLabel: "",
    strategyLabels: []
  }));
}

function createRun(kind, payload = {}) {
  const startedAt = nowIso();
  return {
    id: `${kind}_${Date.now()}`,
    kind,
    status: "running",
    phase: "observe",
    phaseStatus: initializePhaseStatus("observe", startedAt),
    requestedAt: startedAt,
    startedAt,
    completedAt: null,
    durationMs: 0,
    payload,
    debug: {
      observe: null,
      deliberation: null,
      decision: null,
      execution: null,
      feedback: null
    },
    error: null
  };
}

function refreshRunProgress(run, snapshotAt = nowIso()) {
  if (!run) {
    return;
  }

  run.phaseStatus = (run.phaseStatus || []).map((item) => {
    if (item.status !== "running" || !item.startedAt) {
      return item;
    }

    return {
      ...item,
      durationMs: diffMs(item.startedAt, snapshotAt) ?? item.durationMs ?? 0
    };
  });

  run.durationMs = diffMs(run.startedAt, run.completedAt || snapshotAt) ?? run.durationMs ?? 0;
}

function closePhase(item, status, endedAt, summary = item.summary) {
  return {
    ...item,
    status,
    summary,
    endedAt,
    durationMs: diffMs(item.startedAt, endedAt) ?? item.durationMs ?? 0
  };
}

function setRunPhase(run, phase, summary = "") {
  const transitionedAt = nowIso();
  const previousPhase = run.phase;
  run.phase = phase;
  run.phaseStatus = (run.phaseStatus || initializePhaseStatus(phase, transitionedAt)).map((item) => {
    if (item.name === previousPhase && item.status === "running" && previousPhase !== phase) {
      return closePhase(item, "completed", transitionedAt);
    }

    if (item.name === phase) {
      if (item.status === "running") {
        return {
          ...item,
          summary,
          durationMs: diffMs(item.startedAt, transitionedAt) ?? item.durationMs ?? 0
        };
      }

      return {
        ...item,
        status: "running",
        summary,
        startedAt: item.startedAt || transitionedAt,
        endedAt: null,
        durationMs: diffMs(item.startedAt || transitionedAt, transitionedAt) ?? 0
      };
    }

    return item;
  });
  refreshRunProgress(run, transitionedAt);
}

function recordRunStrategy(run, phase, providerMeta) {
  const strategy = buildModelStrategyInfo(providerMeta);
  if (!strategy) {
    return;
  }

  run.phaseStatus = (run.phaseStatus || []).map((item) => {
    if (item.name !== phase) {
      return item;
    }

    const strategyLabels = Array.from(new Set([...(item.strategyLabels || []), strategy.label]));
    return {
      ...item,
      strategy,
      strategyLabel: strategyLabels.join(" | "),
      strategyLabels
    };
  });
}

function completeRun(run) {
  const completedAt = nowIso();
  run.status = "completed";
  run.completedAt = completedAt;
  run.phase = "idle";
  run.phaseStatus = (run.phaseStatus || []).map((item) => (
    item.status === "running" ? closePhase(item, "completed", completedAt) : item
  ));
  refreshRunProgress(run, completedAt);
}

function failRun(run, error) {
  const completedAt = nowIso();
  run.status = "failed";
  run.completedAt = completedAt;
  run.error = error.message;
  run.phaseStatus = (run.phaseStatus || []).map((item) => (
    item.status === "running" ? closePhase(item, "failed", completedAt, error.message) : item
  ));
  refreshRunProgress(run, completedAt);
}

function buildPublicSession(session) {
  refreshRunProgress(session.currentRun);
  return {
    id: session.id,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    role: session.role,
    job: session.job,
    interviewTemplate: session.interviewTemplate || null,
    notes: session.notes || "",
    enableWebSearch: Boolean(session.enableWebSearch),
    plan: session.plan,
    stageIndex: session.stageIndex,
    coverage: session.coverage,
    turns: session.turns,
    nextQuestion: session.nextQuestion,
    report: session.report || null,
    provider: session.provider,
    currentRun: session.currentRun || null,
    topicThreads: session.topicThreads || [],
    currentThreadId: session.currentThreadId || null
  };
}

// thread 表示“当前正在深挖的一条证据线”，
// 它和 stage 分离存在，才能显式表达追问与切题。
function createThread({ category, label, evidenceSource, stageId }) {
  return {
    id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category,
    label,
    evidenceSource,
    stageId,
    status: "active",
    openedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null,
    questionCount: 0,
    answerCount: 0,
    followupCount: 0,
    searchCount: 0,
    lastDecision: null,
    closureReason: null,
    lastQuestionText: null,
    lastEvidenceSource: evidenceSource || null,
    lastAssessmentScore: null
  };
}

function closeActiveThreads(session, { exceptThreadId = null, reason = null } = {}) {
  const closedAt = nowIso();
  for (const thread of session.topicThreads || []) {
    if (thread.status !== "active" || thread.id === exceptThreadId) {
      continue;
    }

    thread.status = "closed";
    thread.updatedAt = closedAt;
    thread.closedAt ||= closedAt;
    thread.closureReason ||= reason || "thread_switched";
  }
}

function upsertThreadForDecision(session, decision, question) {
  session.topicThreads ||= [];
  let thread = null;

  if (decision.action === "ask_followup" && decision.threadId) {
    thread = session.topicThreads.find((item) => item.id === decision.threadId) || null;
  }

  if (!thread) {
    closeActiveThreads(session, { reason: decision.rationale });
    thread = createThread({
      category: question.topicCategory,
      label: decision.topicLabel || question.topicCategory,
      evidenceSource: question.evidenceSource,
      stageId: question.stageId
    });
    session.topicThreads.push(thread);
  }

  thread.updatedAt = nowIso();
  thread.questionCount += 1;
  thread.lastDecision = decision.action;
  thread.lastQuestionText = question.text;
  thread.lastEvidenceSource = question.evidenceSource;
  if (decision.action === "ask_followup") {
    thread.followupCount += 1;
  }
  if (decision.shouldSearch) {
    thread.searchCount += 1;
  }

  return thread;
}

function finalizeThreadAfterAnswer(session, turn, decision) {
  const thread = session.topicThreads?.find((item) => item.id === turn.threadId);
  if (!thread) {
    return;
  }

  thread.updatedAt = nowIso();
  thread.answerCount += 1;
  thread.lastAssessmentScore = turn.assessment?.score ?? null;
  if (decision.action === "end_interview" || decision.action === "ask_new_question") {
    thread.status = "closed";
    thread.closureReason = decision.rationale;
    thread.closedAt ||= nowIso();
  }
}

function buildObservationForStart(session, normalizedResume) {
  const stage = getCurrentStage(session);
  return {
    summary: `当前为启动阶段，准备生成第一道问题。岗位方向为 ${session.job.title}，候选人估算经验 ${session.policy.estimatedYears} 年。`,
    stage: stage ? {
      id: stage.id,
      title: stage.title,
      goal: stage.goal
    } : null,
    candidateTopTopics: normalizedResume.topicInventory.slice(0, 8).map((topic) => topic.label),
    notes: session.notes || ""
  };
}

function buildObservationForAnswer(session, turn) {
  const stage = getCurrentStage(session);
  const activeThread = session.topicThreads?.find((item) => item.id === turn.threadId) || null;
  return {
    summary: `正在分析第 ${turn.index} 轮回答，并判断当前线程是否继续。`,
    stage: stage ? {
      id: stage.id,
      title: stage.title,
      goal: stage.goal
    } : null,
    activeThread,
    answerPreview: turn.answer.slice(0, 220),
    lastQuestion: turn.question.text
  };
}

// 中间态优先走 snapshot 广播而不是频繁落盘，
// 这样能减少 I/O，同时保证 SSE 视图足够实时。
function publishSessionSnapshot(session) {
  refreshRunProgress(session.currentRun);
  session.updatedAt = nowIso();
  publishSession(session.id, buildPublicSession(session));
}

async function persistSession(session) {
  refreshRunProgress(session.currentRun);
  session.updatedAt = nowIso();
  await saveSession(session);
  publishSession(session.id, buildPublicSession(session));
}

function buildPlanContext(session, normalizedResume) {
  return {
    role: session.role,
    job: session.job,
    notes: session.notes,
    normalizedResume,
    enableWebSearch: false
  };
}

// 正式 plan 刷新放到后台执行，
// 避免首题延迟被“计划质量工作”拖慢。
function schedulePlanRefresh(sessionId, delayMs = 0) {
  if (pendingPlanRefreshes.has(sessionId)) {
    return;
  }

  pendingPlanRefreshes.add(sessionId);
  setTimeout(() => {
    void refreshDraftPlan(sessionId);
  }, delayMs);
}

async function refreshDraftPlan(sessionId) {
  let shouldRetry = false;

  try {
    const session = await loadSession(sessionId);
    if (session.plan?.strategy !== "draft_plan") {
      return;
    }

    if (session.status === "processing") {
      shouldRetry = true;
      return;
    }

    const { normalized } = await loadResumePackage();
    const refinedPlan = await buildInterviewPlan(buildPlanContext(session, normalized));

    const latest = await loadSession(sessionId);
    if (latest.plan?.strategy !== "draft_plan") {
      return;
    }

    if (latest.status === "processing") {
      shouldRetry = true;
      return;
    }

    latest.plan = refinedPlan;
    latest.coverage = recomputeCoverage(latest);
    await persistSession(latest);
  } catch (error) {
    console.error(`failed to refresh interview plan for ${sessionId}: ${error.message}`);
  } finally {
    pendingPlanRefreshes.delete(sessionId);
    if (shouldRetry) {
      schedulePlanRefresh(sessionId, 1500);
    }
  }
}

async function runSessionLifecycle(sessionId, handler) {
  if (inFlightRuns.has(sessionId)) {
    return;
  }

  inFlightRuns.add(sessionId);
  try {
    await handler();
  } finally {
    inFlightRuns.delete(sessionId);
  }
}

// 策略层可以显式指定要切到哪个 stage。
// 如果没指定，则保留旧的顺序推进逻辑作为安全兜底。
function applyDecisionStageTarget(session, decision) {
  if (decision.action !== "ask_new_question") {
    return;
  }

  const stages = session.plan?.stages || [];
  if (!stages.length) {
    return;
  }

  if (Number.isInteger(decision.targetStageIndex) && decision.targetStageIndex >= 0 && decision.targetStageIndex < stages.length) {
    session.stageIndex = decision.targetStageIndex;
    return;
  }

  if (session.stageIndex < stages.length - 1) {
    session.stageIndex += 1;
  }
}

// 启动链路现在优先优化首题速度：
// observe -> 本地策略 -> 出题 -> 后台补正式 plan。
async function processStartRun(sessionId) {
  await runSessionLifecycle(sessionId, async () => {
    const [{ normalized }, session] = await Promise.all([
      loadResumePackage(),
      loadSession(sessionId)
    ]);

    try {
      setRunPhase(session.currentRun, "observe", "收集候选人画像、岗位要求和当前阶段目标。");
      session.currentRun.debug.observe = buildObservationForStart(session, normalized);
      publishSessionSnapshot(session);

      setRunPhase(session.currentRun, "deliberate", "分析第一轮应该从哪个主题切入，以及是否需要搜索。");
      publishSessionSnapshot(session);
      session.currentRun.debug.deliberation = buildInterviewDecision({
        mode: "start",
        session,
        stage: getCurrentStage(session)
      });
      recordRunStrategy(session.currentRun, "deliberate", session.currentRun.debug.deliberation._providerMeta);
      session.currentRun.debug.deliberation.modelStrategy = buildModelStrategyInfo(session.currentRun.debug.deliberation._providerMeta);
      publishSessionSnapshot(session);

      setRunPhase(session.currentRun, "decide", "决定初始动作、线程模式和搜索策略。");
      const decision = {
        action: "ask_new_question",
        shouldSearch: Boolean(session.enableWebSearch && session.currentRun.debug.deliberation.shouldSearch),
        rationale: session.currentRun.debug.deliberation.rationale,
        threadId: null,
        topicLabel: session.currentRun.debug.deliberation.topicLabel,
        targetStageIndex: session.currentRun.debug.deliberation.targetStageIndex
      };
      session.currentRun.debug.decision = decision;
      publishSessionSnapshot(session);

      setRunPhase(session.currentRun, "execute", decision.shouldSearch ? "生成问题前启用联网搜索。" : "直接生成第一道问题。");
      publishSessionSnapshot(session);
      applyDecisionStageTarget(session, decision);
      const question = await generateInterviewQuestion({
        session,
        stage: getCurrentStage(session),
        normalizedResume: normalized,
        enableWebSearch: decision.shouldSearch,
        decision
      });
      recordRunStrategy(session.currentRun, "execute", question._providerMeta);
      const thread = upsertThreadForDecision(session, decision, question);
      question.threadId = thread.id;
      session.nextQuestion = question;
      session.currentThreadId = thread.id;
      session.currentRun.debug.execution = {
        summary: "第一道问题已生成。",
        question,
        modelStrategy: buildModelStrategyInfo(question._providerMeta)
      };

      session.status = "active";
      setRunPhase(session.currentRun, "feedback", "写回会话状态并等待候选人回答。");
      session.currentRun.debug.feedback = {
        summary: "启动轮已完成，当前等待候选人作答。"
      };
      completeRun(session.currentRun);
      await persistSession(session);
      schedulePlanRefresh(session.id);
    } catch (error) {
      session.status = "failed";
      failRun(session.currentRun, error);
      await persistSession(session);
    }
  });
}

// 回答链路当前仍是串行执行，
// 但在第二阶段之后，deliberate 已经从模型调用切成了本地策略。
async function processAnswerRun(sessionId, turnIndex) {
  await runSessionLifecycle(sessionId, async () => {
    const [{ normalized }, session] = await Promise.all([
      loadResumePackage(),
      loadSession(sessionId)
    ]);
    const turn = session.turns.find((item) => item.index === turnIndex);

    try {
      setRunPhase(session.currentRun, "observe", "分析用户回答、当前线程和覆盖情况。");
      publishSessionSnapshot(session);
      const assessment = await assessInterviewAnswer({
        session,
        stage: getCurrentStage(session),
        question: turn.question,
        answer: turn.answer
      });
      recordRunStrategy(session.currentRun, "observe", assessment._providerMeta);
      turn.assessment = assessment;
      turn.processing = true;
      session.currentRun.debug.observe = {
        ...buildObservationForAnswer(session, turn),
        preliminaryAssessment: assessment,
        modelStrategy: buildModelStrategyInfo(assessment._providerMeta)
      };
      session.coverage = recomputeCoverage(session);
      publishSessionSnapshot(session);

      setRunPhase(session.currentRun, "deliberate", "判断是继续追问、切换主题、联网搜索还是结束面试。");
      publishSessionSnapshot(session);
      session.currentRun.debug.deliberation = buildInterviewDecision({
        mode: "answer",
        session,
        stage: getCurrentStage(session),
        turn,
        assessment
      });
      recordRunStrategy(session.currentRun, "deliberate", session.currentRun.debug.deliberation._providerMeta);
      session.currentRun.debug.deliberation.modelStrategy = buildModelStrategyInfo(session.currentRun.debug.deliberation._providerMeta);
      publishSessionSnapshot(session);

      setRunPhase(session.currentRun, "decide", "提交下一步动作。");
      const decision = {
        action: session.currentRun.debug.deliberation.action,
        shouldSearch: Boolean(session.enableWebSearch && session.currentRun.debug.deliberation.shouldSearch),
        rationale: session.currentRun.debug.deliberation.rationale,
        threadId: session.currentRun.debug.deliberation.threadMode === "continue" ? turn.threadId : null,
        topicLabel: session.currentRun.debug.deliberation.topicLabel,
        targetStageIndex: session.currentRun.debug.deliberation.targetStageIndex
      };
      session.currentRun.debug.decision = decision;
      publishSessionSnapshot(session);

      setRunPhase(session.currentRun, "execute", decision.action === "end_interview" ? "生成最终复盘报告。" : "根据决策生成下一步问题。");
      publishSessionSnapshot(session);

      if (decision.action === "end_interview") {
        session.status = "completed";
        session.nextQuestion = null;
        session.report = await generateInterviewReport(session);
        recordRunStrategy(session.currentRun, "execute", session.report._providerMeta);
        session.currentRun.debug.execution = {
          modelStrategy: buildModelStrategyInfo(session.report._providerMeta),
          summary: "面试结束，复盘报告已生成。"
        };
      } else {
        applyDecisionStageTarget(session, decision);

        const question = await generateInterviewQuestion({
          session,
          stage: getCurrentStage(session),
          normalizedResume: normalized,
          enableWebSearch: decision.shouldSearch,
          decision
        });
        recordRunStrategy(session.currentRun, "execute", question._providerMeta);
        const thread = upsertThreadForDecision(session, decision, question);
        question.threadId = thread.id;
        session.currentThreadId = thread.id;
        session.nextQuestion = question;
        session.currentRun.debug.execution = {
          modelStrategy: buildModelStrategyInfo(question._providerMeta),
          summary: "下一道问题已生成。",
          question
        };
      }

      setRunPhase(session.currentRun, "feedback", "回写线程状态、覆盖率和回合结果。");
      turn.processing = false;
      finalizeThreadAfterAnswer(session, turn, session.currentRun.debug.decision);
      session.coverage = recomputeCoverage(session);
      if (session.status !== "completed") {
        session.status = "active";
      } else {
        session.currentThreadId = null;
      }
      session.currentRun.debug.feedback = {
        summary: session.status === "completed"
          ? "本轮处理结束，整场面试已完成。"
          : "本轮处理结束，等待候选人回答下一题。"
      };
      completeRun(session.currentRun);
      await persistSession(session);
    } catch (error) {
      session.status = "failed";
      if (turn) {
        turn.processing = false;
      }
      failRun(session.currentRun, error);
      await persistSession(session);
    }
  });
}

export async function getBootstrapData() {
  const [{ normalized }, catalog, templates] = await Promise.all([
    loadResumePackage(),
    loadInterviewCatalog(),
    listInterviewTemplates()
  ]);

  return {
    candidate: {
      profile: normalized.profile,
      headline: normalized.narrative.headline,
      summaryPoints: normalized.narrative.summaryPoints,
      experiences: normalized.experiences,
      topTopics: normalized.topicInventory.slice(0, 10)
    },
    templates,
    roles: catalog.roles,
    jobs: catalog.jobs,
    provider: {
      configured: Boolean(configuredProviderKey()),
      mode: configuredProviderKey() ? `${process.env.AI_PROVIDER || "moonshot"}+fallback` : "fallback-only"
    }
  };
}

// 创建会话时会先合并模板覆盖，再构建 draft plan，
// 然后立即异步启动首轮处理。
export async function createInterviewSession({ roleId, jobId, notes = "", enableWebSearch = false, templateId = "", template = null }) {
  let resolvedTemplate = templateId
    ? await loadInterviewTemplate(templateId)
    : (template ? {
      ...template,
      companyName: String(template.companyName || "").trim(),
      companyIntro: String(template.companyIntro || "").trim(),
      jobDirection: String(template.jobDirection || "").trim(),
      jobDescription: String(template.jobDescription || "").trim(),
      additionalContext: String(template.additionalContext || "").trim(),
      interviewerRoleName: String(template.interviewerRoleName || "").trim(),
      roleId: String(template.roleId || roleId || "").trim(),
      jobId: String(template.jobId || jobId || "").trim(),
      name: String(template.name || "").trim() || "unsaved-template"
    } : null);

  if (resolvedTemplate?.id && !template) {
    resolvedTemplate = await markInterviewTemplateUsed(resolvedTemplate.id);
  }

  const resolvedRoleId = resolvedTemplate?.roleId || roleId;
  const resolvedJobId = resolvedTemplate?.jobId || jobId;
  const [{ normalized }, baseRole, baseJob] = await Promise.all([
    loadResumePackage(),
    findRole(resolvedRoleId),
    findJob(resolvedJobId)
  ]);

  if (!baseRole) {
    throw new Error(`Unknown role: ${resolvedRoleId}`);
  }

  if (!baseJob) {
    throw new Error(`Unknown job: ${resolvedJobId}`);
  }

  const role = buildTemplateDrivenRole(baseRole, resolvedTemplate);
  const job = buildTemplateDrivenJob(baseJob, resolvedTemplate);
  const mergedNotes = buildTemplateNotes(resolvedTemplate, notes);

  const plan = buildDraftPlan(job, role, normalized);

  const session = {
    id: createSessionId(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: "processing",
    role,
    job,
    interviewTemplate: resolvedTemplate,
    notes: mergedNotes,
    enableWebSearch,
    provider: configuredProviderKey() ? `${process.env.AI_PROVIDER || "moonshot"}+fallback` : "fallback",
    plan,
    stageIndex: 0,
    coverage: buildCoverage(plan),
    turns: [],
    report: null,
    nextQuestion: null,
    topicThreads: [],
    currentThreadId: null,
    policy: buildInterviewPolicy(normalized, job, role),
    currentRun: createRun("start", {
      notes: mergedNotes,
      templateId: resolvedTemplate?.id || null,
      enableWebSearch
    })
  };

  await persistSession(session);
  void processStartRun(session.id);
  return buildPublicSession(session);
}

export async function getInterviewSession(sessionId) {
  return buildPublicSession(await loadSession(sessionId));
}

export async function answerInterviewQuestion(sessionId, answer) {
  const session = await loadSession(sessionId);

  if (session.status === "processing") {
    throw new Error("Session is still processing the previous round.");
  }

  if (session.status === "completed") {
    return buildPublicSession(session);
  }

  const pendingTurn = {
    index: session.turns.length + 1,
    createdAt: nowIso(),
    question: session.nextQuestion,
    answer,
    assessment: null,
    processing: true,
    threadId: session.nextQuestion?.threadId || session.currentThreadId || null
  };

  session.turns.push(pendingTurn);
  session.nextQuestion = null;
  session.status = "processing";
  session.currentRun = createRun("answer", {
    turnIndex: pendingTurn.index
  });

  await persistSession(session);
  void processAnswerRun(session.id, pendingTurn.index);
  return buildPublicSession(session);
}

// 进程启动后只恢复那些已经持久化为 active 的运行中会话。
export async function resumePendingSessions() {
  const sessions = await listSessions();
  const pending = sessions.filter((session) => session.status === "processing" && session.currentRun?.status === "running");

  for (const session of pending) {
    if (session.currentRun?.kind === "start") {
      void processStartRun(session.id);
      continue;
    }

    if (session.currentRun?.kind === "answer") {
      const turnIndex = Number(session.currentRun?.payload?.turnIndex) || session.turns.at(-1)?.index;
      if (turnIndex) {
        void processAnswerRun(session.id, turnIndex);
      }
    }
  }

  return pending.length;
}
