import { createDbKnowledgeRepository } from "../repositories/db/db-knowledge-repository.js";
import { createDbQuestionRepository } from "../repositories/db/db-question-repository.js";
import { searchSimilarKnowledgeByDocument, searchSimilarKnowledgeByText } from "./embedding-service.js";

const knowledgeRepository = createDbKnowledgeRepository();
const questionRepository = createDbQuestionRepository();

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？?()（）\-_/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function uniqueIds(values = []) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
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

function mergeKnowledgeCandidates({ lexicalResults = [], semanticResults = [], query = "", limit = 10 }) {
  const merged = new Map();

  for (const document of lexicalResults) {
    const lexicalScore = scoreLexicalKnowledgeDocument(document, query);
    merged.set(document.id, {
      ...document,
      retrievalScore: lexicalScore,
      retrievalSignals: {
        lexical: lexicalScore > 0,
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
    merged.set(document.id, {
      ...current,
      ...document,
      retrievalScore: Number((current.retrievalScore + semanticScore).toFixed(4)),
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
    limit
  });
}

export async function collectQuestionCandidateIds({
  currentQuestionId = null,
  reviewItem = null,
  queryText = "",
  category = null,
  limit = 8
} = {}) {
  const semanticDocs = [];

  if (reviewItem?.id) {
    semanticDocs.push(...await retrieveKnowledgeDocuments({
      documentId: `knowledge_${reviewItem.id}`,
      documentType: "question",
      limit
    }));
  }

  if (currentQuestionId) {
    semanticDocs.push(...await retrieveKnowledgeDocuments({
      documentId: `knowledge_${currentQuestionId}`,
      documentType: "question",
      limit
    }));
  }

  if (String(queryText || "").trim()) {
    semanticDocs.push(...await retrieveKnowledgeDocuments({
      query: queryText,
      documentType: "question",
      limit
    }));
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

  return {
    semanticDocs,
    keywordQuestions,
    candidateIds: uniqueIds([
      ...(reviewItem?.recommendedQuestionIds || []),
      ...semanticDocs
        .filter((item) => item.sourceTable === "question_items")
        .map((item) => item.sourceId),
      ...keywordQuestions.map((item) => item.id)
    ])
  };
}
