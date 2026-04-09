import crypto from "node:crypto";
import { QUESTION_LIBRARY } from "./question-bank.js";
import { createDbQuestionRepository } from "../repositories/db/db-question-repository.js";
import { createLogger } from "../lib/logger.js";
import { upsertKnowledgeDocument } from "./knowledge-service.js";
import { retrieveQuestionCandidates } from "./knowledge-retrieval-service.js";

const questionRepository = createDbQuestionRepository();
const questionBankLogger = createLogger({ component: "question-bank-service" });
let seedPromise = null;

const CATEGORY_LABELS = {
  language_fundamentals: "Language Fundamentals",
  game_algorithms: "Game Algorithms",
  game_framework: "Game Framework",
  system_design: "System Design",
  ai_agent_design: "AI Agent Design"
};

function computeHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function toTagLabel(tagKey) {
  return CATEGORY_LABELS[tagKey] || tagKey.replace(/_/g, " ");
}

function firstNonEmpty(values, fallback = "") {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return fallback;
}

function uniqueIds(values = []) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function buildQuestionSeed(category, text, index) {
  const id = `question_${category}_${String(index + 1).padStart(3, "0")}`;
  const now = new Date().toISOString();
  return {
    id,
    questionKey: id,
    canonicalText: String(text || "").trim(),
    category,
    difficulty: 3,
    status: "active",
    sourceType: "fallback_seed",
    metadata: {
      seedCategory: category,
      seedIndex: index
    },
    tags: [
      {
        tagKey: category,
        label: toTagLabel(category),
        category: "question_category"
      }
    ],
    sources: [
      {
        id: `${id}_source_seed`,
        sourceKind: "fallback_seed",
        sourceId: `${category}:${index + 1}`,
        sourceSnapshot: {
          category,
          index
        },
        createdAt: now
      }
    ],
    variants: [
      {
        id: `${id}_primary`,
        text: String(text || "").trim(),
        style: "primary",
        status: "active",
        createdAt: now,
        updatedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

async function syncQuestionKnowledgeDocument(question) {
  return upsertKnowledgeDocument({
    id: `knowledge_${question.id}`,
    documentKey: `question:${question.id}`,
    documentType: "question",
    sourceTable: "question_items",
    sourceId: question.id,
    title: question.tags?.[0]?.label
      ? `${question.tags[0].label} / ${question.id}`
      : question.id,
    content: [
      question.canonicalText,
      ...(question.variants || []).map((variant) => variant.text),
      ...(question.tags || []).map((tag) => tag.label)
    ].filter(Boolean).join("\n"),
    metadata: {
      category: question.category,
      difficulty: question.difficulty,
      sourceType: question.sourceType,
      tagKeys: (question.tags || []).map((tag) => tag.tagKey)
    },
    status: question.status || "active",
    contentHash: computeHash(
      JSON.stringify({
        canonicalText: question.canonicalText,
        variants: (question.variants || []).map((variant) => variant.text),
        tags: (question.tags || []).map((tag) => tag.tagKey)
      })
    ),
    createdAt: question.createdAt,
    updatedAt: question.updatedAt
  });
}

async function seedQuestionBank() {
  for (const [category, questions] of Object.entries(QUESTION_LIBRARY)) {
    for (const [index, text] of questions.entries()) {
      const seeded = await questionRepository.save(buildQuestionSeed(category, text, index));
      await syncQuestionKnowledgeDocument(seeded);
    }
  }
}

export async function ensureQuestionBankSeeded() {
  if (!seedPromise) {
    seedPromise = seedQuestionBank().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  await seedPromise;
}

export async function listQuestionBank(filter = {}) {
  await ensureQuestionBankSeeded();
  return questionRepository.search(filter);
}

export async function getQuestionBankItem(questionId) {
  await ensureQuestionBankSeeded();
  return questionRepository.getById(questionId);
}

export async function getQuestionBankItemsByIds(questionIds = []) {
  await ensureQuestionBankSeeded();
  const resolvedIds = [...new Set((questionIds || []).map((item) => String(item || "").trim()).filter(Boolean))];
  const items = await Promise.all(resolvedIds.map((questionId) => questionRepository.getById(questionId)));
  return items.filter(Boolean);
}

export async function listQuestionBankCategories() {
  await ensureQuestionBankSeeded();
  return questionRepository.listCategories();
}

export async function listQuestionBankTags(filter = {}) {
  await ensureQuestionBankSeeded();
  return questionRepository.listTags(filter);
}

export async function saveQuestionBankItem(input) {
  await ensureQuestionBankSeeded();
  const now = new Date().toISOString();
  const questionId = input.id || `question_manual_${crypto.randomUUID()}`;
  const saved = await questionRepository.save({
    ...input,
    id: questionId,
    questionKey: input.questionKey || questionId,
    createdAt: input.createdAt || now,
    updatedAt: now
  });
  await syncQuestionKnowledgeDocument(saved);
  return saved;
}

export async function recordQuestionUsage(input) {
  await ensureQuestionBankSeeded();
  return questionRepository.recordUsage(input);
}

export async function recordQuestionAsked(questionId) {
  await ensureQuestionBankSeeded();
  if (!questionId) {
    return null;
  }

  const existing = await questionRepository.getById(questionId);
  if (!existing) {
    return null;
  }

  const current = existing.usageStats || {
    askedCount: 0,
    answeredCount: 0,
    avgScore: null,
    avgFollowupCount: null,
    lastAskedAt: null
  };
  const occurredAt = new Date().toISOString();

  return questionRepository.recordUsage({
    questionId,
    askedCount: (current.askedCount || 0) + 1,
    answeredCount: current.answeredCount || 0,
    avgScore: current.avgScore,
    avgFollowupCount: current.avgFollowupCount,
    lastAskedAt: occurredAt,
    occurredAt
  });
}

export async function recordQuestionOutcome(questionId, assessment, { followupCount = 0 } = {}) {
  await ensureQuestionBankSeeded();
  if (!questionId) {
    return null;
  }

  const existing = await questionRepository.getById(questionId);
  if (!existing) {
    return null;
  }

  const current = existing.usageStats || {
    askedCount: 0,
    answeredCount: 0,
    avgScore: null,
    avgFollowupCount: null,
    lastAskedAt: null
  };

  const nextAnsweredCount = (current.answeredCount || 0) + 1;
  const normalizedScore = Number.isFinite(Number(assessment?.score)) ? Number(assessment.score) : null;
  const normalizedFollowupCount = Number.isFinite(Number(followupCount)) ? Number(followupCount) : 0;
  const avgScore = normalizedScore == null
    ? current.avgScore
    : (((current.avgScore || 0) * (nextAnsweredCount - 1)) + normalizedScore) / nextAnsweredCount;
  const avgFollowupCount = (((current.avgFollowupCount || 0) * (nextAnsweredCount - 1)) + normalizedFollowupCount) / nextAnsweredCount;

  return questionRepository.recordUsage({
    questionId,
    askedCount: current.askedCount || 0,
    answeredCount: nextAnsweredCount,
    avgScore: avgScore == null ? null : Number(avgScore.toFixed(2)),
    avgFollowupCount: Number(avgFollowupCount.toFixed(2)),
    lastAskedAt: current.lastAskedAt || null,
    occurredAt: new Date().toISOString()
  });
}

function buildFollowupQueryText({ turn, turnAnalysis, reviewItem }) {
  const evidenceSnippet = String(turn?.answer || "").trim().slice(0, 240);
  return [
    reviewItem?.weaknessType,
    reviewItem?.evidenceSummary,
    turnAnalysis?.assessment?.suggestedFollowup,
    ...(turnAnalysis?.assessment?.risks || []),
    turnAnalysis?.followupQuestion?.text,
    turn?.question?.topicLabel,
    turn?.question?.topicCategory,
    turn?.question?.text,
    evidenceSnippet
  ].filter(Boolean).join(" ");
}

async function collectFollowupCandidates({
  currentQuestionId,
  reviewItem,
  queryText,
  category,
  excludeIds,
  limit
}) {
  try {
    return await retrieveQuestionCandidates({
      currentQuestionId,
      reviewItem,
      queryText,
      category,
      excludeIds,
      limit
    });
  } catch (error) {
    questionBankLogger.warn("question_bank.followup_retrieval_failed", error, {
      currentQuestionId,
      category,
      queryPreview: String(queryText || "").slice(0, 120) || null
    });
    const keywordQuestions = await questionRepository.search({
      category: category || null,
      q: queryText || null,
      limit: Math.max(limit * 3, 10),
      orderBy: "updated_desc"
    });
    return {
      semanticDocs: [],
      keywordQuestions,
      candidateIds: uniqueIds(keywordQuestions.map((item) => item.id)),
      items: keywordQuestions.map((question, index) => ({
        question,
        score: Math.max(1, keywordQuestions.length - index),
        retrievalSignals: {
          semantic: false,
          reviewRecommended: false,
          keywordMatched: true
        }
      }))
    };
  }
}

export async function pickQuestionForInterview({
  category,
  queryText = "",
  excludeIds = [],
  limit = 20
} = {}) {
  await ensureQuestionBankSeeded();
  if (!category) {
    return null;
  }

  const retrieval = await retrieveQuestionCandidates({
    category,
    queryText,
    excludeIds,
    limit: Math.max(limit, 8)
  });

  return retrieval.items[0]?.question || null;
}

export async function pickFollowupQuestionForInterview({
  session,
  turn,
  decision,
  reviewItem = null,
  turnAnalysis = null,
  limit = 20
} = {}) {
  await ensureQuestionBankSeeded();

  const currentQuestionId = turn?.question?.questionId || turn?.question?.id || null;
  const excludeIds = uniqueIds([
    currentQuestionId,
    ...(session?.turns || []).map((item) => item.question?.questionId || item.question?.id || null)
  ]);
  const category = decision?.targetTopicCategory || turn?.question?.topicCategory || null;
  const queryText = buildFollowupQueryText({
    turn,
    turnAnalysis,
    reviewItem
  });
  const retrieval = await collectFollowupCandidates({
    currentQuestionId,
    reviewItem,
    queryText,
    category,
    excludeIds,
    limit: Math.max(limit, 8)
  });

  return retrieval.items
    .filter((entry) => !excludeIds.includes(entry.question.id))
    .filter((entry) => !category || entry.question.category === category)[0]?.question || null;
}

export async function recommendQuestionsForReview({
  category,
  weaknessType = "",
  excludeIds = [],
  limit = 3
} = {}) {
  await ensureQuestionBankSeeded();
  try {
    const retrieval = await retrieveQuestionCandidates({
      queryText: weaknessType,
      category,
      excludeIds,
      limit
    });
    return retrieval.items.map((entry) => entry.question).slice(0, limit);
  } catch (error) {
    questionBankLogger.warn("question_bank.review_retrieval_failed", error, {
      category,
      weaknessPreview: String(weaknessType || "").slice(0, 120) || null
    });
    const fallback = await questionRepository.search({
      category: category || null,
      q: weaknessType || null,
      limit: Math.max(limit * 3, 10),
      orderBy: "updated_desc"
    });
    return fallback
      .filter((question) => !(excludeIds || []).includes(question.id))
      .slice(0, limit);
  }
}

export async function getQuestionBankSnapshot(filter = {}) {
  const { category = null } = filter;
  const [categories, tags, items] = await Promise.all([
    listQuestionBankCategories(),
    listQuestionBankTags(category ? { category } : {}),
    listQuestionBank(filter)
  ]);

  return {
    categories,
    tags,
    items
  };
}
