import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";
import {
  createFallbackAssessment,
  createFallbackPlan,
  createFallbackQuestion,
  createFallbackReport,
  createFallbackTurnAnalysis
} from "./fallback-interviewer.js";
import { normalizeInterviewQuestionText } from "./question-text.js";

const MOONSHOT_REQUEST_TIMEOUT_MS = 45000;
const providerLogger = createLogger({ component: "llm-provider" });

// 所有模型接入都集中在这里处理，
// 上层只需要面对归一化后的 JSON 结果和模型元信息。
function uniqueNonEmptyStrings(values) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function extractBalancedJson(text) {
  const source = String(text || "");
  const firstBraceIndex = source.search(/[\[{]/);
  if (firstBraceIndex < 0) {
    return null;
  }

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = firstBraceIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const last = stack.at(-1);
      const matched = (last === "{" && char === "}") || (last === "[" && char === "]");
      if (!matched) {
        return null;
      }
      stack.pop();
      if (stack.length === 0) {
        return source.slice(firstBraceIndex, index + 1);
      }
    }
  }

  return null;
}

function tryParseJson(text) {
  const raw = String(text || "").trim();
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = uniqueNonEmptyStrings([
    raw,
    fencedMatch?.[1],
    extractBalancedJson(raw)
  ]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeThinkingType() {
  return config.moonshotThinking === "disabled" ? "disabled" : "enabled";
}

function buildProviderMeta({ provider, model, purpose, thinkingType, toolMode = false }) {
  const normalizedThinkingType = thinkingType === "enabled" ? "enabled" : "disabled";
  return {
    provider,
    model,
    purpose,
    thinkingType: normalizedThinkingType,
    toolMode: Boolean(toolMode),
    strategyLabel: `${purpose} · thinking ${normalizedThinkingType}`
  };
}

function withProviderMeta(result, meta) {
  return {
    ...result,
    _providerMeta: buildProviderMeta(meta)
  };
}

function previewText(value, maxLength = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildProviderLogContext(logContext = {}) {
  return Object.fromEntries(
    Object.entries(logContext || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function measureJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function clipText(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function trimStringArray(values, { itemLimit = 3, itemMaxLength = 180 } = {}) {
  return (Array.isArray(values) ? values : [])
    .slice(0, itemLimit)
    .map((item) => clipText(item, itemMaxLength));
}

function trimSourceRefs(sourceRefs, limit = 2) {
  return (Array.isArray(sourceRefs) ? sourceRefs : [])
    .slice(0, limit)
    .map((item) => ({
      sourceType: item?.sourceType ? String(item.sourceType) : "",
      sourceId: item?.sourceId ? String(item.sourceId) : ""
    }));
}

function summarizeStageTopic(topic) {
  return {
    topicId: topic?.topicId ? String(topic.topicId) : null,
    label: clipText(topic?.label || "", 120),
    evidence: trimStringArray(topic?.evidence, {
      itemLimit: 2,
      itemMaxLength: 160
    }),
    sourceRefs: trimSourceRefs(topic?.sourceRefs, 2)
  };
}

function summarizeRoleForQuestion(role) {
  return {
    id: role?.id ? String(role.id) : "",
    name: clipText(role?.name || "", 80),
    summary: clipText(role?.summary || "", 360),
    tone: role?.tone ? String(role.tone) : "",
    style: role?.style || {},
    focusWeights: role?.focusWeights || {}
  };
}

function summarizeJobForQuestion(job) {
  return {
    id: job?.id ? String(job.id) : "",
    title: clipText(job?.title || "", 160),
    description: clipText(job?.description || "", 720),
    questionAreas: Array.isArray(job?.questionAreas) ? job.questionAreas.slice(0, 6) : [],
    mustHave: trimStringArray(job?.mustHave, {
      itemLimit: 5,
      itemMaxLength: 140
    }),
    niceToHave: trimStringArray(job?.niceToHave, {
      itemLimit: 3,
      itemMaxLength: 140
    })
  };
}

function summarizeStageForQuestion(stage) {
  return {
    id: stage?.id ? String(stage.id) : "",
    category: stage?.category ? String(stage.category) : "",
    title: clipText(stage?.title || "", 100),
    goal: clipText(stage?.goal || "", 220),
    promptHint: clipText(stage?.promptHint || "", 220),
    targetTopics: (Array.isArray(stage?.targetTopics) ? stage.targetTopics : [])
      .slice(0, 3)
      .map(summarizeStageTopic)
  };
}

function summarizeDecisionForQuestion(decision) {
  return {
    action: decision?.action ? String(decision.action) : "",
    rationale: clipText(decision?.rationale || "", 260),
    threadId: decision?.threadId ? String(decision.threadId) : null,
    threadMode: decision?.threadMode ? String(decision.threadMode) : "",
    stopCurrentThread: Boolean(decision?.stopCurrentThread),
    targetStageIndex: Number.isFinite(Number(decision?.targetStageIndex))
      ? Number(decision.targetStageIndex)
      : null,
    targetTopicId: decision?.targetTopicId ? String(decision.targetTopicId) : null,
    targetTopicLabel: clipText(decision?.targetTopicLabel || decision?.topicLabel || "", 120),
    targetTopicCategory: decision?.targetTopicCategory ? String(decision.targetTopicCategory) : "",
    targetEvidenceSource: clipText(decision?.targetEvidenceSource || "", 120)
  };
}

function summarizeAssessmentForQuestion(assessment) {
  if (!assessment) {
    return null;
  }

  return {
    strategy: assessment?.strategy ? String(assessment.strategy) : "",
    score: Number.isFinite(Number(assessment?.score)) ? Number(assessment.score) : null,
    confidence: assessment?.confidence ? String(assessment.confidence) : "",
    followupNeeded: Boolean(assessment?.followupNeeded),
    strengths: trimStringArray(assessment?.strengths, {
      itemLimit: 2,
      itemMaxLength: 140
    }),
    risks: trimStringArray(assessment?.risks, {
      itemLimit: 3,
      itemMaxLength: 140
    }),
    suggestedFollowup: clipText(assessment?.suggestedFollowup || "", 220)
  };
}

function summarizeTurnForQuestion(turn) {
  return {
    index: Number.isFinite(Number(turn?.index)) ? Number(turn.index) : null,
    question: {
      topicId: turn?.question?.topicId ? String(turn.question.topicId) : null,
      topicLabel: clipText(turn?.question?.topicLabel || "", 120),
      topicCategory: turn?.question?.topicCategory ? String(turn.question.topicCategory) : "",
      evidenceSource: clipText(turn?.question?.evidenceSource || "", 120),
      text: clipText(turn?.question?.text || "", 360)
    },
    answer: clipText(turn?.answer || "", 420),
    assessment: summarizeAssessmentForQuestion(turn?.assessment)
  };
}

function summarizeTopicNodeForQuestion(node) {
  return {
    id: node?.id ? String(node.id) : "",
    label: clipText(node?.label || "", 120),
    category: node?.category ? String(node.category) : "",
    status: node?.status ? String(node.status) : "",
    plannedCount: Number(node?.plannedCount || 0),
    askCount: Number(node?.askCount || 0),
    averageScore: node?.averageScore ?? null,
    lastScore: node?.lastScore ?? null,
    currentQuestion: Boolean(node?.currentQuestion),
    stageTitles: trimStringArray(node?.stageTitles, {
      itemLimit: 2,
      itemMaxLength: 80
    }),
    evidence: trimStringArray(node?.evidence, {
      itemLimit: 2,
      itemMaxLength: 120
    })
  };
}

function summarizeExperienceForQuestion(experience) {
  return {
    id: experience?.id ? String(experience.id) : "",
    company: clipText(experience?.company || "", 80),
    role: clipText(experience?.role || "", 80),
    summary: clipText(experience?.summary || "", 220),
    bullets: trimStringArray(experience?.bullets, {
      itemLimit: 2,
      itemMaxLength: 160
    })
  };
}

function summarizeTopicForQuestion(topic) {
  return {
    id: topic?.id ? String(topic.id) : "",
    label: clipText(topic?.label || "", 120),
    category: topic?.category ? String(topic.category) : "",
    evidence: trimStringArray(topic?.evidence, {
      itemLimit: 2,
      itemMaxLength: 120
    }),
    sourceRefs: trimSourceRefs(topic?.sourceRefs, 2)
  };
}

function pickQuestionPromptNodes(session, decision) {
  const graphNodes = session.topicGraph?.nodes || [];
  const preferredIds = new Set([
    decision?.targetTopicId,
    session.currentThreadId,
    session.nextQuestion?.topicId,
    ...session.turns.slice(-3).map((turn) => turn.question?.topicId)
  ].filter(Boolean));

  const exactMatches = graphNodes.filter((node) => preferredIds.has(node.id));
  const stageMatches = graphNodes
    .filter((node) => (
      !preferredIds.has(node.id) &&
      node.category === decision?.targetTopicCategory &&
      (node.plannedCount > 0 || node.askCount > 0)
    ))
    .sort((left, right) => (
      (right.plannedCount || 0) - (left.plannedCount || 0) ||
      (right.askCount || 0) - (left.askCount || 0)
    ));

  return [...exactMatches, ...stageMatches]
    .slice(0, 6)
    .map(summarizeTopicNodeForQuestion);
}

function buildQuestionPromptPayload(context) {
  const { session, stage, normalizedResume, decision } = context;
  const sections = {
    role: summarizeRoleForQuestion(session.role),
    job: summarizeJobForQuestion(session.job),
    stage: summarizeStageForQuestion(stage),
    decision: summarizeDecisionForQuestion(decision),
    turnContext: {
      turnCount: session.turns.length,
      history: session.turns.slice(-2).map(summarizeTurnForQuestion)
    },
    topicGraph: {
      nodes: pickQuestionPromptNodes(session, decision),
      currentQuestionTopicId: session.nextQuestion?.topicId || null
    },
    candidate: {
      profile: {
        name: clipText(normalizedResume?.profile?.name || "", 80),
        title: clipText(normalizedResume?.profile?.title || "", 120),
        estimatedYearsExperience: normalizedResume?.profile?.estimatedYearsExperience ?? null
      },
      recentExperiences: (normalizedResume?.experiences || [])
        .slice(0, 2)
        .map(summarizeExperienceForQuestion),
      topTopics: (normalizedResume?.topicInventory || [])
        .filter((topic) => (
          topic.id === decision?.targetTopicId ||
          topic.category === decision?.targetTopicCategory
        ))
        .slice(0, 6)
        .map(summarizeTopicForQuestion)
    }
  };

  const sectionBytes = Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [key, measureJsonBytes(value)])
  );
  const largestSections = Object.entries(sectionBytes)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([name, bytes]) => ({ name, bytes }));

  return {
    input: JSON.stringify(sections),
    diagnostics: {
      totalBytes: measureJsonBytes(sections),
      sectionBytes,
      largestSections
    }
  };
}

function summarizeQuestionForPrompt(question) {
  return {
    stageId: question?.stageId ? String(question.stageId) : "",
    topicId: question?.topicId ? String(question.topicId) : null,
    topicLabel: clipText(question?.topicLabel || "", 120),
    topicCategory: question?.topicCategory ? String(question.topicCategory) : "",
    evidenceSource: clipText(question?.evidenceSource || "", 120),
    expectedSignals: trimStringArray(question?.expectedSignals, {
      itemLimit: 4,
      itemMaxLength: 120
    }),
    text: clipText(question?.text || "", 360)
  };
}

function summarizeRoleForTurnAnalysis(role) {
  const sortedFocus = Object.entries(role?.focusWeights || {})
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, 3)
    .map(([category]) => category);

  return {
    name: clipText(role?.name || "", 60),
    summary: clipText(role?.summary || "", 140),
    focusCategories: sortedFocus
  };
}

function summarizeJobForTurnAnalysis(job) {
  return {
    title: clipText(job?.title || "", 80),
    questionAreas: trimStringArray(job?.questionAreas, {
      itemLimit: 3,
      itemMaxLength: 50
    }),
    mustHave: trimStringArray(job?.mustHave, {
      itemLimit: 2,
      itemMaxLength: 70
    })
  };
}

function summarizeStageForTurnAnalysis(stage) {
  return {
    id: stage?.id ? String(stage.id) : "",
    category: stage?.category ? String(stage.category) : "",
    title: clipText(stage?.title || "", 60),
    goal: clipText(stage?.goal || "", 80),
    targetTopicLabels: (Array.isArray(stage?.targetTopics) ? stage.targetTopics : [])
      .slice(0, 2)
      .map((topic) => clipText(topic?.label || "", 60))
      .filter(Boolean)
  };
}

function summarizeHistoryTurnForTurnAnalysis(turn) {
  return {
    index: Number.isFinite(Number(turn?.index)) ? Number(turn.index) : null,
    topicLabel: clipText(turn?.question?.topicLabel || "", 80),
    topicCategory: turn?.question?.topicCategory ? String(turn.question.topicCategory) : "",
    score: Number.isFinite(Number(turn?.assessment?.score)) ? Number(turn.assessment.score) : null,
    answer: clipText(turn?.answer || "", 120)
  };
}

function summarizeTopicNodeForTurnAnalysis(node) {
  return {
    id: node?.id ? String(node.id) : "",
    label: clipText(node?.label || "", 80),
    category: node?.category ? String(node.category) : "",
    status: node?.status ? String(node.status) : "",
    plannedCount: Number(node?.plannedCount || 0),
    askCount: Number(node?.askCount || 0),
    lastScore: node?.lastScore ?? null
  };
}

function pickTurnAnalysisPromptNodes(session, currentQuestion, stage) {
  const graphNodes = session.topicGraph?.nodes || [];
  const preferredIds = new Set([
    currentQuestion?.topicId,
    session.currentThreadId,
    ...session.turns.slice(-2).map((turn) => turn.question?.topicId)
  ].filter(Boolean));

  const exactMatches = graphNodes.filter((node) => preferredIds.has(node.id));
  const categoryMatches = graphNodes
    .filter((node) => (
      !preferredIds.has(node.id) &&
      node.category === (currentQuestion?.topicCategory || stage?.category) &&
      (node.plannedCount > 0 || node.askCount > 0)
    ))
    .sort((left, right) => (
      (left.askCount || 0) - (right.askCount || 0) ||
      (right.plannedCount || 0) - (left.plannedCount || 0)
    ));

  return [...exactMatches, ...categoryMatches]
    .slice(0, 3)
    .map(summarizeTopicNodeForTurnAnalysis);
}

function summarizeCandidateForTurnAnalysis(normalizedResume, question, stage) {
  return {
    profile: {
      title: clipText(normalizedResume?.profile?.title || "", 80),
      estimatedYearsExperience: normalizedResume?.profile?.estimatedYearsExperience ?? null
    },
    recentExperiences: (normalizedResume?.experiences || [])
      .slice(0, 1)
      .map((experience) => ({
        company: clipText(experience?.company || "", 50),
        role: clipText(experience?.role || "", 50),
        summary: clipText(experience?.summary || "", 80)
      })),
    relevantTopics: (normalizedResume?.topicInventory || [])
      .filter((topic) => (
        topic.id === question?.topicId ||
        topic.category === question?.topicCategory ||
        topic.category === stage?.category
      ))
      .slice(0, 2)
      .map((topic) => ({
        id: topic?.id ? String(topic.id) : "",
        label: clipText(topic?.label || "", 60),
        category: topic?.category ? String(topic.category) : "",
        evidence: trimStringArray(topic?.evidence, {
          itemLimit: 1,
          itemMaxLength: 70
        })
      }))
  };
}

function buildTurnAnalysisPromptPayload(context) {
  const { session, stage, normalizedResume, question, answer } = context;
  const sections = {
    role: summarizeRoleForTurnAnalysis(session.role),
    job: summarizeJobForTurnAnalysis(session.job),
    stage: summarizeStageForTurnAnalysis(stage),
    currentTurn: {
      question: {
        topicId: question?.topicId ? String(question.topicId) : null,
        topicLabel: clipText(question?.topicLabel || "", 60),
        topicCategory: question?.topicCategory ? String(question.topicCategory) : "",
        evidenceSource: clipText(question?.evidenceSource || "", 70),
        text: clipText(question?.text || "", 120)
      },
      answer: clipText(answer || "", 220)
    },
    turnContext: {
      turnCount: session.turns.length,
      history: session.turns.slice(-1).map(summarizeHistoryTurnForTurnAnalysis)
    },
    topicGraph: {
      currentTopicId: question?.topicId || null,
      nearbyNodes: pickTurnAnalysisPromptNodes(session, question, stage)
    },
    candidate: summarizeCandidateForTurnAnalysis(normalizedResume, question, stage)
  };

  const sectionBytes = Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [key, measureJsonBytes(value)])
  );
  const largestSections = Object.entries(sectionBytes)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([name, bytes]) => ({ name, bytes }));

  return {
    input: JSON.stringify(sections),
    diagnostics: {
      totalBytes: measureJsonBytes(sections),
      sectionBytes,
      largestSections
    }
  };
}

// 不同 phase 使用不同的运行参数。
// fast 模式下优先牺牲思考深度来换取 plan/question 的低延迟。
function getPhaseModelStrategy(purpose) {
  const fastMode = config.interviewRuntimeMode !== "deep";
  switch (purpose) {
    case "plan":
    case "deliberate":
    case "question":
    case "answer_turn":
      return {
        thinkingType: fastMode ? "disabled" : normalizeThinkingType(),
        temperature: fastMode ? 0.6 : (normalizeThinkingType() === "enabled" ? 1.0 : 0.6),
        topP: fastMode ? undefined : (normalizeThinkingType() === "enabled" ? 0.95 : undefined)
      };
    case "assessment":
    case "report":
      return {
        thinkingType: "disabled",
        temperature: 0.6,
        topP: undefined
      };
    default:
      return {
        thinkingType: "disabled",
        temperature: 0.6,
        topP: undefined
      };
  }
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

// 对模型输出做归一化，
// 保证下游逻辑在模型漏字段时仍然保持确定性。
function normalizeQuestionResult(value) {
  return {
    strategy: String(value?.strategy || "structured_question"),
    stageId: String(value?.stageId || ""),
    topicCategory: String(value?.topicCategory || "system_design"),
    topicId: value?.topicId ? String(value.topicId) : null,
    topicLabel: clipText(value?.topicLabel || "", 120),
    evidenceSource: clipText(value?.evidenceSource || "简历结构化数据", 140),
    expectedSignals: trimStringArray(value?.expectedSignals, {
      itemLimit: 2,
      itemMaxLength: 100
    }),
    rationale: clipText(value?.rationale || "", 160),
    text: normalizeInterviewQuestionText(value?.text || "请结合你的实际项目经验详细回答。")
  };
}

function normalizeOptionalQuestionResult(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const text = normalizeInterviewQuestionText(value?.text || "", {
    maxQuestions: 2,
    maxLength: 72
  });
  if (!String(text || "").trim()) {
    return null;
  }

  return {
    topicId: value?.topicId ? String(value.topicId) : null,
    topicLabel: clipText(value?.topicLabel || "", 60),
    topicCategory: String(value?.topicCategory || "system_design"),
    evidenceSource: clipText(value?.evidenceSource || "简历结构化数据", 80),
    text
  };
}

function normalizeTurnAssessmentResult(value) {
  const normalized = normalizeAssessmentResult(value);
  return {
    score: normalized.score,
    confidence: normalized.confidence,
    strengths: normalized.strengths,
    risks: normalized.risks,
    followupNeeded: normalized.followupNeeded,
    suggestedFollowup: clipText(normalized.suggestedFollowup || "", 60)
  };
}

function normalizeAssessmentResult(value) {
  const rawScore = Number(value?.score);
  const normalizedScore = Number.isFinite(rawScore)
    ? (rawScore > 5 ? Math.round(rawScore / 20) : Math.round(rawScore))
    : 3;
  return {
    strategy: String(value?.strategy || "structured_assessment"),
    score: clamp(normalizedScore, 1, 5),
    confidence: ["low", "medium", "high"].includes(value?.confidence) ? value.confidence : "medium",
    strengths: trimStringArray(value?.strengths, {
      itemLimit: 1,
      itemMaxLength: 70
    }),
    risks: trimStringArray(value?.risks, {
      itemLimit: 1,
      itemMaxLength: 70
    }),
    followupNeeded: Boolean(value?.followupNeeded),
    suggestedFollowup: clipText(value?.suggestedFollowup || "请进一步说明你的具体职责、权衡和验证方式。", 90),
    evidenceUsed: trimStringArray(value?.evidenceUsed, {
      itemLimit: 1,
      itemMaxLength: 70
    })
  };
}

function normalizePlanResult(value) {
  return {
    strategy: String(value?.strategy || "structured_plan"),
    summary: String(value?.summary || "结构化面试计划"),
    targetTurnCount: clamp(Number(value?.targetTurnCount) || 6, 4, 12),
    stages: Array.isArray(value?.stages) ? value.stages : []
  };
}

function normalizeReportResult(value) {
  return {
    generatedBy: String(value?.generatedBy || "structured_report"),
    summary: String(value?.summary || ""),
    dimensions: Array.isArray(value?.dimensions) ? value.dimensions : [],
    strengths: Array.isArray(value?.strengths) ? value.strengths.map((item) => String(item)) : [],
    risks: Array.isArray(value?.risks) ? value.risks.map((item) => String(item)) : [],
    nextSteps: Array.isArray(value?.nextSteps) ? value.nextSteps.map((item) => String(item)) : [],
    coverageSummary: value?.coverageSummary && typeof value.coverageSummary === "object"
      ? {
          plannedTopicCount: Number(value.coverageSummary.plannedTopicCount) || 0,
          coveredTopicCount: Number(value.coverageSummary.coveredTopicCount) || 0,
          turnCount: Number(value.coverageSummary.turnCount) || 0,
          averageTopicScore: value.coverageSummary.averageTopicScore ?? null,
          summary: String(value.coverageSummary.summary || "")
        }
      : null,
    topicCoverage: Array.isArray(value?.topicCoverage)
      ? value.topicCoverage.map((item) => ({
          topicId: item?.topicId ? String(item.topicId) : null,
          label: String(item?.label || ""),
          category: String(item?.category || "system_design"),
          status: String(item?.status || "idle"),
          askCount: Number(item?.askCount) || 0,
          averageScore: item?.averageScore ?? null,
          stageTitles: Array.isArray(item?.stageTitles) ? item.stageTitles.map((stageTitle) => String(stageTitle)) : [],
          evidence: Array.isArray(item?.evidence) ? item.evidence.map((evidence) => String(evidence)) : []
        }))
      : [],
    evidenceHighlights: Array.isArray(value?.evidenceHighlights)
      ? value.evidenceHighlights.map((item) => ({
          topicId: item?.topicId ? String(item.topicId) : null,
          topicLabel: String(item?.topicLabel || ""),
          evidenceSource: String(item?.evidenceSource || ""),
          score: item?.score ?? null,
          summary: String(item?.summary || "")
        }))
      : []
  };
}

function normalizeTurnAnalysisResult(value) {
  return {
    assessment: normalizeTurnAssessmentResult(value?.assessment),
    followupQuestion: normalizeOptionalQuestionResult(
      value?.followupQuestion || value?.followup || value?.followupDraft
    ),
    nextTopicQuestion: normalizeOptionalQuestionResult(
      value?.nextTopicQuestion || value?.nextQuestion || value?.nextTopicDraft
    )
  };
}

// report 的图谱覆盖信息需要保持确定性，
// 即使模型只返回旧版字段，也要用 graph 驱动的 fallback 结果补齐。
function enrichReportResult(report, fallbackReport) {
  return {
    ...fallbackReport,
    ...report,
    summary: String(report?.summary || "").trim() || fallbackReport.summary,
    dimensions: Array.isArray(report?.dimensions) && report.dimensions.length
      ? report.dimensions
      : fallbackReport.dimensions,
    strengths: Array.isArray(report?.strengths) && report.strengths.length
      ? report.strengths
      : fallbackReport.strengths,
    risks: Array.isArray(report?.risks) && report.risks.length
      ? report.risks
      : fallbackReport.risks,
    nextSteps: Array.isArray(report?.nextSteps) && report.nextSteps.length
      ? report.nextSteps
      : fallbackReport.nextSteps,
    coverageSummary: fallbackReport.coverageSummary,
    topicCoverage: fallbackReport.topicCoverage,
    evidenceHighlights: fallbackReport.evidenceHighlights,
    _providerMeta: report?._providerMeta || null
  };
}

function buildMoonshotRequestBody({ messages, enableTools, forceThinkingDisabled, strategy }) {
  const toolMode = Boolean(enableTools || forceThinkingDisabled);
  const thinkingType = toolMode ? "disabled" : strategy.thinkingType;
  const temperature = toolMode ? 0.6 : strategy.temperature;
  const topP = toolMode ? undefined : strategy.topP;
  const body = {
    model: config.moonshotModel,
    messages,
    stream: false,
    temperature,
    top_p: topP,
    thinking: {
      type: thinkingType
    }
  };

  if (enableTools) {
    body.tools = [
      {
        type: "builtin_function",
        function: {
          name: "$web_search"
        }
      }
    ];
  }

  return body;
}

function buildToolMessage(toolCall) {
  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: toolCall.function?.arguments || ""
  };
}

async function fetchWithTimeout(url, options, timeoutMs = MOONSHOT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Moonshot request timed out after ${timeoutMs}ms`)), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runMoonshotConversation({ instructions, input, enableWebSearch, purpose, logContext = {} }) {
  const logger = providerLogger.child(buildProviderLogContext(logContext));
  let messages = [
    {
      role: "system",
      content: [
        "你是一个严格的结构化输出引擎。",
        instructions,
        "你必须只输出 JSON，不要输出 Markdown 代码块，不要输出额外解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: input
    }
  ];

  let currentEnableTools = enableWebSearch;
  let forceThinkingDisabled = enableWebSearch;
  let lastMessage = null;
  const strategy = getPhaseModelStrategy(purpose);

  // 模型提供方可能先返回搜索工具调用，再返回最终 JSON。
  // 这里会把工具调用结果回灌到对话里，完成第二轮生成。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const requestBody = buildMoonshotRequestBody({
      messages,
      enableTools: currentEnableTools,
      forceThinkingDisabled,
      strategy
    });
    const serializedBody = JSON.stringify(requestBody);
    const attemptSpan = logger.startSpan("provider.chat", {
      purpose,
      attempt: attempt + 1,
      model: config.moonshotModel,
      enableWebSearch: Boolean(enableWebSearch),
      toolMode: Boolean(requestBody.tools?.length),
      thinkingType: requestBody.thinking?.type || "disabled",
      messageCount: messages.length,
      requestBytes: Buffer.byteLength(serializedBody, "utf8")
    });

    try {
      const response = await fetchWithTimeout(`${config.moonshotBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.moonshotApiKey}`
        },
        body: serializedBody
      });
      const responseText = await response.text();
      const responseBytes = Buffer.byteLength(responseText, "utf8");

      if (!response.ok) {
        const error = new Error(`Moonshot API request failed with ${response.status}: ${responseText}`);
        error.code = `HTTP_${response.status}`;
        throw Object.assign(error, {
          statusCode: response.status,
          responseBytes
        });
      }

      const responseJson = JSON.parse(responseText);
      const message = responseJson.choices?.[0]?.message;
      lastMessage = message;

      if (message?.tool_calls?.length) {
        logger.info("provider.tool_call.completed", {
          purpose,
          attempt: attempt + 1,
          toolCallsCount: message.tool_calls.length,
          toolNames: message.tool_calls.map((toolCall) => toolCall.function?.name || "unknown")
        });
        attemptSpan.end({
          purpose,
          attempt: attempt + 1,
          statusCode: response.status,
          responseBytes,
          toolCallsCount: message.tool_calls.length
        });

        messages = [
          ...messages,
          {
            role: "assistant",
            content: message.content || "",
            tool_calls: message.tool_calls
          },
          ...message.tool_calls.map(buildToolMessage)
        ];
        currentEnableTools = false;
        forceThinkingDisabled = true;
        continue;
      }

      attemptSpan.end({
        purpose,
        attempt: attempt + 1,
        statusCode: response.status,
        responseBytes,
        toolCallsCount: 0,
        contentChars: String(message?.content || "").length
      });
      return message;
    } catch (error) {
      attemptSpan.fail(error, {
        purpose,
        attempt: attempt + 1
      });
      throw error;
    }
  }

  return lastMessage;
}

async function generateJson({
  instructions,
  input,
  fallbackFactory,
  enableWebSearch = false,
  normalizeResult = (value) => value,
  purpose = "default",
  logContext = {},
  inputDiagnostics = null
}) {
  const logger = providerLogger.child(buildProviderLogContext(logContext));
  const strategy = getPhaseModelStrategy(purpose);
  const span = logger.startSpan("provider.generate_json", {
    purpose,
    enableWebSearch: Boolean(enableWebSearch),
    model: config.aiProvider === "moonshot" ? config.moonshotModel : "fallback",
    thinkingType: enableWebSearch ? "disabled" : strategy.thinkingType,
    toolMode: Boolean(enableWebSearch),
    inputChars: String(input || "").length,
    inputPreview: config.logPayloadMode === "summary" ? previewText(input) : undefined,
    inputTotalBytes: inputDiagnostics?.totalBytes,
    inputLargestSections: inputDiagnostics?.largestSections
  });

  if (inputDiagnostics) {
    logger.info("provider.input.diagnostics", {
      purpose,
      totalBytes: inputDiagnostics.totalBytes,
      sectionBytes: inputDiagnostics.sectionBytes,
      largestSections: inputDiagnostics.largestSections
    });
  }

  // 兜底路径是正式运行路径的一部分，而不只是异常时的补救逻辑。
  if (config.aiProvider !== "moonshot" || !config.moonshotApiKey) {
    logger.warn("provider.fallback.used", {
      purpose,
      reason: "provider_unavailable",
      provider: config.aiProvider
    });
    const fallbackResult = withProviderMeta(normalizeResult(fallbackFactory()), {
      provider: "fallback",
      model: "fallback",
      purpose,
      thinkingType: "disabled",
      toolMode: Boolean(enableWebSearch)
    });
    span.end({
      purpose,
      fallbackUsed: true,
      fallbackReason: "provider_unavailable"
    });
    return fallbackResult;
  }

  try {
    const message = await runMoonshotConversation({
      instructions,
      input,
      enableWebSearch,
      purpose,
      logContext
    });

    const parsed = tryParseJson(message?.content || "");
    if (!parsed) {
      logger.warn("provider.fallback.used", {
        purpose,
        reason: "invalid_json",
        contentPreview: previewText(message?.content || "")
      });
      const fallbackResult = withProviderMeta(normalizeResult(fallbackFactory()), {
        provider: "fallback",
        model: "fallback",
        purpose,
        thinkingType: "disabled",
        toolMode: Boolean(enableWebSearch)
      });
      span.end({
        purpose,
        fallbackUsed: true,
        fallbackReason: "invalid_json"
      });
      return fallbackResult;
    }

    const normalizedResult = withProviderMeta(normalizeResult(parsed), {
      provider: "moonshot",
      model: config.moonshotModel,
      purpose,
      thinkingType: enableWebSearch ? "disabled" : strategy.thinkingType,
      toolMode: Boolean(enableWebSearch)
    });
    span.end({
      purpose,
      fallbackUsed: false,
      provider: "moonshot"
    });
    return normalizedResult;
  } catch (error) {
    logger.warn("provider.fallback.used", error, {
      purpose,
      reason: "provider_exception"
    });
    const fallbackResult = withProviderMeta(normalizeResult(fallbackFactory()), {
      provider: "fallback",
      model: "fallback",
      purpose,
      thinkingType: "disabled",
      toolMode: Boolean(enableWebSearch)
    });
    span.end({
      purpose,
      fallbackUsed: true,
      fallbackReason: "provider_exception"
    });
    return fallbackResult;
  }
}

export async function buildInterviewPlan(context) {
  const { role, job, normalizedResume, notes, enableWebSearch } = context;
  return generateJson({
    instructions: [
      "你是一个技术面试编排器。",
      "目标是根据候选人简历、岗位要求和面试官角色，输出一份结构化面试计划。",
      "计划要优先覆盖候选人最近、最强和最相关的项目证据。",
      "输出 JSON 字段：strategy, summary, targetTurnCount, stages。",
      "stages 是数组，每项包含 id, category, title, goal, promptHint, targetTopics。",
      "targetTopics 是数组，每项包含 label, evidence, sourceRefs。"
    ].join("\n"),
    input: JSON.stringify({
      role,
      job,
      notes,
      candidate: {
        profile: normalizedResume.profile,
        narrative: normalizedResume.narrative,
        topTopics: normalizedResume.topicInventory.slice(0, 12),
        recentExperiences: normalizedResume.experiences.slice(0, 2)
      }
    }),
    fallbackFactory: () => createFallbackPlan(context),
    enableWebSearch,
    normalizeResult: normalizePlanResult,
    purpose: "plan",
    logContext: context.logContext
  });
}

export async function generateInterviewQuestion(context) {
  const { session, stage, normalizedResume, enableWebSearch, decision } = context;
  const promptPayload = buildQuestionPromptPayload({
    session,
    stage,
    normalizedResume,
    decision
  });

  return generateJson({
    instructions: [
      "你是一个严格的技术面试官。",
      "请基于当前阶段、历史问答和候选人简历生成下一道问题。",
      "问题必须紧扣证据，不要泛泛而谈。",
      "text 字段最多包含 2 个连续问句，优先 1 个主问题 + 1 个补充限定。",
      "输出 JSON 字段：strategy, stageId, topicCategory, evidenceSource, expectedSignals, rationale, text。"
    ].join("\n"),
    input: promptPayload.input,
    fallbackFactory: () => createFallbackQuestion(context),
    enableWebSearch,
    normalizeResult: normalizeQuestionResult,
    purpose: "question",
    logContext: context.logContext,
    inputDiagnostics: promptPayload.diagnostics
  });
}

export async function assessInterviewAnswer(context) {
  const { answer, question, stage, session } = context;
  return generateJson({
    instructions: [
      "你是技术面试复盘器。",
      "请根据题目和回答输出简短结构化评估。",
      "输出 JSON 字段：strategy, score, confidence, strengths, risks, followupNeeded, suggestedFollowup, evidenceUsed。"
    ].join("\n"),
    input: JSON.stringify({
      role: session.role,
      stage,
      question,
      answer
    }),
    fallbackFactory: () => createFallbackAssessment(context),
    normalizeResult: normalizeAssessmentResult,
    purpose: "assessment",
    logContext: context.logContext
  });
}

export async function analyzeInterviewTurn(context) {
  const promptPayload = buildTurnAnalysisPromptPayload(context);

  return generateJson({
    instructions: [
      "你是一个严格的技术面试官。",
      "请先评估当前回答，再同时草拟两个候选问题。",
      "第一个候选问题用于继续深挖当前证据线程。",
      "第二个候选问题用于切换到下一个值得覆盖的新主题。",
      "你只负责评估与表述，不负责决定是否结束面试，结束决策由上层策略处理。",
      "输出必须是一个 JSON 对象，且顶层只包含 assessment, followupQuestion, nextTopicQuestion。",
      "assessment 只包含：score, confidence, followupNeeded, strengths, risks, suggestedFollowup。",
      "strengths 和 risks 最多各 1 条短句，suggestedFollowup 尽量不超过 18 个字。",
      "followupQuestion 与 nextTopicQuestion 只包含：text, topicId, topicLabel, topicCategory, evidenceSource。",
      "question.text 必须是中文面试题，不超过 80 个字，最多 2 个连续问句，不要列表。",
      "不要输出 strategy、stageId、expectedSignals、rationale、evidenceUsed、null、Markdown 或额外说明。"
    ].join("\n"),
    input: promptPayload.input,
    fallbackFactory: () => createFallbackTurnAnalysis(context),
    normalizeResult: normalizeTurnAnalysisResult,
    purpose: "answer_turn",
    logContext: context.logContext,
    inputDiagnostics: promptPayload.diagnostics
  });
}

export async function generateInterviewReport(session) {
  const fallbackReport = createFallbackReport(session);
  const report = await generateJson({
    instructions: [
      "你是技术面试总结器。",
      "请输出结构化复盘报告。",
      "输出 JSON 字段：generatedBy, summary, dimensions, strengths, risks, nextSteps, coverageSummary, topicCoverage, evidenceHighlights。",
      "dimensions 是数组，每项包含 category 和 averageScore。",
      "coverageSummary 包含 plannedTopicCount, coveredTopicCount, turnCount, averageTopicScore, summary。",
      "topicCoverage 是数组，每项包含 topicId, label, category, status, askCount, averageScore, stageTitles, evidence。",
      "evidenceHighlights 是数组，每项包含 topicId, topicLabel, evidenceSource, score, summary。"
    ].join("\n"),
    input: JSON.stringify({
      role: session.role,
      job: session.job,
      turns: session.turns,
      coverage: session.coverage,
      topicGraph: {
        nodes: (session.topicGraph?.nodes || []).filter((node) => node.plannedCount > 0 || node.askCount > 0),
        edges: (session.topicGraph?.edges || []).slice(0, 120)
      },
      topicThreads: session.topicThreads || []
    }),
    fallbackFactory: () => fallbackReport,
    normalizeResult: normalizeReportResult,
    purpose: "report",
    logContext: {
      sessionId: session.id,
      runId: session.currentRun?.id || null
    }
  });
  return enrichReportResult(report, fallbackReport);
}
