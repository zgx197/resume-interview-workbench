import { createDbKnowledgeRepository } from "../repositories/db/db-knowledge-repository.js";
import {
  scheduleKnowledgeEmbeddingSync,
  getKnowledgeEmbeddingStatus,
  searchSimilarKnowledgeByDocument,
  searchSimilarKnowledgeByText,
  syncPendingKnowledgeEmbeddings
} from "./embedding-service.js";

const knowledgeRepository = createDbKnowledgeRepository();

export async function upsertKnowledgeDocument(input) {
  const saved = await knowledgeRepository.upsertDocument(input);
  scheduleKnowledgeEmbeddingSync(saved);
  return saved;
}

export async function getKnowledgeDocumentById(documentId) {
  return knowledgeRepository.getById(documentId);
}

export async function getKnowledgeDocument(documentKey) {
  return knowledgeRepository.getByDocumentKey(documentKey);
}

export async function listKnowledgeDocuments(filter = {}) {
  return knowledgeRepository.list(filter);
}

export async function getKnowledgeDocumentEmbeddingStatus(documentId) {
  return getKnowledgeEmbeddingStatus(documentId);
}

export async function syncKnowledgeEmbeddings(filter = {}) {
  return syncPendingKnowledgeEmbeddings(filter);
}

export async function searchSimilarKnowledge(filter = {}) {
  if (filter.documentId) {
    return searchSimilarKnowledgeByDocument(filter);
  }

  return searchSimilarKnowledgeByText(filter);
}
