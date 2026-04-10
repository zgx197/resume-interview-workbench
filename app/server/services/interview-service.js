import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";
import { loadInterviewCatalog, findJob, findRole } from "./catalog-loader.js";
import {
  analyzeInterviewTurn,
  buildInterviewPlan,
  generateInterviewQuestion,
  generateInterviewReport
} from "./llm-provider.js";
import { buildInterviewDecision, buildInterviewPolicy } from "./interview-policy.js";
import { loadResumePackage } from "./resume-loader.js";
import { publishSession } from "./session-events.js";
import {
  createSessionId,
  listSessions,
  listResumableSessions,
  loadSession,
  mirrorSessionToFile,
  shouldPersistSessionsToDb,
  shouldPersistSessionsToFile
} from "./session-store.js";
import { listInterviewTemplates, loadInterviewTemplate, markInterviewTemplateUsed } from "./template-service.js";
import { createFallbackQuestion } from "./fallback-interviewer.js";
import { normalizeInterviewQuestionText } from "./question-text.js";
import { ensureQuestionBankSeeded, pickFollowupQuestionForInterview, pickQuestionForInterview, recordQuestionAsked, recordQuestionOutcome } from "./question-bank-service.js";
import { syncReviewArtifactsForTurn } from "./review-service.js";
import {
  completeBackgroundJobLease,
  deleteOrphanedSessionBackgroundJobs,
  failBackgroundJobLease,
  heartbeatBackgroundJobLease,
  leaseBackgroundJob,
  leaseNextBackgroundJob,
  listResumableBackgroundJobs,
  recoverBackgroundJobLeases,
  startBackgroundJobLease,
  upsertBackgroundJobSnapshot,
  upsertBackgroundJobSnapshotInBackground
} from "./background-job-service.js";
import { EMBEDDING_JOB_KIND, syncKnowledgeEmbeddingById } from "./embedding-service.js";
import { syncInterviewRuntimeSnapshot } from "./runtime-persistence-service.js";

const RUN_PHASES = ["observe", "deliberate", "decide", "execute", "feedback"];
const inFlightRuns = new Set();
const pendingBackgroundJobs = new Set();
const activeBackgroundProviderJobs = new Set();
const interviewLogger = createLogger({ component: "interview-service" });
const BACKGROUND_JOB_KIND = {
  PLAN_REFRESH: "plan_refresh",
  REPORT: "report",
  THREAD_SUMMARY: "thread_summary"
};
const BACKGROUND_JOB_DEFAULT_DELAY_MS = {
  plan_refresh: 45000,
  report: 1500,
  thread_summary: 0
};
const BACKGROUND_JOB_RETRY_DELAY_MS = {
  plan_refresh: 20000,
  report: 3000,
  thread_summary: 1500
};
const BACKGROUND_JOB_WORKER_ID = `server-${process.pid}`;
const BACKGROUND_JOB_LEASE_MS = 45000;
const BACKGROUND_JOB_POLL_INTERVAL_MS = 2000;
let backgroundJobWorkerStarted = false;
let backgroundJobWorkerTimer = null;

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

function remainingDelayMs(scheduledAt) {
  const scheduled = Date.parse(scheduledAt || "");
  if (!Number.isFinite(scheduled)) {
    return 0;
  }

  return Math.max(0, scheduled - Date.now());
}

function buildSessionLogContext(sessionOrId, extra = {}) {
  const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
  const runId = typeof sessionOrId === "object" ? (sessionOrId?.currentRun?.id || null) : null;
  const turnIndex = typeof sessionOrId === "object"
    ? sessionOrId?.currentRun?.payload?.turnIndex
    : undefined;

  return Object.fromEntries(
    Object.entries({
      sessionId,
      runId,
      turnIndex,
      ...extra
    }).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function createSessionLogger(sessionOrId, extra = {}) {
  return interviewLogger.child(buildSessionLogContext(sessionOrId, extra));
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

function createLocalQuestionProviderMeta(label = "deterministic local question") {
  return {
    provider: "local",
    model: "question-fallback-v1",
    purpose: "question",
    thinkingType: "disabled",
    toolMode: false,
    strategyLabel: label
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

function sameSourceRef(left, right) {
  return Boolean(
    left?.sourceType &&
    left?.sourceId &&
    left.sourceType === right?.sourceType &&
    left.sourceId === right?.sourceId
  );
}

function countMatchedSourceRefs(left = [], right = []) {
  return left.reduce((count, ref) => count + (right.some((item) => sameSourceRef(ref, item)) ? 1 : 0), 0);
}

function createTopicTarget(topic) {
  return {
    topicId: topic.id,
    label: topic.label,
    evidence: topic.evidence.slice(0, 2),
    sourceRefs: topic.sourceRefs
  };
}

function findBestTopicMatch(targetTopic, stageCategory, normalizedResume) {
  if (!normalizedResume?.topicInventory?.length) {
    return null;
  }

  if (targetTopic?.topicId) {
    return normalizedResume.topicInventory.find((topic) => topic.id === targetTopic.topicId) || null;
  }

  const preferredCategory = targetTopic?.topicCategory || stageCategory;
  let bestTopic = null;
  let bestScore = -1;

  for (const topic of normalizedResume.topicInventory) {
    const matchedSourceCount = countMatchedSourceRefs(topic.sourceRefs, targetTopic?.sourceRefs || []);
    const matchedEvidenceCount = (targetTopic?.evidence || []).filter((item) => topic.evidence.includes(item)).length;
    const sameLabel = targetTopic?.label && topic.label === targetTopic.label;
    const score = (
      matchedSourceCount * 10 +
      matchedEvidenceCount * 3 +
      (sameLabel ? 4 : 0) +
      (topic.category === preferredCategory ? 3 : 0)
    );

    if (score > bestScore) {
      bestTopic = topic;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestTopic : null;
}

// LLM 产出的 plan 不一定能稳定给出 topicId，
// 这里用 label/sourceRefs/category 做一次本地归并，保证后续 graph/policy 可直接消费。
function attachTopicIdsToPlan(plan, normalizedResume) {
  if (!plan) {
    return plan;
  }

  return {
    ...plan,
    stages: (plan.stages || []).map((stage) => ({
      ...stage,
      targetTopics: (stage.targetTopics || []).map((topic) => {
        const matchedTopic = findBestTopicMatch(topic, stage.category, normalizedResume);
        return {
          ...topic,
          topicId: topic?.topicId || matchedTopic?.id || null,
          label: topic?.label || matchedTopic?.label || stage.title || stage.category,
          evidence: Array.isArray(topic?.evidence) && topic.evidence.length
            ? topic.evidence
            : (matchedTopic?.evidence || []).slice(0, 2),
          sourceRefs: Array.isArray(topic?.sourceRefs) && topic.sourceRefs.length
            ? topic.sourceRefs
            : (matchedTopic?.sourceRefs || [])
        };
      })
    }))
  };
}

// draft plan 的目标只有一个：先把首题跑起来。
// 更完整的正式计划可以在后台异步补齐，不阻塞会话激活。
function buildDraftPlan(job, role, normalizedResume) {
  const recentExperienceIds = new Set(normalizedResume.experiences.slice(0, 2).map((experience) => experience.id));
  const recentExperienceTopics = normalizedResume.topicInventory
    .filter((topic) => (
      topic.category === "game_framework" &&
      topic.sourceRefs.some((ref) => ref.sourceType === "experience" && recentExperienceIds.has(ref.sourceId))
    ))
    .slice(0, 2)
    .map(createTopicTarget);
  const fallbackWarmupTopics = normalizedResume.experiences.slice(0, 2).map((experience) => ({
    topicId: null,
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
      targetTopics: recentExperienceTopics.length ? recentExperienceTopics : fallbackWarmupTopics
    },
    ...(job.questionAreas || []).map((area) => ({
      id: `area-${area}`,
      category: area,
      title: area,
      goal: `覆盖 ${area} 相关能力。`,
      promptHint: "等待正式计划生成。",
      targetTopics: (topicsByCategory[area] || []).slice(0, 3).map(createTopicTarget)
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

// session.topicGraph 保留“静态拓扑 + 计划映射”，
// askCount / activeThread / currentQuestion 这类运行态指标由后续重算填充。
function buildSessionTopicGraph(plan, normalizedResume) {
  const plannedStageRefs = new Map();

  for (const stage of plan?.stages || []) {
    for (const topic of stage.targetTopics || []) {
      if (!topic?.topicId) {
        continue;
      }

      const refs = plannedStageRefs.get(topic.topicId) || [];
      refs.push({
        stageId: stage.id,
        stageTitle: stage.title,
        category: stage.category
      });
      plannedStageRefs.set(topic.topicId, refs);
    }
  }

  return {
    nodes: (normalizedResume?.topicGraph?.nodes || []).map((node) => {
      const stageRefs = plannedStageRefs.get(node.id) || [];
      return {
        ...node,
        stageIds: stageRefs.map((item) => item.stageId),
        stageTitles: stageRefs.map((item) => item.stageTitle),
        plannedCount: stageRefs.length,
        askCount: 0,
        averageScore: null,
        lastScore: null,
        lastTurnIndex: null,
        threadCount: 0,
        activeThreadId: null,
        currentQuestion: false,
        covered: false,
        status: stageRefs.length ? "planned" : "idle"
      };
    }),
    edges: (normalizedResume?.topicGraph?.edges || []).map((edge) => ({ ...edge })),
    updatedAt: nowIso()
  };
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

// 每次进入关键状态切换都重算 topic graph，
// 避免线程关闭、追问继续、题目切换之后出现节点状态漂移。
function recomputeTopicGraph(session) {
  if (!session.topicGraph?.nodes) {
    return session.topicGraph || null;
  }

  const nodeStats = new Map();
  const threadCounts = new Map();
  const activeThreads = new Map();

  for (const thread of session.topicThreads || []) {
    if (!thread?.topicId) {
      continue;
    }

    threadCounts.set(thread.topicId, (threadCounts.get(thread.topicId) || 0) + 1);
    if (thread.status === "active") {
      activeThreads.set(thread.topicId, thread.id);
    }
  }

  for (const turn of session.turns || []) {
    const topicId = turn.question?.topicId;
    if (!topicId) {
      continue;
    }

    const stat = nodeStats.get(topicId) || {
      askCount: 0,
      scores: [],
      lastScore: null,
      lastTurnIndex: null
    };
    stat.askCount += 1;
    stat.lastTurnIndex = turn.index;
    if (Number.isFinite(turn.assessment?.score)) {
      stat.scores.push(turn.assessment.score);
      stat.lastScore = turn.assessment.score;
    }
    nodeStats.set(topicId, stat);
  }

  return {
    ...session.topicGraph,
    nodes: session.topicGraph.nodes.map((node) => {
      const stat = nodeStats.get(node.id);
      const askCount = stat?.askCount || 0;
      const averageScore = stat?.scores?.length
        ? Number((stat.scores.reduce((sum, score) => sum + score, 0) / stat.scores.length).toFixed(2))
        : null;
      const currentQuestion = session.nextQuestion?.topicId === node.id;
      const activeThreadId = activeThreads.get(node.id) || null;
      const covered = askCount > 0;

      return {
        ...node,
        askCount,
        averageScore,
        lastScore: stat?.lastScore ?? null,
        lastTurnIndex: stat?.lastTurnIndex ?? null,
        threadCount: threadCounts.get(node.id) || 0,
        activeThreadId,
        currentQuestion,
        covered,
        status: currentQuestion || activeThreadId
          ? "active"
          : covered
            ? "covered"
            : (node.plannedCount || 0) > 0
              ? "planned"
              : "idle"
      };
    }),
    updatedAt: nowIso()
  };
}

function recomputeDerivedState(session) {
  session.coverage = recomputeCoverage(session);
  session.topicGraph = recomputeTopicGraph(session);
}

// plan 变更时统一重建 stage->topic 映射，
// 这样 draft plan、refined plan 和旧 session 都走同一套修复路径。
function syncPlanAndGraph(session, normalizedResume) {
  session.plan = attachTopicIdsToPlan(session.plan, normalizedResume);
  session.topicGraph = buildSessionTopicGraph(session.plan, normalizedResume);
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

// 后台任务状态独立于 currentRun，
// 用来表达“主交互已结束，但冷路径工作仍在继续”的状态。
function createBackgroundJobState(kind, targetId = null) {
  return {
    kind,
    targetId,
    status: "idle",
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    attempts: 0,
    error: null
  };
}

function queueBackgroundJob(job, queuedAt = nowIso()) {
  return {
    ...createBackgroundJobState(job?.kind || "job"),
    ...job,
    status: "pending",
    queuedAt,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    error: null
  };
}

function startBackgroundJob(job, startedAt = nowIso()) {
  return {
    ...createBackgroundJobState(job?.kind || "job"),
    ...job,
    status: "running",
    startedAt,
    completedAt: null,
    failedAt: null,
    attempts: (job?.attempts || 0) + 1,
    error: null
  };
}

function completeBackgroundJob(job, completedAt = nowIso()) {
  return {
    ...createBackgroundJobState(job?.kind || "job"),
    ...job,
    status: "completed",
    completedAt,
    failedAt: null,
    error: null
  };
}

function failBackgroundJob(job, error, failedAt = nowIso()) {
  return {
    ...createBackgroundJobState(job?.kind || "job"),
    ...job,
    status: "failed",
    failedAt,
    completedAt: null,
    error: error.message
  };
}

function backgroundJobKey(sessionId, kind, targetId = null) {
  return `${sessionId}:${kind}:${targetId || "session"}`;
}

function isProviderBackedBackgroundJob(kind) {
  return kind === BACKGROUND_JOB_KIND.PLAN_REFRESH || kind === BACKGROUND_JOB_KIND.REPORT;
}

function resolveBackgroundJobDelay(kind, delayMs) {
  if (Number.isFinite(delayMs)) {
    return Math.max(0, Number(delayMs));
  }

  return BACKGROUND_JOB_DEFAULT_DELAY_MS[kind] ?? 0;
}

function getBackgroundJobRetryDelay(kind) {
  return BACKGROUND_JOB_RETRY_DELAY_MS[kind] ?? 1500;
}

function resolveBackgroundProviderDeferDelay(session, kind, jobKey) {
  if (!isProviderBackedBackgroundJob(kind)) {
    return null;
  }

  if (inFlightRuns.size > 0) {
    return 10000;
  }

  if (activeBackgroundProviderJobs.size > 0 && !activeBackgroundProviderJobs.has(jobKey)) {
    return 15000;
  }

  if (kind === BACKGROUND_JOB_KIND.PLAN_REFRESH && session.status !== "completed") {
    const updatedAt = Date.parse(session.updatedAt || session.createdAt || "");
    const idleMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : 0;
    const graceMs = (session.turns?.length || 0) > 0 ? 45000 : 60000;
    if (idleMs < graceMs) {
      return Math.max(5000, graceMs - idleMs + 1000);
    }
  }

  return null;
}

function runWithBackgroundProviderLock(jobKey, task) {
  activeBackgroundProviderJobs.add(jobKey);
  return Promise.resolve()
    .then(task)
    .finally(() => {
      activeBackgroundProviderJobs.delete(jobKey);
    });
}

// provider 型后台任务必须给前台交互让路。
// 这里既限制并发，也为 plan refresh 增加一个活跃期宽限，避免和刚回答后的热路径抢模型。
function shouldDeferBackgroundProviderJob(session, kind, jobKey) {
  return Number.isFinite(resolveBackgroundProviderDeferDelay(session, kind, jobKey));
}

function backgroundJobKinds() {
  return [
    BACKGROUND_JOB_KIND.PLAN_REFRESH,
    BACKGROUND_JOB_KIND.REPORT,
    BACKGROUND_JOB_KIND.THREAD_SUMMARY,
    EMBEDDING_JOB_KIND
  ];
}

function isSessionScopedBackgroundJob(kind) {
  return kind !== EMBEDDING_JOB_KIND;
}

function backgroundJobAttemptMeta(job) {
  return {
    attempt: Number(job?.attempts || 0),
    maxAttempts: Number(job?.maxAttempts || 0)
  };
}

function backgroundJobScheduledLagMs(job) {
  const scheduled = Date.parse(job?.scheduledAt || "");
  if (!Number.isFinite(scheduled)) {
    return null;
  }

  return Math.max(0, Date.now() - scheduled);
}

function isMissingSessionError(error) {
  return error?.code === "SESSION_NOT_FOUND"
    || /Session not found in database:/i.test(String(error?.message || ""));
}

function startBackgroundJobLeaseHeartbeat(jobKey, workerId) {
  return setInterval(() => {
    void heartbeatBackgroundJobLease(jobKey, workerId, {
      leaseMs: BACKGROUND_JOB_LEASE_MS
    }).catch(() => {});
  }, Math.max(5000, Math.floor(BACKGROUND_JOB_LEASE_MS / 3)));
}

function scheduleBackgroundJobWorkerPoll(delayMs = BACKGROUND_JOB_POLL_INTERVAL_MS) {
  if (backgroundJobWorkerTimer) {
    clearTimeout(backgroundJobWorkerTimer);
  }

  backgroundJobWorkerTimer = setTimeout(() => {
    backgroundJobWorkerTimer = null;
    void pumpBackgroundJobWorker();
  }, delayMs);
}

async function pumpBackgroundJobWorker() {
  try {
    const leasedJob = await leaseNextBackgroundJob(BACKGROUND_JOB_WORKER_ID, {
      leaseMs: BACKGROUND_JOB_LEASE_MS,
      kinds: backgroundJobKinds()
    });

    if (!leasedJob) {
      scheduleBackgroundJobWorkerPoll();
      return;
    }

    void runBackgroundJob({
      sessionId: leasedJob.sessionId,
      kind: leasedJob.kind,
      targetId: leasedJob.targetId,
      leasedJob,
      workerId: BACKGROUND_JOB_WORKER_ID,
      source: "worker"
    }).finally(() => {
      scheduleBackgroundJobWorkerPoll(0);
    });
  } catch {
    scheduleBackgroundJobWorkerPoll();
  }
}

export function startBackgroundJobWorker() {
  if (backgroundJobWorkerStarted) {
    return;
  }

  backgroundJobWorkerStarted = true;
  if (!shouldPersistSessionsToDb()) {
    scheduleBackgroundJobWorkerPoll(0);
    return;
  }

  void deleteOrphanedSessionBackgroundJobs({
    kinds: backgroundJobKinds()
  }).then((deletedCount) => {
    if (deletedCount > 0) {
      interviewLogger.warn("background_job.orphaned_deleted", {
        workerId: BACKGROUND_JOB_WORKER_ID,
        deletedCount
      });
    }

    return recoverBackgroundJobLeases({
      kinds: backgroundJobKinds()
    });
  }).then((recoveredJobs) => {
    if (recoveredJobs.length) {
      interviewLogger.warn("background_job.recovered", {
        workerId: BACKGROUND_JOB_WORKER_ID,
        recoveredCount: recoveredJobs.length,
        pendingCount: recoveredJobs.filter((job) => job.status === "pending").length,
        failedCount: recoveredJobs.filter((job) => job.status === "failed").length,
        jobKeys: recoveredJobs.slice(0, 10).map((job) => job.jobKey)
      });
    }
  }).catch((error) => {
    interviewLogger.error("background_job.recovery_failed", error, {
      workerId: BACKGROUND_JOB_WORKER_ID
    });
  }).finally(() => {
    scheduleBackgroundJobWorkerPoll(0);
  });
}

function createQuietBackgroundRetry(kind, retryDelayMs = null) {
  return {
    shouldRetry: true,
    retryDelayMs: Number.isFinite(retryDelayMs) ? Number(retryDelayMs) : getBackgroundJobRetryDelay(kind),
    quiet: true
  };
}

// 后台任务很多时候只是“现在还不该跑”，例如前台仍在 processing、
// plan refresh 仍处于静默窗口、或 report 还在等 thread summary 完成。
// 这些情况不应该进入正式 span，否则日志里会出现大量空转的 started/completed。
function resolveBackgroundJobPreflight(session, kind, targetId, jobKey) {
  if (kind === BACKGROUND_JOB_KIND.PLAN_REFRESH) {
    if (session.plan?.strategy !== "draft_plan") {
      return { shouldSkip: true };
    }

    if (session.status === "processing" || session.currentRun?.status === "running") {
      return createQuietBackgroundRetry(kind, 12000);
    }

    const deferDelayMs = resolveBackgroundProviderDeferDelay(session, kind, jobKey);
    if (Number.isFinite(deferDelayMs)) {
      return createQuietBackgroundRetry(kind, deferDelayMs);
    }

    return null;
  }

  if (kind === BACKGROUND_JOB_KIND.REPORT) {
    if (session.status !== "completed") {
      return { shouldSkip: true };
    }

    if (session.report && getSessionJobState(session, kind)?.status === "completed") {
      return { shouldSkip: true };
    }

    if (session.status === "processing" || session.currentRun?.status === "running") {
      return createQuietBackgroundRetry(kind, 10000);
    }

    const pendingThreadSummary = (session.topicThreads || []).some((thread) => {
      const status = getThreadSummaryJobState(thread)?.status || "idle";
      return status === "pending" || status === "running";
    });
    if (pendingThreadSummary) {
      return createQuietBackgroundRetry(kind, 5000);
    }

    const deferDelayMs = resolveBackgroundProviderDeferDelay(session, kind, jobKey);
    if (Number.isFinite(deferDelayMs)) {
      return createQuietBackgroundRetry(kind, deferDelayMs);
    }

    return null;
  }

  if (kind === BACKGROUND_JOB_KIND.THREAD_SUMMARY) {
    const thread = getThreadById(session, targetId);
    if (!thread) {
      return { shouldSkip: true };
    }

    if (session.status === "processing" || session.currentRun?.status === "running") {
      return createQuietBackgroundRetry(kind, 3000);
    }
  }

  return null;
}

function getSessionJobState(session, kind) {
  if (kind === BACKGROUND_JOB_KIND.PLAN_REFRESH) {
    session.planJob ||= createBackgroundJobState(kind);
    return session.planJob;
  }

  if (kind === BACKGROUND_JOB_KIND.REPORT) {
    session.reportJob ||= createBackgroundJobState(kind);
    return session.reportJob;
  }

  return null;
}

function setSessionJobState(session, kind, job) {
  if (kind === BACKGROUND_JOB_KIND.PLAN_REFRESH) {
    session.planJob = job;
    return;
  }

  if (kind === BACKGROUND_JOB_KIND.REPORT) {
    session.reportJob = job;
  }
}

function getThreadById(session, threadId) {
  return session.topicThreads?.find((thread) => thread.id === threadId) || null;
}

function getThreadSummaryJobState(thread) {
  if (!thread) {
    return null;
  }
  thread.summaryJob ||= createBackgroundJobState(BACKGROUND_JOB_KIND.THREAD_SUMMARY, thread.id);
  return thread.summaryJob;
}

function setThreadSummaryJobState(thread, job) {
  if (!thread) {
    return;
  }
  thread.summaryJob = {
    ...job,
    targetId: thread.id
  };
}

function buildBackgroundJobsView(session) {
  const jobs = [];

  const pushJob = (job, extras = {}) => {
    if (!job) {
      return;
    }

    jobs.push({
      id: backgroundJobKey(session.id, job.kind, job.targetId || extras.targetId || null),
      kind: job.kind,
      scope: extras.scope || "session",
      targetId: job.targetId || extras.targetId || null,
      targetLabel: extras.targetLabel || null,
      status: job.status || "idle",
      attempts: job.attempts || 0,
      error: job.error || null,
      queuedAt: job.queuedAt || null,
      startedAt: job.startedAt || null,
      completedAt: job.completedAt || null,
      failedAt: job.failedAt || null
    });
  };

  pushJob(session.planJob, {
    scope: "session",
    targetLabel: "面试计划刷新"
  });
  pushJob(session.reportJob, {
    scope: "session",
    targetLabel: "面试复盘生成"
  });

  for (const thread of session.topicThreads || []) {
    pushJob(thread.summaryJob, {
      scope: "thread",
      targetId: thread.id,
      targetLabel: thread.label || thread.category || thread.id
    });
  }

  return jobs.sort((left, right) => {
    const statusWeight = {
      running: 0,
      leased: 1,
      pending: 2,
      failed: 3,
      completed: 4,
      idle: 5
    };
    return (
      (statusWeight[left.status] ?? 9) - (statusWeight[right.status] ?? 9) ||
      String(left.targetLabel || "").localeCompare(String(right.targetLabel || "")) ||
      String(left.kind).localeCompare(String(right.kind))
    );
  });
}

function buildPublicSession(session) {
  refreshRunProgress(session.currentRun);
  return {
    id: session.id,
    status: session.status,
    version: session.version ?? null,
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
    topicGraph: session.topicGraph || null,
    turns: session.turns,
    nextQuestion: session.nextQuestion,
    report: session.report || null,
    reportReady: Boolean(session.report),
    planJob: session.planJob || null,
    reportJob: session.reportJob || null,
    backgroundJobs: buildBackgroundJobsView(session),
    provider: session.provider,
    currentRun: session.currentRun || null,
    topicThreads: session.topicThreads || [],
    currentThreadId: session.currentThreadId || null
  };
}

// thread 表示“当前正在深挖的一条证据线”，
// 它和 stage 分离存在，才能显式表达追问与切题。
function canReusePrecomputedQuestion(question, decision) {
  if (!question || !String(question.text || "").trim()) {
    return false;
  }

  if (!decision?.targetTopicId || !question.topicId) {
    if (!decision?.targetTopicCategory || !question.topicCategory) {
      return true;
    }

    return question.topicCategory === decision.targetTopicCategory;
  }

  return question.topicId === decision.targetTopicId;
}

function extractAskedQuestionIds(session) {
  return (session.turns || [])
    .map((turn) => turn.question?.questionId || turn.question?.id || null)
    .filter(Boolean);
}

async function buildQuestionFromBank({ session, stage, normalizedResume, decision }) {
  if (!stage?.category) {
    return null;
  }

  const bankQuestion = await pickQuestionForInterview({
    category: decision?.targetTopicCategory || stage.category,
    queryText: [
      decision?.targetTopicLabel,
      decision?.topicLabel,
      decision?.targetEvidenceSource,
      stage?.title
    ].filter(Boolean).join(" "),
    excludeIds: extractAskedQuestionIds(session)
  });

  if (!bankQuestion) {
    return null;
  }

  const scaffold = createFallbackQuestion({
    session,
    stage,
    normalizedResume,
    decision
  });
  const prefix = session.turns.length === 0
    ? "先从你最相关的一段经历切入。"
    : `接下来我想看你在 ${stage.title} 上的真实深度。`;

  return {
    ...scaffold,
    strategy: "question_bank",
    questionId: bankQuestion.id,
    sourceType: bankQuestion.sourceType,
    difficulty: bankQuestion.difficulty,
    _providerMeta: createLocalQuestionProviderMeta("question bank selection"),
    text: normalizeInterviewQuestionText(
      `${prefix}${bankQuestion.canonicalText} 请尽量结合 ${scaffold.evidenceSource} 来回答。`
    )
  };
}

async function buildFollowupQuestionFromBank({
  session,
  turn,
  stage,
  normalizedResume,
  decision,
  turnAnalysis,
  reviewItem
}) {
  if (!stage?.category || !turn) {
    return null;
  }

  const bankQuestion = await pickFollowupQuestionForInterview({
    session,
    turn,
    decision,
    reviewItem,
    turnAnalysis
  });
  if (!bankQuestion) {
    return null;
  }

  const scaffold = createFallbackQuestion({
    session,
    stage,
    normalizedResume,
    decision
  });
  const weaknessHint = String(
    reviewItem?.weaknessType
    || turnAnalysis?.assessment?.suggestedFollowup
    || turnAnalysis?.assessment?.risks?.[0]
    || turnAnalysis?.followupQuestion?.text
    || ""
  ).trim();
  const prefix = weaknessHint
    ? `刚才这部分我还想继续追问，重点看你怎么补清楚“${weaknessHint}”。`
    : "刚才这部分我还想继续追问。";

  return {
    ...scaffold,
    strategy: "question_bank_followup",
    questionId: bankQuestion.id,
    sourceType: bankQuestion.sourceType,
    difficulty: bankQuestion.difficulty,
    _providerMeta: createLocalQuestionProviderMeta("question bank followup selection"),
    text: normalizeInterviewQuestionText(
      `${prefix}${bankQuestion.canonicalText} 请直接补充你刚才回答里还没有展开清楚的部分，并尽量结合 ${scaffold.evidenceSource} 来回答。`
    )
  };
}

async function recordAskedQuestionSafely(question, session, extra = {}) {
  const questionId = question?.questionId || null;
  if (!questionId) {
    return;
  }

  try {
    await recordQuestionAsked(questionId);
  } catch (error) {
    createSessionLogger(session, extra).warn("question_bank.record_asked_failed", error, {
      questionId
    });
  }
}

// answer_turn 已经把“评估 + 候选追问 / 候选切题”放进同一次模型往返里。
// 如果切题草稿没有和本地 policy 的目标完全对齐，这里直接按本地决策兜底出题，
// 避免再次触发 question provider 调用，把回答热路径稳定压成单次远程请求。
function buildDeterministicQuestion({ session, stage, normalizedResume, decision, turnAnalysis }) {
  const preferredDraft = decision?.action === "ask_followup"
    ? turnAnalysis?.followupQuestion
    : (turnAnalysis?.nextTopicQuestion || turnAnalysis?.followupQuestion);
  const fallbackQuestion = createFallbackQuestion({
    session,
    stage,
    normalizedResume,
    decision
  });
  const sameCategoryDraft = preferredDraft?.topicCategory && decision?.targetTopicCategory
    ? preferredDraft.topicCategory === decision.targetTopicCategory
    : false;

  return {
    ...fallbackQuestion,
    strategy: preferredDraft?.strategy
      ? `${preferredDraft.strategy}_deterministic_fallback`
      : "deterministic_local_question",
    expectedSignals: sameCategoryDraft && Array.isArray(preferredDraft?.expectedSignals) && preferredDraft.expectedSignals.length
      ? preferredDraft.expectedSignals
      : fallbackQuestion.expectedSignals,
    rationale: String(preferredDraft?.rationale || "").trim() || fallbackQuestion.rationale,
    text: normalizeInterviewQuestionText(preferredDraft?.text || fallbackQuestion.text),
    _providerMeta: createLocalQuestionProviderMeta(
      sameCategoryDraft
        ? "deterministic local question with draft hints"
        : "deterministic local question"
    )
  };
}

async function pickQuestionExecutionPath({
  decision,
  turnAnalysis,
  session,
  stage,
  normalizedResume,
  turn = null,
  reviewItem = null
}) {
  if (decision?.shouldSearch) {
    return {
      question: null,
      source: "live_question_call"
    };
  }

  if (decision?.action === "ask_followup") {
    const followupQuestion = await buildFollowupQuestionFromBank({
      session,
      turn,
      stage,
      normalizedResume,
      decision,
      turnAnalysis,
      reviewItem
    });
    if (followupQuestion) {
      return {
        question: followupQuestion,
        source: "question_bank_followup"
      };
    }
  } else {
    const questionBankQuestion = await buildQuestionFromBank({
      session,
      stage,
      normalizedResume,
      decision
    });
    if (questionBankQuestion) {
      return {
        question: questionBankQuestion,
        source: "question_bank"
      };
    }
  }

  const precomputedQuestion = pickPrecomputedQuestion(turnAnalysis, decision);
  if (precomputedQuestion) {
    precomputedQuestion._providerMeta = turnAnalysis?._providerMeta;
    return {
      question: precomputedQuestion,
      source: "precomputed_turn_analysis"
    };
  }

  return {
    question: buildDeterministicQuestion({
      session,
      stage,
      normalizedResume,
      decision,
      turnAnalysis
    }),
    source: "deterministic_local_question"
  };
}

function pickPrecomputedQuestion(turnAnalysis, decision) {
  if (!turnAnalysis || decision?.action === "end_interview") {
    return null;
  }

  const preferred = decision.action === "ask_followup"
    ? turnAnalysis.followupQuestion
    : (turnAnalysis.nextTopicQuestion || turnAnalysis.followupQuestion);

  if (!canReusePrecomputedQuestion(preferred, decision)) {
    return null;
  }

  return {
    ...preferred
  };
}

function createThread({ category, label, evidenceSource, stageId }) {
  return {
    id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category,
    label,
    evidenceSource,
    stageId,
    topicId: null,
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
    lastAssessmentScore: null,
    summary: null,
    summarySignals: [],
    summaryRisks: [],
    summaryUpdatedAt: null,
    summaryJob: null
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

  thread.summaryJob ||= createBackgroundJobState(BACKGROUND_JOB_KIND.THREAD_SUMMARY, thread.id);

  thread.updatedAt = nowIso();
  thread.topicId = question.topicId || decision.targetTopicId || thread.topicId || null;
  thread.category = question.topicCategory || thread.category;
  thread.label = decision.topicLabel || question.topicLabel || thread.label;
  thread.stageId = question.stageId || thread.stageId;
  thread.evidenceSource = question.evidenceSource || thread.evidenceSource;
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

async function persistSession(session, logContext = {}) {
  const logger = createSessionLogger(session, logContext);
  const span = logger.startSpan("session.persist", {
    status: session.status,
    turns: session.turns?.length || 0
  });

  refreshRunProgress(session.currentRun);
  session.updatedAt = nowIso();
  try {
    const storageLogContext = buildSessionLogContext(session, logContext);

    if (shouldPersistSessionsToDb()) {
      try {
        const persistedSession = await syncInterviewRuntimeSnapshot(session);
        session.version = persistedSession?.version ?? session.version ?? null;
      } catch (error) {
        if (error?.code === "SESSION_VERSION_CONFLICT" || !shouldPersistSessionsToFile()) {
          throw error;
        }

        logger.warn("session.persist_db_failed", error, {
          storageMode: config.interviewRuntimeStorageMode
        });
      }
    }

    if (shouldPersistSessionsToFile()) {
      await mirrorSessionToFile(session, storageLogContext);
    }

    publishSession(session.id, buildPublicSession(session));
    span.end({
      status: session.status,
      turns: session.turns?.length || 0
    });
  } catch (error) {
    span.fail(error, {
      status: session.status,
      turns: session.turns?.length || 0
    });
    throw error;
  }
}

function buildPlanContext(session, normalizedResume) {
  return {
    role: session.role,
    job: session.job,
    notes: session.notes,
    normalizedResume,
    enableWebSearch: false,
    logContext: buildSessionLogContext(session)
  };
}

// 正式 plan 刷新放到后台执行，
// 避免首题延迟被“计划质量工作”拖慢。
function schedulePlanRefresh(sessionId, delayMs = null) {
  scheduleBackgroundJob({
    sessionId,
    kind: BACKGROUND_JOB_KIND.PLAN_REFRESH,
    delayMs
  });
}

async function refreshDraftPlanJob({ sessionId }) {
  const jobId = backgroundJobKey(sessionId, BACKGROUND_JOB_KIND.PLAN_REFRESH);
  const session = await loadSession(sessionId, {
    jobId
  });
  if (session.plan?.strategy !== "draft_plan") {
    return false;
  }

  if (session.status === "processing") {
    return createQuietBackgroundRetry(BACKGROUND_JOB_KIND.PLAN_REFRESH, 12000);
  }

  const deferDelayMs = resolveBackgroundProviderDeferDelay(session, BACKGROUND_JOB_KIND.PLAN_REFRESH, jobId);
  if (Number.isFinite(deferDelayMs)) {
    return createQuietBackgroundRetry(BACKGROUND_JOB_KIND.PLAN_REFRESH, deferDelayMs);
  }

  setSessionJobState(session, BACKGROUND_JOB_KIND.PLAN_REFRESH, startBackgroundJob(
    getSessionJobState(session, BACKGROUND_JOB_KIND.PLAN_REFRESH)
  ));
  await upsertBackgroundJobSnapshot({
    sessionId,
    kind: BACKGROUND_JOB_KIND.PLAN_REFRESH,
    job: getSessionJobState(session, BACKGROUND_JOB_KIND.PLAN_REFRESH)
  });
  await persistSession(session, {
    jobId
  });

  const { normalized } = await loadResumePackage();
  const refinedPlan = attachTopicIdsToPlan(
    await runWithBackgroundProviderLock(jobId, () => buildInterviewPlan(buildPlanContext(session, normalized))),
    normalized
  );

  const latest = await loadSession(sessionId, {
    jobId
  });
  if (latest.plan?.strategy !== "draft_plan") {
    return false;
  }

  if (latest.status === "processing") {
    return createQuietBackgroundRetry(BACKGROUND_JOB_KIND.PLAN_REFRESH, 15000);
  }

  latest.plan = refinedPlan;
  setSessionJobState(latest, BACKGROUND_JOB_KIND.PLAN_REFRESH, completeBackgroundJob(
    getSessionJobState(latest, BACKGROUND_JOB_KIND.PLAN_REFRESH)
  ));
  await upsertBackgroundJobSnapshot({
    sessionId,
    kind: BACKGROUND_JOB_KIND.PLAN_REFRESH,
    job: getSessionJobState(latest, BACKGROUND_JOB_KIND.PLAN_REFRESH)
  });
  syncPlanAndGraph(latest, normalized);
  recomputeDerivedState(latest);
  await persistSession(latest, {
    jobId
  });
  return false;
}

// report 生成属于冷路径工作，
// 面试结束时只负责排队，真正的生成放到后台执行。
function scheduleReportRefresh(sessionId, delayMs = null) {
  scheduleBackgroundJob({
    sessionId,
    kind: BACKGROUND_JOB_KIND.REPORT,
    delayMs
  });
}

async function refreshInterviewReportJob({ sessionId }) {
  const jobId = backgroundJobKey(sessionId, BACKGROUND_JOB_KIND.REPORT);
  const session = await loadSession(sessionId, {
    jobId
  });
  if (session.status !== "completed") {
    return false;
  }

  if (session.report && getSessionJobState(session, BACKGROUND_JOB_KIND.REPORT)?.status === "completed") {
    return false;
  }

  if (session.status === "processing" || session.currentRun?.status === "running") {
    return createQuietBackgroundRetry(BACKGROUND_JOB_KIND.REPORT, 10000);
  }

  const pendingThreadSummary = (session.topicThreads || []).some((thread) => {
    const status = getThreadSummaryJobState(thread)?.status || "idle";
    return status === "pending" || status === "running";
  });
  if (pendingThreadSummary) {
    return createQuietBackgroundRetry(BACKGROUND_JOB_KIND.REPORT, 5000);
  }

  const deferDelayMs = resolveBackgroundProviderDeferDelay(session, BACKGROUND_JOB_KIND.REPORT, jobId);
  if (Number.isFinite(deferDelayMs)) {
    return createQuietBackgroundRetry(BACKGROUND_JOB_KIND.REPORT, deferDelayMs);
  }

  setSessionJobState(session, BACKGROUND_JOB_KIND.REPORT, startBackgroundJob(
    getSessionJobState(session, BACKGROUND_JOB_KIND.REPORT)
  ));
  await upsertBackgroundJobSnapshot({
    sessionId,
    kind: BACKGROUND_JOB_KIND.REPORT,
    job: getSessionJobState(session, BACKGROUND_JOB_KIND.REPORT)
  });
  await persistSession(session, {
    jobId
  });

  const report = await runWithBackgroundProviderLock(jobId, () => generateInterviewReport(session));

  const latest = await loadSession(sessionId, {
    jobId
  });
  if (latest.status !== "completed") {
    return false;
  }

  latest.report = report;
  setSessionJobState(latest, BACKGROUND_JOB_KIND.REPORT, completeBackgroundJob(
    getSessionJobState(latest, BACKGROUND_JOB_KIND.REPORT)
  ));
  await upsertBackgroundJobSnapshot({
    sessionId,
    kind: BACKGROUND_JOB_KIND.REPORT,
    job: getSessionJobState(latest, BACKGROUND_JOB_KIND.REPORT)
  });
  await persistSession(latest, {
    jobId
  });
  return false;
}

function buildThreadSummary(session, thread) {
  const relatedTurns = (session.turns || []).filter((turn) => turn.threadId === thread.id);
  const latestTurn = relatedTurns.at(-1) || null;
  const keySignals = Array.from(new Set(relatedTurns.flatMap((turn) => turn.question?.expectedSignals || []))).slice(0, 4);
  const strengths = Array.from(new Set(relatedTurns.flatMap((turn) => turn.assessment?.strengths || []))).slice(0, 3);
  const risks = Array.from(new Set(relatedTurns.flatMap((turn) => turn.assessment?.risks || []))).slice(0, 3);

  return {
    summary: compactLines([
      `主题 ${thread.label || thread.category} 共完成 ${relatedTurns.length} 轮问答。`,
      thread.lastEvidenceSource ? `当前证据锚点：${thread.lastEvidenceSource}` : "",
      latestTurn?.assessment ? `最近一轮评分 ${latestTurn.assessment.score} / 5。` : "",
      strengths[0] ? `主要亮点：${strengths[0]}` : "",
      risks[0] ? `待补风险：${risks[0]}` : ""
    ]),
    summarySignals: keySignals,
    summaryRisks: risks,
    summaryUpdatedAt: nowIso()
  };
}

function scheduleThreadSummaryRefresh(sessionId, threadId, delayMs = 0) {
  if (!threadId) {
    return;
  }

  scheduleBackgroundJob({
    sessionId,
    kind: BACKGROUND_JOB_KIND.THREAD_SUMMARY,
    targetId: threadId,
    delayMs
  });
}

async function refreshThreadSummaryJob({ sessionId, targetId }) {
  const jobId = backgroundJobKey(sessionId, BACKGROUND_JOB_KIND.THREAD_SUMMARY, targetId);
  const session = await loadSession(sessionId, {
    jobId,
    threadId: targetId
  });
  if (session.status === "processing") {
    return createQuietBackgroundRetry(BACKGROUND_JOB_KIND.THREAD_SUMMARY, 3000);
  }

  const thread = getThreadById(session, targetId);
  if (!thread) {
    return false;
  }

  setThreadSummaryJobState(thread, startBackgroundJob(getThreadSummaryJobState(thread)));
  await upsertBackgroundJobSnapshot({
    sessionId,
    kind: BACKGROUND_JOB_KIND.THREAD_SUMMARY,
    targetId,
    job: getThreadSummaryJobState(thread)
  });
  await persistSession(session, {
    jobId,
    threadId: targetId
  });

  const latest = await loadSession(sessionId, {
    jobId,
    threadId: targetId
  });
  if (latest.status === "processing") {
    return createQuietBackgroundRetry(BACKGROUND_JOB_KIND.THREAD_SUMMARY, 3000);
  }

  const latestThread = getThreadById(latest, targetId);
  if (!latestThread) {
    return false;
  }

  const summary = buildThreadSummary(latest, latestThread);
  latestThread.summary = summary.summary;
  latestThread.summarySignals = summary.summarySignals;
  latestThread.summaryRisks = summary.summaryRisks;
  latestThread.summaryUpdatedAt = summary.summaryUpdatedAt;
  setThreadSummaryJobState(latestThread, completeBackgroundJob(getThreadSummaryJobState(latestThread)));
  await upsertBackgroundJobSnapshot({
    sessionId,
    kind: BACKGROUND_JOB_KIND.THREAD_SUMMARY,
    targetId,
    job: getThreadSummaryJobState(latestThread)
  });
  await persistSession(latest, {
    jobId,
    threadId: targetId
  });
  return false;
}

function scheduleBackgroundJob({ sessionId, kind, targetId = null, delayMs = null, quiet = false }) {
  const key = backgroundJobKey(sessionId, kind, targetId);
  const resolvedDelayMs = resolveBackgroundJobDelay(kind, delayMs);
  const logger = createSessionLogger(sessionId, {
    jobId: key,
    threadId: targetId || undefined
  });
  if (pendingBackgroundJobs.has(key)) {
    if (!quiet) {
      logger.debug("background_job.duplicate_ignored", {
        jobKind: kind,
        targetId,
        delayMs: resolvedDelayMs
      });
    }
    return;
  }

  pendingBackgroundJobs.add(key);
  if (!quiet) {
    logger.info("background_job.queued", {
      jobKind: kind,
      targetId,
      delayMs: resolvedDelayMs
    });
  }
  upsertBackgroundJobSnapshotInBackground({
    sessionId,
    kind,
    targetId,
    delayMs: resolvedDelayMs,
    job: queueBackgroundJob(createBackgroundJobState(kind, targetId))
  });

  if (shouldPersistSessionsToDb()) {
    if (backgroundJobWorkerStarted) {
      scheduleBackgroundJobWorkerPoll(0);
    }
    return;
  }

  setTimeout(() => {
    void runBackgroundJob({ sessionId, kind, targetId });
  }, resolvedDelayMs);
}

async function runBackgroundJob({
  sessionId,
  kind,
  targetId = null,
  leasedJob = null,
  workerId = BACKGROUND_JOB_WORKER_ID,
  source = "timer"
}) {
  const key = leasedJob?.jobKey || backgroundJobKey(sessionId, kind, targetId);
  const logger = createSessionLogger(sessionId, {
    jobId: key,
    threadId: targetId || undefined
  });
  const leased = leasedJob || await leaseBackgroundJob(key, workerId, {
    leaseMs: BACKGROUND_JOB_LEASE_MS
  });
  if (!leased) {
    pendingBackgroundJobs.delete(key);
    return;
  }

  const heartbeat = startBackgroundJobLeaseHeartbeat(key, workerId);
  let span = null;
  try {
    if (isSessionScopedBackgroundJob(kind) && (isProviderBackedBackgroundJob(kind) || kind === BACKGROUND_JOB_KIND.THREAD_SUMMARY)) {
      const session = await loadSession(sessionId, {
        jobId: key,
        threadId: targetId || undefined
      });
      const preflight = resolveBackgroundJobPreflight(session, kind, targetId, key);
      if (preflight?.shouldSkip) {
        clearInterval(heartbeat);
        await completeBackgroundJobLease(key, workerId, {
          source,
          skipped: true,
          reason: "preflight_skip"
        });
        logger.info("background_job.skipped", {
          jobKind: kind,
          targetId,
          source,
          workerId,
          reason: "preflight_skip",
          ...backgroundJobAttemptMeta(leased)
        });
        pendingBackgroundJobs.delete(key);
        return;
      }
      if (preflight?.shouldRetry) {
        clearInterval(heartbeat);
        const failedLease = await failBackgroundJobLease(key, workerId, {
          retryDelayMs: preflight.retryDelayMs,
          lastError: "preflight_retry",
          result: {
            source,
            quiet: Boolean(preflight.quiet)
          }
        });
        if (failedLease?.status === "pending") {
          if (!preflight.quiet) {
            logger.info("background_job.retry_scheduled", {
              jobKind: kind,
              targetId,
              source,
              workerId,
              retryDelayMs: preflight.retryDelayMs,
              reason: "preflight_retry",
              ...backgroundJobAttemptMeta(failedLease)
            });
          }
        } else {
          logger.error("background_job.failed", new Error("Background job retry budget exhausted during preflight."), {
            jobKind: kind,
            targetId,
            source,
            workerId,
            reason: "preflight_retry_exhausted",
            ...backgroundJobAttemptMeta(failedLease || leased)
          });
        }
        pendingBackgroundJobs.delete(key);
        return;
      }
    }

    const runningLease = await startBackgroundJobLease(key, workerId).catch(() => null);
    logger.info("background_job.started", {
      jobKind: kind,
      targetId,
      source,
      workerId,
      scheduledLagMs: backgroundJobScheduledLagMs(runningLease || leased),
      ...backgroundJobAttemptMeta(runningLease || leased)
    });

    span = logger.startSpan("background_job", {
      jobKind: kind,
      targetId
    });
    let retryState = {
      shouldRetry: false,
      retryDelayMs: null,
      quiet: false
    };

    let result = false;
    switch (kind) {
      case BACKGROUND_JOB_KIND.PLAN_REFRESH:
        result = await refreshDraftPlanJob({ sessionId });
        break;
      case BACKGROUND_JOB_KIND.REPORT:
        result = await refreshInterviewReportJob({ sessionId });
        break;
      case BACKGROUND_JOB_KIND.THREAD_SUMMARY:
        result = await refreshThreadSummaryJob({ sessionId, targetId });
        break;
      case EMBEDDING_JOB_KIND:
        result = await syncKnowledgeEmbeddingById(targetId, {
          recordJobSnapshot: false,
          throwOnUnavailable: true
        });
        break;
      default:
        break;
    }
    retryState = typeof result === "object" && result
      ? {
          shouldRetry: Boolean(result.shouldRetry),
          retryDelayMs: Number.isFinite(result.retryDelayMs) ? Number(result.retryDelayMs) : null,
          quiet: Boolean(result.quiet)
        }
      : {
          shouldRetry: Boolean(result),
          retryDelayMs: null,
      quiet: false
    };
    span.end({
      jobKind: kind,
      targetId,
      shouldRetry: retryState.shouldRetry
    });
    if (retryState.shouldRetry) {
      const retryDelayMs = retryState.retryDelayMs ?? getBackgroundJobRetryDelay(kind);
      const failedLease = await failBackgroundJobLease(key, workerId, {
        retryDelayMs,
        lastError: "retry_requested",
        result: {
          source,
          quiet: Boolean(retryState.quiet)
        }
      });
      if (failedLease?.status === "pending") {
        if (!retryState.quiet) {
          logger.info("background_job.retry_scheduled", {
            jobKind: kind,
            targetId,
            source,
            workerId,
            retryDelayMs,
            reason: "job_requested_retry",
            ...backgroundJobAttemptMeta(failedLease)
          });
        }
      } else {
        logger.error("background_job.failed", new Error("Background job retry budget exhausted."), {
          jobKind: kind,
          targetId,
          source,
          workerId,
          reason: "retry_budget_exhausted",
          ...backgroundJobAttemptMeta(failedLease || leased)
        });
      }
    } else {
      const completedLease = await completeBackgroundJobLease(key, workerId, {
        source,
        targetId,
        ...(kind === EMBEDDING_JOB_KIND && result
          ? {
              documentId: targetId,
              embeddingModel: result.embeddingModel,
              contentHash: result.contentHash
            }
          : {})
      });
      logger.info("background_job.completed", {
        jobKind: kind,
        targetId,
        source,
        workerId,
        ...backgroundJobAttemptMeta(completedLease || leased)
      });
    }
  } catch (error) {
    if (span) {
      span.fail(error, {
        jobKind: kind,
        targetId
      });
    }

    if (isMissingSessionError(error)) {
      clearInterval(heartbeat);
      const completedLease = await completeBackgroundJobLease(key, workerId, {
        source,
        targetId,
        skipped: true,
        reason: "session_missing"
      }).catch(() => null);
      logger.warn("background_job.skipped", {
        jobKind: kind,
        targetId,
        source,
        workerId,
        reason: "session_missing",
        ...backgroundJobAttemptMeta(completedLease || leased)
      });
      return;
    }

    if (isSessionScopedBackgroundJob(kind) && sessionId) {
      try {
        const latest = await loadSession(sessionId, {
          jobId: key,
          threadId: targetId || undefined
        });
        if (kind === BACKGROUND_JOB_KIND.THREAD_SUMMARY) {
          const thread = getThreadById(latest, targetId);
          if (thread) {
            setThreadSummaryJobState(thread, failBackgroundJob(getThreadSummaryJobState(thread), error));
            await upsertBackgroundJobSnapshot({
              sessionId,
              kind,
              targetId,
              job: getThreadSummaryJobState(thread)
            });
            await persistSession(latest, {
              jobId: key,
              threadId: targetId || undefined
            });
          }
        } else {
          setSessionJobState(latest, kind, failBackgroundJob(getSessionJobState(latest, kind), error));
          await upsertBackgroundJobSnapshot({
            sessionId,
            kind,
            targetId,
            job: getSessionJobState(latest, kind)
          });
          await persistSession(latest, {
            jobId: key,
            threadId: targetId || undefined
          });
        }
      } catch (persistError) {
        logger.error("background_job.persist_failure", persistError, {
          jobKind: kind,
          targetId
        });
      }
    }
    await failBackgroundJobLease(key, workerId, {
      lastError: error.message,
      result: {
        source,
        targetId
      }
    }).then((failedLease) => {
      logger.error("background_job.failed", error, {
        jobKind: kind,
        targetId,
        source,
        workerId,
        ...backgroundJobAttemptMeta(failedLease || leased)
      });
    }).catch(() => {});
  } finally {
    clearInterval(heartbeat);
    pendingBackgroundJobs.delete(key);
  }
}

async function runSessionLifecycle(sessionId, handler) {
  if (inFlightRuns.has(sessionId)) {
    createSessionLogger(sessionId).warn("run.lifecycle_skipped", {
      reason: "already_inflight"
    });
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

function applyQuestionDecisionContext(question, decision, stage) {
  question.stageId ||= stage?.id || "";
  question.topicCategory ||= decision.targetTopicCategory || stage?.category || "system_design";
  question.topicId ||= decision.targetTopicId || null;
  question.topicLabel ||= decision.topicLabel || decision.targetTopicLabel || "";
  if (!question.evidenceSource && decision.targetEvidenceSource) {
    question.evidenceSource = decision.targetEvidenceSource;
  }
}

// 启动链路现在优先优化首题速度：
// observe -> 本地策略 -> 出题 -> 后台补正式 plan。
async function processStartRun(sessionId) {
  await runSessionLifecycle(sessionId, async () => {
    const [{ normalized }, session] = await Promise.all([
      loadResumePackage(),
      loadSession(sessionId, buildSessionLogContext(sessionId))
    ]);
    const logger = createSessionLogger(session);
    let phaseSpan = null;

    try {
      logger.info("run.started", {
        runKind: session.currentRun?.kind || "start"
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "observe",
        runKind: session.currentRun?.kind || "start"
      });
      syncPlanAndGraph(session, normalized);
      recomputeDerivedState(session);
      setRunPhase(session.currentRun, "observe", "收集候选人画像、岗位要求和当前阶段目标。");
      session.currentRun.debug.observe = buildObservationForStart(session, normalized);
      publishSessionSnapshot(session);
      phaseSpan.end({
        phase: "observe",
        coverageCategoryCount: Object.keys(session.coverage || {}).length
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "deliberate",
        runKind: session.currentRun?.kind || "start"
      });
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
      phaseSpan.end({
        phase: "deliberate",
        shouldSearch: Boolean(session.currentRun.debug.deliberation.shouldSearch)
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "decide",
        runKind: session.currentRun?.kind || "start"
      });
      setRunPhase(session.currentRun, "decide", "决定初始动作、线程模式和搜索策略。");
      const decision = {
        action: "ask_new_question",
        shouldSearch: Boolean(session.enableWebSearch && session.currentRun.debug.deliberation.shouldSearch),
        rationale: session.currentRun.debug.deliberation.rationale,
        threadId: null,
        topicLabel: session.currentRun.debug.deliberation.topicLabel,
        targetStageIndex: session.currentRun.debug.deliberation.targetStageIndex,
        targetTopicId: session.currentRun.debug.deliberation.targetTopicId || null,
        targetTopicLabel: session.currentRun.debug.deliberation.targetTopicLabel || session.currentRun.debug.deliberation.topicLabel,
        targetTopicCategory: session.currentRun.debug.deliberation.targetTopicCategory || null,
        targetEvidenceSource: session.currentRun.debug.deliberation.targetEvidenceSource || null
      };
      session.currentRun.debug.decision = decision;
      publishSessionSnapshot(session);
      phaseSpan.end({
        phase: "decide",
        action: decision.action,
        shouldSearch: decision.shouldSearch
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "execute",
        runKind: session.currentRun?.kind || "start"
      });
      setRunPhase(session.currentRun, "execute", decision.shouldSearch ? "生成问题前启用联网搜索。" : "直接生成第一道问题。");
      publishSessionSnapshot(session);
      applyDecisionStageTarget(session, decision);
      const stage = getCurrentStage(session);
      const question = await buildQuestionFromBank({
        session,
        stage,
        normalizedResume: normalized,
        decision
      }) || await generateInterviewQuestion({
        session,
        stage,
        normalizedResume: normalized,
        enableWebSearch: decision.shouldSearch,
        decision,
        logContext: buildSessionLogContext(session)
      });
      recordRunStrategy(session.currentRun, "execute", question._providerMeta);
      applyQuestionDecisionContext(question, decision, stage);
      const thread = upsertThreadForDecision(session, decision, question);
      question.threadId = thread.id;
      question.topicId ||= thread.topicId;
      session.nextQuestion = question;
      session.currentThreadId = thread.id;
      recomputeDerivedState(session);
      session.currentRun.debug.execution = {
        summary: "第一道问题已生成。",
        question,
        modelStrategy: buildModelStrategyInfo(question._providerMeta)
      };
      phaseSpan.end({
        phase: "execute",
        threadId: thread.id,
        topicId: question.topicId || null
      });

      session.status = "active";
      phaseSpan = logger.startSpan("run.phase", {
        phase: "feedback",
        runKind: session.currentRun?.kind || "start"
      });
      setRunPhase(session.currentRun, "feedback", "写回会话状态并等待候选人回答。");
      session.currentRun.debug.feedback = {
        summary: "启动轮已完成，当前等待候选人作答。"
      };
      completeRun(session.currentRun);
      phaseSpan.end({
        phase: "feedback",
        status: session.status
      });
      await persistSession(session, buildSessionLogContext(session));
      await recordAskedQuestionSafely(session.nextQuestion, session);
      logger.info("run.completed", {
        runKind: session.currentRun?.kind || "start",
        durationMs: session.currentRun?.durationMs || 0,
        status: session.status
      });
      schedulePlanRefresh(session.id);
    } catch (error) {
      phaseSpan?.fail(error, {
        phase: session.currentRun?.phase || "unknown",
        runKind: session.currentRun?.kind || "start"
      });
      session.status = "failed";
      failRun(session.currentRun, error);
      await persistSession(session, buildSessionLogContext(session));
      logger.error("run.failed", error, {
        runKind: session.currentRun?.kind || "start",
        durationMs: session.currentRun?.durationMs || 0
      });
    }
  });
}

// 回答链路当前仍是串行执行，
// 但在第二阶段之后，deliberate 已经从模型调用切成了本地策略。
async function processAnswerRun(sessionId, turnIndex) {
  await runSessionLifecycle(sessionId, async () => {
    const [{ normalized }, session] = await Promise.all([
      loadResumePackage(),
      loadSession(sessionId, buildSessionLogContext(sessionId, { turnIndex }))
    ]);
    const turn = session.turns.find((item) => item.index === turnIndex);
    const logger = createSessionLogger(session, {
      turnIndex
    });
    let phaseSpan = null;

    try {
      logger.info("run.started", {
        runKind: session.currentRun?.kind || "answer"
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "observe",
        runKind: session.currentRun?.kind || "answer",
        turnIndex
      });
      syncPlanAndGraph(session, normalized);
      recomputeDerivedState(session);
      setRunPhase(session.currentRun, "observe", "分析用户回答、当前线程和覆盖情况。");
      publishSessionSnapshot(session);
      const turnAnalysis = await analyzeInterviewTurn({
        session,
        stage: getCurrentStage(session),
        question: turn.question,
        answer: turn.answer,
        normalizedResume: normalized,
        logContext: buildSessionLogContext(session, {
          turnIndex,
          threadId: turn.threadId || undefined
        })
      });
      const assessment = turnAnalysis.assessment;
      recordRunStrategy(session.currentRun, "observe", turnAnalysis._providerMeta);
      turn.assessment = assessment;
      await recordQuestionOutcome(turn.question?.questionId || turn.question?.id || null, assessment, {
        followupCount: assessment?.followupNeeded ? 1 : 0
      });
      const reviewItem = await syncReviewArtifactsForTurn(session, turn);
      turn.processing = true;
      session.currentRun.debug.observe = {
        ...buildObservationForAnswer(session, turn),
        preliminaryAssessment: assessment,
        questionDrafts: {
          followupQuestion: turnAnalysis.followupQuestion || null,
          nextTopicQuestion: turnAnalysis.nextTopicQuestion || null
        },
        modelStrategy: buildModelStrategyInfo(turnAnalysis._providerMeta)
      };
      recomputeDerivedState(session);
      publishSessionSnapshot(session);
      phaseSpan.end({
        phase: "observe",
        score: assessment.score,
        followupNeeded: Boolean(assessment.followupNeeded)
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "deliberate",
        runKind: session.currentRun?.kind || "answer",
        turnIndex
      });
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
      phaseSpan.end({
        phase: "deliberate",
        action: session.currentRun.debug.deliberation.action,
        shouldSearch: Boolean(session.currentRun.debug.deliberation.shouldSearch)
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "decide",
        runKind: session.currentRun?.kind || "answer",
        turnIndex
      });
      setRunPhase(session.currentRun, "decide", "提交下一步动作。");
      const decision = {
        action: session.currentRun.debug.deliberation.action,
        shouldSearch: Boolean(session.enableWebSearch && session.currentRun.debug.deliberation.shouldSearch),
        rationale: session.currentRun.debug.deliberation.rationale,
        threadId: session.currentRun.debug.deliberation.threadMode === "continue" ? turn.threadId : null,
        topicLabel: session.currentRun.debug.deliberation.topicLabel,
        targetStageIndex: session.currentRun.debug.deliberation.targetStageIndex,
        targetTopicId: session.currentRun.debug.deliberation.targetTopicId || turn.question?.topicId || null,
        targetTopicLabel: session.currentRun.debug.deliberation.targetTopicLabel || session.currentRun.debug.deliberation.topicLabel,
        targetTopicCategory: session.currentRun.debug.deliberation.targetTopicCategory || turn.question?.topicCategory || null,
        targetEvidenceSource: session.currentRun.debug.deliberation.targetEvidenceSource || turn.question?.evidenceSource || null
      };
      session.currentRun.debug.decision = decision;
      publishSessionSnapshot(session);
      phaseSpan.end({
        phase: "decide",
        action: decision.action,
        shouldSearch: decision.shouldSearch
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "execute",
        runKind: session.currentRun?.kind || "answer",
        turnIndex
      });
      setRunPhase(session.currentRun, "execute", decision.action === "end_interview" ? "生成最终复盘报告。" : "根据决策生成下一步问题。");
      publishSessionSnapshot(session);

      if (decision.action === "end_interview") {
        session.status = "completed";
        session.nextQuestion = null;
        session.report = null;
        session.reportJob = queueBackgroundJob(session.reportJob || createBackgroundJobState(BACKGROUND_JOB_KIND.REPORT));
        session.currentRun.debug.execution = {
          modelStrategy: null,
          summary: "面试已结束，完整复盘正在后台生成。",
          reportJob: session.reportJob
        };
      } else {
        applyDecisionStageTarget(session, decision);

        const stage = getCurrentStage(session);
        const executionPlan = await pickQuestionExecutionPath({
          decision,
          turnAnalysis,
          session,
          stage,
          normalizedResume: normalized,
          turn,
          reviewItem
        });
        const question = executionPlan.question || await generateInterviewQuestion({
          session,
          stage,
          normalizedResume: normalized,
          enableWebSearch: decision.shouldSearch,
          decision,
          logContext: buildSessionLogContext(session, {
            turnIndex,
            threadId: decision.threadId || turn.threadId || undefined
          })
        });
        recordRunStrategy(session.currentRun, "execute", question._providerMeta);
        applyQuestionDecisionContext(question, decision, stage);
        const thread = upsertThreadForDecision(session, decision, question);
        question.threadId = thread.id;
        question.topicId ||= thread.topicId;
        session.currentThreadId = thread.id;
        session.nextQuestion = question;
        recomputeDerivedState(session);
        session.currentRun.debug.execution = {
          modelStrategy: buildModelStrategyInfo(question._providerMeta),
          source: executionPlan.question ? executionPlan.source : "live_question_call",
          summary: "下一道问题已生成。",
          question
        };
      }
      phaseSpan.end({
        phase: "execute",
        action: decision.action,
        status: session.status
      });

      phaseSpan = logger.startSpan("run.phase", {
        phase: "feedback",
        runKind: session.currentRun?.kind || "answer",
        turnIndex
      });
      setRunPhase(session.currentRun, "feedback", "回写线程状态、覆盖率和回合结果。");
      turn.processing = false;
      finalizeThreadAfterAnswer(session, turn, session.currentRun.debug.decision);
      if (session.status !== "completed") {
        session.status = "active";
      } else {
        session.currentThreadId = null;
      }
      recomputeDerivedState(session);
      const settledThread = getThreadById(session, turn.threadId);
      if (settledThread) {
        setThreadSummaryJobState(settledThread, queueBackgroundJob(
          getThreadSummaryJobState(settledThread) || createBackgroundJobState(BACKGROUND_JOB_KIND.THREAD_SUMMARY, settledThread.id)
        ));
      }
      session.currentRun.debug.feedback = {
        summary: session.status === "completed"
          ? "本轮处理结束，整场面试已完成。"
          : "本轮处理结束，等待候选人回答下一题。"
      };
      completeRun(session.currentRun);
      phaseSpan.end({
        phase: "feedback",
        status: session.status
      });
      await persistSession(session, buildSessionLogContext(session, { turnIndex }));
      await recordAskedQuestionSafely(session.nextQuestion, session, { turnIndex });
      logger.info("run.completed", {
        runKind: session.currentRun?.kind || "answer",
        durationMs: session.currentRun?.durationMs || 0,
        status: session.status
      });
      scheduleThreadSummaryRefresh(session.id, turn.threadId);
      if (session.status === "completed") {
        scheduleReportRefresh(session.id);
      }
    } catch (error) {
      phaseSpan?.fail(error, {
        phase: session.currentRun?.phase || "unknown",
        runKind: session.currentRun?.kind || "answer",
        turnIndex
      });
      session.status = "failed";
      if (turn) {
        turn.processing = false;
      }
      failRun(session.currentRun, error);
      await persistSession(session, buildSessionLogContext(session, { turnIndex }));
      logger.error("run.failed", error, {
        runKind: session.currentRun?.kind || "answer",
        durationMs: session.currentRun?.durationMs || 0,
        turnIndex
      });
    }
  });
}

export async function getBootstrapData() {
  const [resumePackage, catalog, , templates] = await Promise.all([
    loadResumePackage(),
    loadInterviewCatalog(),
    ensureQuestionBankSeeded(),
    listInterviewTemplates()
  ]);
  const { normalized } = resumePackage;

  return {
    candidate: {
      ready: Boolean(resumePackage.available),
      workspacePath: resumePackage.directory,
      missingFiles: resumePackage.missingFiles,
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
  const [resumePackage, baseRole, baseJob] = await Promise.all([
    loadResumePackage(),
    findRole(resolvedRoleId),
    findJob(resolvedJobId),
    ensureQuestionBankSeeded()
  ]);
  const { normalized } = resumePackage;

  if (!resumePackage.available) {
    const error = new Error(
      `Resume package is not initialized at ${resumePackage.directory}. Missing files: ${resumePackage.missingFiles.join(", ")}`
    );
    error.code = "RESUME_PACKAGE_MISSING";
    throw error;
  }

  if (!baseRole) {
    throw new Error(`Unknown role: ${resolvedRoleId}`);
  }

  if (!baseJob) {
    throw new Error(`Unknown job: ${resolvedJobId}`);
  }

  const role = buildTemplateDrivenRole(baseRole, resolvedTemplate);
  const job = buildTemplateDrivenJob(baseJob, resolvedTemplate);
  const mergedNotes = buildTemplateNotes(resolvedTemplate, notes);

  const plan = attachTopicIdsToPlan(buildDraftPlan(job, role, normalized), normalized);

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
    topicGraph: buildSessionTopicGraph(plan, normalized),
    turns: [],
    planJob: queueBackgroundJob(createBackgroundJobState(BACKGROUND_JOB_KIND.PLAN_REFRESH)),
    report: null,
    reportJob: createBackgroundJobState(BACKGROUND_JOB_KIND.REPORT),
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

  recomputeDerivedState(session);
  const logger = createSessionLogger(session);
  logger.info("session.created", {
    roleId: resolvedRoleId,
    catalogJobId: resolvedJobId,
    enableWebSearch: Boolean(enableWebSearch),
    hasTemplate: Boolean(resolvedTemplate)
  });
  await persistSession(session, buildSessionLogContext(session));
  void processStartRun(session.id);
  return buildPublicSession(session);
}

export async function listInterviewSessions({ status = null, limit = 100 } = {}) {
  const sessions = await listSessions();
  return sessions
    .filter((session) => !status || session.status === status)
    .slice(0, Math.max(1, Number(limit) || 100))
    .map((session) => ({
      id: session.id,
      status: session.status,
      version: session.version ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      role: session.role || null,
      job: session.job || null,
      interviewTemplate: session.interviewTemplate || null,
      provider: session.provider || null,
      stageIndex: session.stageIndex ?? 0,
      turnCount: session.turnCount ?? (session.turns?.length || 0),
      currentRun: session.currentRun || null,
      currentThreadId: session.currentThreadId || null,
      currentThreadLabel: session.readModelSummary?.currentThread?.label || null,
      currentStage: session.readModelSummary?.currentStage || null,
      reportReady: session.reportReady ?? Boolean(session.report),
      readModelSummary: session.readModelSummary || null,
      backgroundJobSummary: session.readModelSummary?.backgroundJobs || {
        pendingCount: 0,
        runningCount: 0,
        failedCount: 0
      },
      backgroundJobs: buildBackgroundJobsView(session)
    }));
}

export async function getInterviewSession(sessionId) {
  return buildPublicSession(await loadSession(sessionId));
}

export async function answerInterviewQuestion(sessionId, answer) {
  const session = await loadSession(sessionId, buildSessionLogContext(sessionId));

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

  recomputeDerivedState(session);
  createSessionLogger(session, {
    turnIndex: pendingTurn.index,
    threadId: pendingTurn.threadId || undefined
  }).info("answer.accepted", {
    answerChars: String(answer || "").length,
    turnIndex: pendingTurn.index
  });
  await persistSession(session, buildSessionLogContext(session, {
    turnIndex: pendingTurn.index,
    threadId: pendingTurn.threadId || undefined
  }));
  void processAnswerRun(session.id, pendingTurn.index);
  return buildPublicSession(session);
}

function collectPendingBackgroundWorkFromSessions(sessions) {
  let pendingPlans = [];
  let pendingReports = [];
  let pendingThreadSummaries = [];

  for (const session of sessions) {
    if (
      session.plan?.strategy === "draft_plan" &&
      ["pending", "running"].includes(session.planJob?.status || "idle")
    ) {
      pendingPlans.push({ id: session.id });
    }

    if (
      session.status === "completed" &&
      !session.report &&
      ["pending", "running"].includes(session.reportJob?.status || "idle")
    ) {
      pendingReports.push({ id: session.id });
    }

    for (const thread of session.topicThreads || []) {
      if (["pending", "running"].includes(thread.summaryJob?.status || "idle")) {
        pendingThreadSummaries.push({
          sessionId: session.id,
          threadId: thread.id
        });
      }
    }
  }

  return {
    pendingPlans,
    pendingReports,
    pendingThreadSummaries
  };
}

// 进程启动后只恢复那些已经持久化为 active 的运行中会话。
export async function resumePendingSessions() {
  const pending = await listResumableSessions();
  let pendingPlans = [];
  let pendingReports = [];
  let pendingThreadSummaries = [];
  let resumableDbJobCount = 0;

  if (shouldPersistSessionsToDb()) {
    try {
      const resumableJobs = await listResumableBackgroundJobs({
        kinds: [
          BACKGROUND_JOB_KIND.PLAN_REFRESH,
          BACKGROUND_JOB_KIND.REPORT,
          BACKGROUND_JOB_KIND.THREAD_SUMMARY,
          EMBEDDING_JOB_KIND
        ],
        statuses: ["pending", "running", "leased"],
        limit: 500
      });
      resumableDbJobCount = resumableJobs.length;

      pendingPlans = [];
      pendingReports = [];
      pendingThreadSummaries = [];
    } catch (error) {
      if (!shouldPersistSessionsToFile()) {
        throw error;
      }

      ({
        pendingPlans,
        pendingReports,
        pendingThreadSummaries
      } = collectPendingBackgroundWorkFromSessions(await listSessions()));
    }
  } else {
    ({
      pendingPlans,
      pendingReports,
      pendingThreadSummaries
    } = collectPendingBackgroundWorkFromSessions(await listSessions()));
  }

  for (const session of pending) {
    if (session.currentRun?.kind === "start") {
      void processStartRun(session.id);
      continue;
    }

    if (session.currentRun?.kind === "answer") {
      const turnIndex = Number(session.resumableTurnIndex || session.currentRun?.payload?.turnIndex) || session.turns.at(-1)?.index;
      if (turnIndex) {
        void processAnswerRun(session.id, turnIndex);
      }
    }
  }

  if (!shouldPersistSessionsToDb()) {
    for (const session of pendingReports) {
      scheduleReportRefresh(session.id, session.delayMs);
    }

    for (const session of pendingPlans) {
      schedulePlanRefresh(session.id, session.delayMs);
    }

    for (const job of pendingThreadSummaries) {
      scheduleThreadSummaryRefresh(job.sessionId, job.threadId, job.delayMs);
    }
  }

  return pending.length + resumableDbJobCount + pendingPlans.length + pendingReports.length + pendingThreadSummaries.length;
}
