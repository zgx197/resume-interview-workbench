import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";
import {
  createFallbackAssessment,
  createFallbackPlan,
  createFallbackQuestion,
  createFallbackReport
} from "./fallback-interviewer.js";

const MOONSHOT_REQUEST_TIMEOUT_MS = 45000;
const providerLogger = createLogger({ component: "llm-provider" });

// 所有模型接入都集中在这里处理，
// 上层只需要面对归一化后的 JSON 结果和模型元信息。
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

// 不同 phase 使用不同的运行参数。
// fast 模式下优先牺牲思考深度来换取 plan/question 的低延迟。
function getPhaseModelStrategy(purpose) {
  const fastMode = config.interviewRuntimeMode !== "deep";
  switch (purpose) {
    case "plan":
    case "deliberate":
    case "question":
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
    topicLabel: String(value?.topicLabel || ""),
    evidenceSource: String(value?.evidenceSource || "简历结构化数据"),
    expectedSignals: Array.isArray(value?.expectedSignals) ? value.expectedSignals.map((item) => String(item)) : [],
    rationale: String(value?.rationale || ""),
    text: String(value?.text || "请结合你的实际项目经验详细回答。")
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
    strengths: Array.isArray(value?.strengths) ? value.strengths.map((item) => String(item)) : [],
    risks: Array.isArray(value?.risks) ? value.risks.map((item) => String(item)) : [],
    followupNeeded: Boolean(value?.followupNeeded),
    suggestedFollowup: String(value?.suggestedFollowup || "请进一步说明你的具体职责、权衡和验证方式。"),
    evidenceUsed: Array.isArray(value?.evidenceUsed) ? value.evidenceUsed.map((item) => String(item)) : []
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
  logContext = {}
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
    inputPreview: config.logPayloadMode === "summary" ? previewText(input) : undefined
  });

  // 兜底路径是正式运行路径的一部分，而不只是异常时的补救逻辑。
  if (config.aiProvider !== "moonshot" || !config.moonshotApiKey) {
    logger.warn("provider.fallback.used", {
      purpose,
      reason: "provider_unavailable",
      provider: config.aiProvider
    });
    const fallbackResult = withProviderMeta(fallbackFactory(), {
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
      const fallbackResult = withProviderMeta(fallbackFactory(), {
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
    const fallbackResult = withProviderMeta(fallbackFactory(), {
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
  return generateJson({
    instructions: [
      "你是一个严格的技术面试官。",
      "请基于当前阶段、历史问答和候选人简历生成下一道问题。",
      "问题必须紧扣证据，不要泛泛而谈。",
      "输出 JSON 字段：strategy, stageId, topicCategory, evidenceSource, expectedSignals, rationale, text。"
    ].join("\n"),
    input: JSON.stringify({
      role: session.role,
      job: session.job,
      stage,
      decision,
      turnCount: session.turns.length,
      history: session.turns.slice(-3),
      topicGraph: {
        nodes: (session.topicGraph?.nodes || []).slice(0, 12),
        currentQuestionTopicId: session.nextQuestion?.topicId || null
      },
      candidate: {
        profile: normalizedResume.profile,
        recentExperiences: normalizedResume.experiences.slice(0, 3),
        topTopics: normalizedResume.topicInventory.slice(0, 10)
      }
    }),
    fallbackFactory: () => createFallbackQuestion(context),
    enableWebSearch,
    normalizeResult: normalizeQuestionResult,
    purpose: "question",
    logContext: context.logContext
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
