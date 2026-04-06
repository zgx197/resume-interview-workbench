import crypto from "node:crypto";
import { createDbReviewRepository } from "../repositories/db/db-review-repository.js";
import { getQuestionBankItemsByIds, recommendQuestionsForReview } from "./question-bank-service.js";
import { upsertKnowledgeDocument } from "./knowledge-service.js";

const reviewRepository = createDbReviewRepository();

function computeHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function shouldCreateReviewItem(turn) {
  const score = Number(turn?.assessment?.score);
  return Boolean(
    turn?.assessment
    && (
      !Number.isFinite(score)
      || score <= 3
      || turn.assessment.followupNeeded
    )
  );
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

async function hydrateReviewItemRecommendations(items = []) {
  const questionIds = items.flatMap((item) => item.recommendedQuestionIds || []);
  const questions = await getQuestionBankItemsByIds(questionIds);
  const questionMap = new Map(questions.map((question) => [question.id, question]));

  return items.map((item) => ({
    ...item,
    recommendedQuestions: (item.recommendedQuestionIds || [])
      .map((questionId) => questionMap.get(questionId))
      .filter(Boolean)
  }));
}

function deriveReviewProgress(item, attempts = []) {
  const latestAttempt = attempts[0] || null;
  const successfulAttempts = attempts.filter((attempt) => (
    attempt.outcome === "mastered"
    || (Number.isFinite(attempt.score) && attempt.score >= 4)
  )).length;
  const masteryLevel = Math.max(item.masteryLevel || 0, successfulAttempts);
  const status = item.status === "mastered" || successfulAttempts >= 2
    ? "mastered"
    : attempts.length
      ? "reviewing"
      : item.status;

  return {
    latestAttempt,
    attemptCount: attempts.length,
    masteryLevel,
    status
  };
}

async function hydrateReviewSetRecommendations(sets = []) {
  const questionIds = sets.flatMap((set) => (
    (set.items || []).flatMap((item) => item.reviewItem?.recommendedQuestionIds || [])
  ));
  const questions = await getQuestionBankItemsByIds(questionIds);
  const questionMap = new Map(questions.map((question) => [question.id, question]));

  return sets.map((set) => ({
    ...set,
    items: (set.items || []).map((item) => ({
      ...item,
      reviewItem: {
        ...item.reviewItem,
        recommendedQuestions: (item.reviewItem?.recommendedQuestionIds || [])
          .map((questionId) => questionMap.get(questionId))
          .filter(Boolean)
      }
    }))
  }));
}

export async function syncReviewArtifactsForTurn(session, turn) {
  if (!shouldCreateReviewItem(turn)) {
    return null;
  }

  const now = new Date().toISOString();
  const reviewKey = `review:${session.id}:${turn.index}`;
  const weaknessType = firstNonEmpty([
    turn.assessment?.risks?.[0],
    turn.assessment?.suggestedFollowup,
    "needs_review"
  ], "needs_review");
  const recommendedQuestions = await recommendQuestionsForReview({
    category: turn.question?.topicCategory || null,
    weaknessType,
    limit: 3
  });
  const evidenceSummary = firstNonEmpty([
    turn.assessment?.risks?.[0],
    turn.assessment?.suggestedFollowup,
    turn.answer?.slice(0, 200)
  ], turn.answer?.slice(0, 200) || "");
  const item = await reviewRepository.upsertItem({
    id: `review_${session.id}_${turn.index}`,
    reviewKey,
    sourceSessionId: session.id,
    sourceTurnId: `${session.id}:${turn.index}`,
    questionId: turn.question?.questionId || turn.question?.id || null,
    topicId: turn.question?.topicId || null,
    topicLabel: turn.question?.topicLabel || turn.question?.topicCategory || "",
    weaknessType,
    title: `${turn.question?.topicLabel || turn.question?.topicCategory || "topic"} review`,
    evidenceSummary,
    recommendedQuestionIds: recommendedQuestions.map((question) => question.id),
    priority: 50,
    status: "pending",
    masteryLevel: 0,
    metadata: {
      sessionId: session.id,
      turnIndex: turn.index,
      questionId: turn.question?.questionId || turn.question?.id || null,
      score: turn.assessment?.score ?? null,
      followupNeeded: Boolean(turn.assessment?.followupNeeded)
    },
    createdAt: now,
    updatedAt: now,
    resolvedAt: null
  });

  if (!item) {
    return null;
  }

  await upsertKnowledgeDocument({
    id: `knowledge_${item.id}`,
    documentKey: `review_item:${item.id}`,
    documentType: "review_item",
    sourceTable: "review_items",
    sourceId: item.id,
    title: item.title,
    content: [
      item.topicLabel,
      item.weaknessType,
      item.evidenceSummary
    ].filter(Boolean).join("\n"),
    metadata: {
      questionId: item.questionId,
      topicId: item.topicId,
      topicLabel: item.topicLabel,
      recommendedQuestionIds: item.recommendedQuestionIds
    },
    status: item.status,
    contentHash: computeHash(`${item.title}\n${item.evidenceSummary}`),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  });

  return item;
}

export async function listReviewItems(filter = {}) {
  return hydrateReviewItemRecommendations(await reviewRepository.list(filter));
}

export async function getReviewItem(reviewKey) {
  const item = await reviewRepository.getByReviewKey(reviewKey);
  if (!item) {
    return null;
  }
  return (await hydrateReviewItemRecommendations([item]))[0];
}

export async function updateReviewItemStatus(reviewKey, patch = {}) {
  const updated = await reviewRepository.updateStatus(reviewKey, patch);
  if (!updated) {
    return null;
  }

  await upsertKnowledgeDocument({
    id: `knowledge_${updated.id}`,
    documentKey: `review_item:${updated.id}`,
    documentType: "review_item",
    sourceTable: "review_items",
    sourceId: updated.id,
    title: updated.title,
    content: [
      updated.topicLabel,
      updated.weaknessType,
      updated.evidenceSummary
    ].filter(Boolean).join("\n"),
    metadata: {
      questionId: updated.questionId,
      topicId: updated.topicId,
      topicLabel: updated.topicLabel,
      recommendedQuestionIds: updated.recommendedQuestionIds,
      masteryLevel: updated.masteryLevel
    },
    status: updated.status,
    contentHash: computeHash(`${updated.title}\n${updated.evidenceSummary}\n${updated.status}`),
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt
  });

  return (await hydrateReviewItemRecommendations([updated]))[0];
}

export async function listReviewAttempts(reviewKey, filter = {}) {
  return reviewRepository.listAttempts(reviewKey, filter);
}

export async function recordReviewAttempt(reviewKey, input = {}) {
  const existing = await reviewRepository.getByReviewKey(reviewKey);
  if (!existing) {
    return null;
  }

  const attempt = await reviewRepository.recordAttempt(reviewKey, {
    id: input.id || `review_attempt_${crypto.randomUUID()}`,
    sessionId: input.sessionId || null,
    questionId: input.questionId || existing.questionId || null,
    score: input.score ?? null,
    outcome: input.outcome || "reviewed",
    notes: input.notes || "",
    metadata: input.metadata || {},
    attemptedAt: input.attemptedAt || new Date().toISOString(),
    createdAt: input.createdAt || new Date().toISOString()
  });
  if (!attempt) {
    return null;
  }

  const attempts = await reviewRepository.listAttempts(reviewKey, {
    limit: 20
  });
  const progress = deriveReviewProgress(existing, attempts);
  const updated = await updateReviewItemStatus(reviewKey, {
    status: input.status || progress.status,
    masteryLevel: progress.masteryLevel,
    metadata: {
      latestAttemptAt: attempt.attemptedAt,
      attemptCount: progress.attemptCount
    },
    updatedAt: attempt.attemptedAt,
    resolvedAt: progress.status === "mastered" ? attempt.attemptedAt : null
  });

  return {
    attempt,
    reviewItem: updated || null
  };
}

export async function listReviewSets(filter = {}) {
  return hydrateReviewSetRecommendations(await reviewRepository.listSets(filter));
}

export async function getReviewSet(setId) {
  const set = await reviewRepository.getSetById(setId);
  if (!set) {
    return null;
  }
  return (await hydrateReviewSetRecommendations([set]))[0];
}

export async function saveReviewSet(input = {}) {
  const now = new Date().toISOString();
  const setId = input.id || `review_set_${crypto.randomUUID()}`;
  const reviewKeys = Array.isArray(input.reviewKeys)
    ? input.reviewKeys.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const reviewItems = (await Promise.all(reviewKeys.map((reviewKey) => reviewRepository.getByReviewKey(reviewKey))))
    .filter(Boolean);
  const saved = await reviewRepository.saveSet({
    id: setId,
    setKey: input.setKey || setId,
    title: String(input.title || "").trim() || "Review Set",
    description: String(input.description || "").trim(),
    status: String(input.status || "active").trim() || "active",
    metadata: {
      source: input.source || "manual",
      reviewKeyCount: reviewKeys.length,
      ...(input.metadata || {})
    },
    items: reviewItems.map((item, index) => ({
      reviewItemId: item.id,
      position: index + 1,
      addedAt: now,
      metadata: {
        reviewKey: item.reviewKey
      }
    })),
    createdAt: input.createdAt || now,
    updatedAt: now,
    archivedAt: input.archivedAt || null
  });
  if (!saved) {
    return null;
  }
  return (await hydrateReviewSetRecommendations([saved]))[0];
}

export async function recommendReviewSet(input = {}) {
  const now = new Date().toISOString();
  const status = String(input.status || "pending").trim() || "pending";
  const limit = Number.isFinite(Number(input.limit)) ? Math.max(1, Math.floor(Number(input.limit))) : 5;
  const items = await listReviewItems({
    status,
    sessionId: input.sessionId || null,
    topicId: input.topicId || null,
    limit
  });
  const title = String(input.title || "").trim() || "Recommended Review Set";

  if (!input.persist) {
    return {
      id: null,
      setKey: null,
      title,
      description: String(input.description || "").trim(),
      status: "draft",
      metadata: {
        source: "recommended",
        status,
        sessionId: input.sessionId || null,
        topicId: input.topicId || null,
        reviewItemCount: items.length
      },
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      items: items.map((item, index) => ({
        reviewItem: item,
        position: index + 1,
        addedAt: now,
        metadata: {
          reviewKey: item.reviewKey
        }
      }))
    };
  }

  return saveReviewSet({
    title,
    description: String(input.description || "").trim(),
    status: input.reviewSetStatus || "active",
    source: "recommended",
    metadata: {
      sourceStatus: status,
      sessionId: input.sessionId || null,
      topicId: input.topicId || null
    },
    reviewKeys: items.map((item) => item.reviewKey)
  });
}
