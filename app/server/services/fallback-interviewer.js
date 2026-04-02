import { getQuestionLibrary } from "./question-bank.js";

function sample(list, offset = 0) {
  if (!list.length) {
    return null;
  }
  return list[offset % list.length];
}

function pickEvidence(topic, normalizedResume) {
  const sourceRef = topic?.sourceRefs?.[0];
  if (!sourceRef) {
    return "简历整体技能摘要";
  }

  if (sourceRef.sourceType === "experience") {
    const experience = normalizedResume.experiences.find((item) => item.id === sourceRef.sourceId);
    return experience ? `${experience.company} / ${experience.role}` : sourceRef.sourceId;
  }

  if (sourceRef.sourceType === "project") {
    const project = normalizedResume.projects.find((item) => item.slug === sourceRef.sourceId);
    return project ? project.title : sourceRef.sourceId;
  }

  return sourceRef.sourceId;
}

function stageTitle(category) {
  const map = {
    language_fundamentals: "语言基础",
    game_algorithms: "游戏算法",
    game_framework: "游戏框架",
    system_design: "系统设计",
    ai_agent_design: "AI Agent 设计"
  };
  return map[category] || category;
}

export function createFallbackPlan({ role, job, normalizedResume, notes }) {
  const recentExperienceTopics = normalizedResume.experiences.slice(0, 2).map((experience) => ({
    label: `${experience.company} / ${experience.role}`,
    evidence: [experience.summary, ...(experience.bullets || []).slice(0, 2)],
    sourceRefs: [{ sourceType: "experience", sourceId: experience.id }]
  }));

  const stages = [
    {
      id: "project-warmup",
      category: "game_framework",
      title: "项目切入",
      goal: "先从最近和最强的项目切入，校准真实负责范围。",
      promptHint: "优先结合最近经历中的平台、蓝图、技能系统和工具链内容。"
    }
  ];

  for (const area of job.questionAreas || []) {
    stages.push({
      id: `area-${area}`,
      category: area,
      title: stageTitle(area),
      goal: `围绕 ${stageTitle(area)} 进行有证据的技术追问。`,
      promptHint: `角色偏好：${role.summary}`
    });
  }

  const topicsByCategory = Object.groupBy(normalizedResume.topicInventory, (topic) => topic.category);
  return {
    strategy: "fallback",
    summary: notes
      ? `${role.name} 面向 ${job.title} 的分阶段面试计划，附加要求：${notes}`
      : `${role.name} 面向 ${job.title} 的分阶段面试计划`,
    targetTurnCount: Math.max(6, Math.min(10, stages.length + 2)),
    stages: stages.map((stage) => ({
      ...stage,
      targetTopics: (
        stage.id === "project-warmup"
          ? recentExperienceTopics
          : (topicsByCategory[stage.category] || []).slice(0, 3).map((topic) => ({
              label: topic.label,
              evidence: topic.evidence.slice(0, 2),
              sourceRefs: topic.sourceRefs
            }))
      )
    }))
  };
}

export function createFallbackQuestion({ session, stage, normalizedResume }) {
  const templates = getQuestionLibrary(stage.category);
  const topic = stage.targetTopics?.[session.turns.length % Math.max(stage.targetTopics.length || 1, 1)];
  const evidenceSource = pickEvidence(topic, normalizedResume);
  const baseTemplate = stage.id === "project-warmup"
    ? `你最近在 ${evidenceSource} 负责了哪些最核心的系统？请挑一个你真正主导设计的模块，按“背景、约束、方案、权衡、验证方式”展开。`
    : sample(templates, session.turns.length) ||
    `请围绕 ${stage.title} 说明你最能体现这项能力的一段实际经历，包括背景、你的职责、关键权衡和结果。`;
  const prefix = session.turns.length === 0
    ? "先从你最相关的一段经历切入。"
    : `接下来我想看你在 ${stage.title} 上的真实深度。`;

  return {
    strategy: "fallback",
    stageId: stage.id,
    topicCategory: stage.category,
    evidenceSource,
    expectedSignals: [
      "是否能够说清楚背景和约束",
      "是否能够说明自己的真实职责",
      "是否能够解释设计权衡"
    ],
    rationale: stage.goal,
    text: `${prefix}${baseTemplate} 请尽量结合 ${evidenceSource} 来回答。`
  };
}

export function createFallbackAssessment({ answer, question }) {
  const length = answer.trim().length;
  const mentionsTradeoff = /(因为|权衡|取舍|原因|边界|约束)/.test(answer);
  const mentionsEvidence = /(项目|系统|模块|实现|负责|场景|指标|性能|工具)/.test(answer);

  let score = 2;
  if (length > 80) {
    score += 1;
  }
  if (mentionsTradeoff) {
    score += 1;
  }
  if (mentionsEvidence) {
    score += 1;
  }

  return {
    strategy: "fallback",
    score: Math.min(score, 5),
    confidence: length > 80 ? "medium" : "low",
    strengths: [
      mentionsEvidence ? "回答中包含一定项目证据。" : "回答覆盖了问题主题。"
    ],
    risks: [
      mentionsTradeoff ? "仍需确认细节是否经得起追问。" : "缺少明确的权衡、边界或失败处理说明。"
    ],
    followupNeeded: !mentionsTradeoff || !mentionsEvidence,
    suggestedFollowup: "你刚才提到的方案里，最关键的设计权衡是什么？如果重来一次，你会保留和修改哪些部分？",
    evidenceUsed: [question.evidenceSource]
  };
}

export function createFallbackReport(session) {
  const groupedScores = {};
  for (const turn of session.turns) {
    const category = turn.question.topicCategory;
    if (!groupedScores[category]) {
      groupedScores[category] = [];
    }
    groupedScores[category].push(turn.assessment.score);
  }

  return {
    generatedBy: "fallback",
    summary: `完成 ${session.turns.length} 轮问答，当前实现使用规则化评估作为离线兜底。`,
    dimensions: Object.entries(groupedScores).map(([category, scores]) => ({
      category,
      averageScore: Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2))
    })),
    strengths: session.turns
      .filter((turn) => turn.assessment.score >= 4)
      .slice(0, 3)
      .map((turn) => `${turn.question.topicCategory}：${turn.assessment.strengths[0]}`),
    risks: session.turns
      .filter((turn) => turn.assessment.followupNeeded)
      .slice(0, 3)
      .map((turn) => `${turn.question.topicCategory}：${turn.assessment.risks[0]}`),
    nextSteps: session.turns
      .filter((turn) => turn.assessment.followupNeeded)
      .slice(0, 3)
      .map((turn) => turn.assessment.suggestedFollowup)
  };
}

export function createFallbackDeliberation({
  mode,
  session,
  stage,
  turn,
  assessment,
  policy
}) {
  if (mode === "start") {
    const wantsFreshContext = /最新|趋势|生态|agent|ai/i.test(`${session.notes} ${session.job.title} ${session.role.name}`);
    return {
      strategy: "fallback",
      action: "ask_new_question",
      threadMode: "new",
      shouldSearch: Boolean(session.enableWebSearch && wantsFreshContext && stage?.category === "ai_agent_design"),
      rationale: "先建立候选人当前项目与岗位要求之间的主线映射，再决定是否引入外部上下文。",
      topicLabel: stage?.title || "项目切入",
      stopCurrentThread: false
    };
  }

  const activeThread = session.topicThreads?.find((item) => item.id === turn.threadId) || null;
  const followupBudget = policy.maxFollowupsPerThread || 2;
  const coverageGaps = Object.entries(session.coverage || {})
    .filter(([, bucket]) => bucket.asked < Math.max(bucket.planned, 1))
    .map(([category]) => category);
  const shouldContinue = Boolean(
    assessment?.followupNeeded &&
    (activeThread?.followupCount || 0) < followupBudget
  );
  const shouldSearch = Boolean(
    session.enableWebSearch &&
    !shouldContinue &&
    (activeThread?.searchCount || 0) < 1 &&
    /(ai|agent|unity|最新|趋势|生态|版本)/i.test(`${turn.question.text} ${turn.answer} ${session.notes}`)
  );

  if (session.turns.length >= Math.max(6, policy.mustCover?.length || 0) && coverageGaps.length === 0 && !shouldContinue) {
    return {
      strategy: "fallback",
      action: "end_interview",
      threadMode: "close",
      shouldSearch: false,
      rationale: "关键主题已覆盖，当前线程也没有继续深挖的必要。",
      topicLabel: turn.question.topicCategory,
      stopCurrentThread: true
    };
  }

  return {
    strategy: "fallback",
    action: shouldContinue ? "ask_followup" : "ask_new_question",
    threadMode: shouldContinue ? "continue" : "close",
    shouldSearch,
    rationale: shouldContinue
      ? "当前回答仍缺少边界、权衡或失败处理细节，继续深挖更有收益。"
      : coverageGaps.length
        ? `当前线程信息已基本够用，优先转向尚未充分覆盖的主题：${coverageGaps[0]}。`
        : "当前线程可先收口，切换到下一个主题。",
    topicLabel: shouldContinue ? activeThread?.label || turn.question.topicCategory : coverageGaps[0] || turn.question.topicCategory,
    stopCurrentThread: !shouldContinue
  };
}
