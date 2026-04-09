import { createDbKnowledgeRepository } from "../repositories/db/db-knowledge-repository.js";
import { createDbQuestionRepository } from "../repositories/db/db-question-repository.js";
import { searchSimilarKnowledgeByDocument, searchSimilarKnowledgeByText } from "./embedding-service.js";

const knowledgeRepository = createDbKnowledgeRepository();
const questionRepository = createDbQuestionRepository();

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[\s,.;:!?锛屻€傦紱锛氾紒锛?()锛堬級\-_/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function uniqueIds(values = []) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function questionContent(question) {
  return [
    question?.canonicalText || "",
    ...(question?.tags || []).map((tag) => tag.label),
    ...(question?.variants || []).map((variant) => variant.text)
  ].join("\n").toLowerCase();
}

function scoreLexicalKnowledgeDocument(document, query) {
  const tokens = tokenize(query);
  if (!tokens.length) {
    return 0;
  }

  const title = String(document?.title || "").toLowerCase();
  const content = String(document?.content || "").toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (title.includes(token)) {
      score += 6;
    }
    if (content.includes(token)) {
      score += 2;
    }
  }

  return score;
}

function buildKnowledgeRerankScore(document, filter = {}) {
  const metadata = document?.metadata || {};
  let score = 0;

  if (filter.documentType && document?.documentType === filter.documentType) {
    score += 8;
  }
  if (filter.sourceTable && document?.sourceTable === filter.sourceTable) {
    score += 5;
  }
  if (filter.sourceId && document?.sourceId === filter.sourceId) {
    score += 12;
  }
  if (filter.status && document?.status === filter.status) {
    score += 2;
  }
  if (filter.category && metadata.category === filter.category) {
    score += 6;
  }
  if (filter.tagKey && Array.isArray(metadata.tagKeys) && metadata.tagKeys.includes(filter.tagKey)) {
    score += 6;
  }

  return score;
}

function mergeKnowledgeCandidates({ lexicalResults = [], semanticResults = [], query = "", filter = {}, limit = 10 }) {
  const merged = new Map();

  for (const document of lexicalResults) {
    const pureLexicalScore = scoreLexicalKnowledgeDocument(document, query);
    const rerankScore = buildKnowledgeRerankScore(document, filter);
    merged.set(document.id, {
      ...document,
      retrievalScore: pureLexicalScore + rerankScore,
      retrievalSignals: {
        lexical: pureLexicalScore > 0,
        semantic: false
      }
    });
  }

  for (const document of semanticResults) {
    const current = merged.get(document.id) || {
      ...document,
      retrievalScore: 0,
      retrievalSignals: {
        lexical: false,
        semantic: false
      }
    };
    const semanticDistance = document.distance == null ? null : Number(document.distance);
    const semanticScore = semanticDistance == null
      ? 0
      : Math.max(0, (1.2 - semanticDistance) * 20);
    const rerankScore = buildKnowledgeRerankScore(document, filter);
    merged.set(document.id, {
      ...current,
      ...document,
      retrievalScore: Number((current.retrievalScore + semanticScore + rerankScore).toFixed(4)),
      retrievalSignals: {
        lexical: Boolean(current.retrievalSignals?.lexical),
        semantic: semanticScore > 0
      }
    });
  }

  return [...merged.values()]
    .sort((left, right) => (
      (right.retrievalScore || 0) - (left.retrievalScore || 0)
      || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
      || String(left.id).localeCompare(String(right.id))
    ))
    .slice(0, limit);
}

export async function retrieveKnowledgeDocuments(filter = {}) {
  const limit = Number.isFinite(Number(filter.limit)) ? Math.max(1, Math.floor(Number(filter.limit))) : 10;
  const query = String(filter.query || filter.q || "").trim();
  const lexicalLimit = Math.max(limit * 3, 12);
  const semanticLimit = Math.max(limit * 2, 8);

  const lexicalResults = query || filter.sourceId || filter.documentType || filter.sourceTable || filter.status
    ? await knowledgeRepository.list({
        q: query || null,
        documentType: filter.documentType || null,
        sourceTable: filter.sourceTable || null,
        sourceId: filter.sourceId || null,
        status: filter.status || "active",
        limit: lexicalLimit
      })
    : [];

  let semanticResults = [];
  if (filter.documentId) {
    semanticResults = await searchSimilarKnowledgeByDocument({
      documentId: filter.documentId,
      documentType: filter.documentType || null,
      limit: semanticLimit
    });
  } else if (query) {
    semanticResults = await searchSimilarKnowledgeByText({
      query,
      documentType: filter.documentType || null,
      limit: semanticLimit
    });
  }

  return mergeKnowledgeCandidates({
    lexicalResults,
    semanticResults,
    query,
    filter,
    limit
  });
}

function scoreQuestionCandidate(question, context = {}) {
  if (!question) {
    return Number.NEGATIVE_INFINITY;
  }

  const excludeIds = context.excludeIds || [];
  if (excludeIds.includes(question.id)) {
    return Number.NEGATIVE_INFINITY;
  }

  const usageStats = question.usageStats || {};
  const tokens = tokenize(context.queryText);
  const content = questionContent(question);
  const tokenHits = tokens.reduce((count, token) => count + (content.includes(token) ? 1 : 0), 0);
  const askedCount = Number(usageStats.askedCount || 0);
  const answeredCount = Number(usageStats.answeredCount || 0);
  const avgScore = Number.isFinite(Number(usageStats.avgScore)) ? Number(usageStats.avgScore) : null;
  const semanticDistance = context.semanticDistanceByQuestionId?.get(question.id);
  const semanticBoost = semanticDistance == null ? 0 : Math.max(0, (1.15 - semanticDistance) * 18);
  const reviewBoost = (context.reviewBoostByQuestionId?.get(question.id) || 0) * 14;
  const keywordBoost = (context.keywordBoostByQuestionId?.get(question.id) || 0) * 4;
  const categoryBoost = context.category && question.category === context.category ? 8 : 0;

  return (
    tokenHits * 10
    + semanticBoost
    + reviewBoost
    + keywordBoost
    + categoryBoost
    + (avgScore == null ? 2 : 0)
    - askedCount * 0.6
    - answeredCount * 0.2
  );
}

export async function retrieveQuestionCandidates({
  currentQuestionId = null,
  reviewItem = null,
  queryText = "",
  category = null,
  excludeIds = [],
  limit = 8
} = {}) {
  const semanticDocs = [];
  const appendSemanticDocs = async (input) => {
    try {
      semanticDocs.push(...await retrieveKnowledgeDocuments(input));
    } catch {
      // Semantic retrieval is a ranking enhancement. If the embedding/provider
      // path is unavailable, we fall back to structured and keyword retrieval.
    }
  };

  if (reviewItem?.id) {
    await appendSemanticDocs({
      documentId: `knowledge_${reviewItem.id}`,
      documentType: "question",
      category: category || null,
      limit
    });
  }

  if (currentQuestionId) {
    await appendSemanticDocs({
      documentId: `knowledge_${currentQuestionId}`,
      documentType: "question",
      category: category || null,
      limit
    });
  }

  if (String(queryText || "").trim()) {
    await appendSemanticDocs({
      query: queryText,
      documentType: "question",
      category: category || null,
      limit
    });
  }

  const strictKeywordQuestions = await questionRepository.search({
    category: category || null,
    q: String(queryText || "").trim() || null,
    limit: Math.max(limit * 3, 10),
    orderBy: "updated_desc"
  });
  const fallbackQuestions = strictKeywordQuestions.length
    ? []
    : await questionRepository.search({
        category: category || null,
        limit: Math.max(limit * 3, 10),
        orderBy: "updated_desc"
      });
  const keywordQuestions = strictKeywordQuestions.length ? strictKeywordQuestions : fallbackQuestions;
  const candidateIds = uniqueIds([
    ...(reviewItem?.recommendedQuestionIds || []),
    ...semanticDocs
      .filter((item) => item.sourceTable === "question_items")
      .map((item) => item.sourceId),
    ...keywordQuestions.map((item) => item.id)
  ]);

  const hydratedCandidates = await Promise.all(candidateIds.map((questionId) => questionRepository.getById(questionId)));
  const semanticDistanceByQuestionId = new Map();
  for (const document of semanticDocs) {
    if (document.sourceTable !== "question_items" || !document.sourceId) {
      continue;
    }
    const currentDistance = semanticDistanceByQuestionId.get(document.sourceId);
    if (currentDistance == null || (document.distance != null && document.distance < currentDistance)) {
      semanticDistanceByQuestionId.set(document.sourceId, document.distance == null ? null : Number(document.distance));
    }
  }

  const reviewBoostByQuestionId = new Map();
  for (const questionId of reviewItem?.recommendedQuestionIds || []) {
    reviewBoostByQuestionId.set(questionId, (reviewBoostByQuestionId.get(questionId) || 0) + 1);
  }

  const keywordBoostByQuestionId = new Map();
  for (const question of keywordQuestions) {
    keywordBoostByQuestionId.set(question.id, (keywordBoostByQuestionId.get(question.id) || 0) + 1);
  }

  const items = hydratedCandidates
    .filter(Boolean)
    .filter((question) => !category || question.category === category)
    .map((question) => {
      const score = scoreQuestionCandidate(question, {
        queryText,
        category,
        excludeIds,
        semanticDistanceByQuestionId,
        reviewBoostByQuestionId,
        keywordBoostByQuestionId
      });
      return {
        question,
        score,
        retrievalSignals: {
          semantic: semanticDistanceByQuestionId.has(question.id),
          reviewRecommended: reviewBoostByQuestionId.has(question.id),
          keywordMatched: keywordBoostByQuestionId.has(question.id)
        }
      };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => (
      right.score - left.score
      || (left.question.usageStats?.askedCount || 0) - (right.question.usageStats?.askedCount || 0)
      || String(left.question.id).localeCompare(String(right.question.id))
    ))
    .slice(0, limit);

  return {
    semanticDocs,
    keywordQuestions,
    candidateIds,
    items
  };
}

export async function collectQuestionCandidateIds(input = {}) {
  const result = await retrieveQuestionCandidates(input);
  return {
    semanticDocs: result.semanticDocs,
    keywordQuestions: result.keywordQuestions,
    candidateIds: result.candidateIds
  };
}
