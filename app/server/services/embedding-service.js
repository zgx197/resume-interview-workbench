import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";
import { createDbBackgroundJobRepository } from "../repositories/db/db-background-job-repository.js";
import { createDbKnowledgeEmbeddingRepository } from "../repositories/db/db-knowledge-embedding-repository.js";
import { createDbKnowledgeRepository } from "../repositories/db/db-knowledge-repository.js";

const embeddingLogger = createLogger({ component: "embedding-service" });
const knowledgeRepository = createDbKnowledgeRepository();
const knowledgeEmbeddingRepository = createDbKnowledgeEmbeddingRepository();
const backgroundJobRepository = createDbBackgroundJobRepository();
const inFlightDocuments = new Set();
export const EMBEDDING_JOB_KIND = "knowledge_embedding_sync";

function nowIso() {
  return new Date().toISOString();
}

function embeddingJobKey(documentId) {
  return `knowledge:${documentId}:${config.embeddingModel}`;
}

export function isEmbeddingConfigured() {
  return Boolean(
    String(config.embeddingProvider || "").trim()
    && String(config.embeddingApiKey || "").trim()
    && String(config.embeddingModel || "").trim()
    && String(config.embeddingBaseUrl || "").trim()
  );
}

function formatEmbeddingVector(values) {
  const numbers = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!numbers.length) {
    throw new Error("Embedding provider returned an empty vector.");
  }
  return `[${numbers.join(",")}]`;
}

async function fetchEmbeddingFromProvider(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${config.embeddingBaseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.embeddingApiKey}`
      },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: text,
        ...(config.embeddingDimensions ? { dimensions: config.embeddingDimensions } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding request failed with status ${response.status}: ${body.slice(0, 400)}`);
    }

    const payload = await response.json();
    const embedding = payload?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || !embedding.length) {
      throw new Error("Embedding response did not include data[0].embedding.");
    }

    return embedding;
  } finally {
    clearTimeout(timeout);
  }
}

async function upsertEmbeddingJobSnapshot({
  document,
  status,
  attempts = 0,
  scheduledAt = null,
  startedAt = null,
  finishedAt = null,
  lastError = null
}) {
  const timestamp = nowIso();
  return backgroundJobRepository.upsertSnapshot({
    id: `job:${embeddingJobKey(document.id)}`,
    jobKey: embeddingJobKey(document.id),
    kind: EMBEDDING_JOB_KIND,
    targetType: "knowledge_document",
    targetId: document.id,
    sessionId: null,
    status,
    attempts,
    scheduledAt: scheduledAt || timestamp,
    startedAt,
    finishedAt,
    lastError,
    payload: {
      documentKey: document.documentKey,
      documentType: document.documentType,
      embeddingModel: config.embeddingModel
    },
    result: status === "completed"
      ? {
          contentHash: document.contentHash
        }
      : {},
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function buildEmbeddingJobPayload(document) {
  return {
    documentKey: document.documentKey,
    documentType: document.documentType,
    embeddingModel: config.embeddingModel
  };
}

export async function syncKnowledgeEmbeddingById(documentId, options = {}) {
  const document = await knowledgeRepository.getById(documentId);
  if (!document || document.status !== "active") {
    return null;
  }

  const recordJobSnapshot = options.recordJobSnapshot !== false;

  if (!isEmbeddingConfigured()) {
    if (recordJobSnapshot) {
      await upsertEmbeddingJobSnapshot({
        document,
        status: "skipped",
        finishedAt: nowIso(),
        lastError: "Embedding provider is not configured."
      });
    }
    if (options.throwOnUnavailable) {
      throw new Error("Embedding provider is not configured.");
    }
    return null;
  }

  const inFlightKey = embeddingJobKey(document.id);
  if (inFlightDocuments.has(inFlightKey)) {
    return null;
  }

  inFlightDocuments.add(inFlightKey);
  const startedAt = nowIso();
  try {
    if (recordJobSnapshot) {
      await upsertEmbeddingJobSnapshot({
        document,
        status: "running",
        attempts: 1,
        startedAt
      });
    }
    const vector = await fetchEmbeddingFromProvider(document.content);
    const timestamp = nowIso();
    const saved = await knowledgeEmbeddingRepository.upsertEmbedding({
      id: `embedding:${document.id}:${config.embeddingModel}`,
      documentId: document.id,
      embeddingModel: config.embeddingModel,
      embeddingVersion: config.embeddingProvider,
      embeddingVector: formatEmbeddingVector(vector),
      contentHash: document.contentHash,
      createdAt: startedAt,
      updatedAt: timestamp
    });
    if (recordJobSnapshot) {
      await upsertEmbeddingJobSnapshot({
        document,
        status: "completed",
        attempts: 1,
        startedAt,
        finishedAt: timestamp
      });
    }
    return saved;
  } catch (error) {
    if (recordJobSnapshot) {
      await upsertEmbeddingJobSnapshot({
        document,
        status: "failed",
        attempts: 1,
        startedAt,
        finishedAt: nowIso(),
        lastError: error.message
      });
      embeddingLogger.warn("embedding.sync_failed", error, {
        documentId,
        documentType: document.documentType
      });
      return null;
    }

    throw error;
  } finally {
    inFlightDocuments.delete(inFlightKey);
  }
}

export function scheduleKnowledgeEmbeddingSync(document) {
  if (!document || !config.embeddingSyncOnWrite || !isEmbeddingConfigured()) {
    return;
  }

  const timestamp = nowIso();
  const jobKey = embeddingJobKey(document.id);
  void backgroundJobRepository.getByJobKey(jobKey).then((existing) => {
    if (existing?.status === "leased" || existing?.status === "running") {
      return existing;
    }

    return backgroundJobRepository.upsertSnapshot({
      id: `job:${jobKey}`,
      jobKey,
      kind: EMBEDDING_JOB_KIND,
      targetType: "knowledge_document",
      targetId: document.id,
      sessionId: null,
      status: "pending",
      attempts: 0,
      scheduledAt: timestamp,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      payload: buildEmbeddingJobPayload(document),
      result: {},
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }).catch((error) => {
    embeddingLogger.warn("embedding.schedule_failed", error, {
      documentId: document.id,
      documentType: document.documentType
    });
  });
}

export async function syncPendingKnowledgeEmbeddings({ limit = 20, documentType = null } = {}) {
  if (!isEmbeddingConfigured()) {
    return [];
  }

  const staleDocuments = await knowledgeEmbeddingRepository.listStaleDocuments({
    embeddingModel: config.embeddingModel,
    documentType,
    limit
  });

  const results = [];
  for (const document of staleDocuments) {
    results.push(await syncKnowledgeEmbeddingById(document.id));
  }
  return results.filter(Boolean);
}

export async function getKnowledgeEmbeddingStatus(documentId) {
  return knowledgeEmbeddingRepository.getByDocumentId(documentId, config.embeddingModel);
}

export async function searchSimilarKnowledgeByText({
  query,
  documentType = null,
  limit = 10
} = {}) {
  if (!isEmbeddingConfigured()) {
    return [];
  }

  const text = String(query || "").trim();
  if (!text) {
    return [];
  }

  const vector = await fetchEmbeddingFromProvider(text);
  return knowledgeEmbeddingRepository.searchNearestByVector({
    embeddingModel: config.embeddingModel,
    embeddingVector: formatEmbeddingVector(vector),
    documentType,
    limit
  });
}

export async function searchSimilarKnowledgeByDocument({
  documentId,
  documentType = null,
  limit = 10
} = {}) {
  if (!isEmbeddingConfigured() || !documentId) {
    return [];
  }

  return knowledgeEmbeddingRepository.searchNearestToDocument({
    documentId,
    embeddingModel: config.embeddingModel,
    documentType,
    limit
  });
}
