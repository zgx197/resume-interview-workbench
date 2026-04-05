import { config } from "../config.js";
import {
  createFallbackAssessment,
  createFallbackPlan,
  createFallbackQuestion,
  createFallbackReport
} from "./fallback-interviewer.js";

const MOONSHOT_REQUEST_TIMEOUT_MS = 45000;

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

function normalizeQuestionResult(value) {
  return {
    strategy: String(value?.strategy || "structured_question"),
    stageId: String(value?.stageId || ""),
    topicCategory: String(value?.topicCategory || "system_design"),
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
    nextSteps: Array.isArray(value?.nextSteps) ? value.nextSteps.map((item) => String(item)) : []
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

async function runMoonshotConversation({ instructions, input, enableWebSearch, purpose }) {
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

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchWithTimeout(`${config.moonshotBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.moonshotApiKey}`
      },
      body: JSON.stringify(buildMoonshotRequestBody({
        messages,
        enableTools: currentEnableTools,
        forceThinkingDisabled,
        strategy
      }))
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Moonshot API request failed with ${response.status}: ${errorText}`);
    }

    const responseJson = await response.json();

    const message = responseJson.choices?.[0]?.message;
    lastMessage = message;

    if (message?.tool_calls?.length) {
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

    return message;
  }

  return lastMessage;
}

async function generateJson({ instructions, input, fallbackFactory, enableWebSearch = false, normalizeResult = (value) => value, purpose = "default" }) {
  const strategy = getPhaseModelStrategy(purpose);

  if (config.aiProvider !== "moonshot" || !config.moonshotApiKey) {
    return withProviderMeta(fallbackFactory(), {
      provider: "fallback",
      model: "fallback",
      purpose,
      thinkingType: "disabled",
      toolMode: Boolean(enableWebSearch)
    });
  }

  try {
    const message = await runMoonshotConversation({
      instructions,
      input,
      enableWebSearch,
      purpose
    });

    const parsed = tryParseJson(message?.content || "");
    if (!parsed) {
      return withProviderMeta(fallbackFactory(), {
        provider: "fallback",
        model: "fallback",
        purpose,
        thinkingType: "disabled",
        toolMode: Boolean(enableWebSearch)
      });
    }
    return withProviderMeta(normalizeResult(parsed), {
      provider: "moonshot",
      model: config.moonshotModel,
      purpose,
      thinkingType: enableWebSearch ? "disabled" : strategy.thinkingType,
      toolMode: Boolean(enableWebSearch)
    });
  } catch {
    return withProviderMeta(fallbackFactory(), {
      provider: "fallback",
      model: "fallback",
      purpose,
      thinkingType: "disabled",
      toolMode: Boolean(enableWebSearch)
    });
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
    purpose: "plan"
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
      candidate: {
        profile: normalizedResume.profile,
        recentExperiences: normalizedResume.experiences.slice(0, 3),
        topTopics: normalizedResume.topicInventory.slice(0, 10)
      }
    }),
    fallbackFactory: () => createFallbackQuestion(context),
    enableWebSearch,
    normalizeResult: normalizeQuestionResult,
    purpose: "question"
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
    purpose: "assessment"
  });
}

export async function generateInterviewReport(session) {
  return generateJson({
    instructions: [
      "你是技术面试总结器。",
      "请输出结构化复盘报告。",
      "输出 JSON 字段：generatedBy, summary, dimensions, strengths, risks, nextSteps。",
      "dimensions 是数组，每项包含 category 和 averageScore。"
    ].join("\n"),
    input: JSON.stringify({
      role: session.role,
      job: session.job,
      turns: session.turns,
      coverage: session.coverage
    }),
    fallbackFactory: () => createFallbackReport(session),
    normalizeResult: normalizeReportResult,
    purpose: "report"
  });
}
