import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { readJson, writeJson } from "../lib/fs-utils.js";
import { createLogger } from "../lib/logger.js";
import { createDbSessionRepository } from "../repositories/db/db-session-repository.js";
import {
  hydrateRuntimeSessionFromDbRecord,
  hydrateRuntimeSessionSummariesFromDbRecords,
  hydrateRuntimeSessionsFromDbRecords
} from "./runtime-read-service.js";

const sessionStoreLogger = createLogger({ component: "session-store" });
const dbSessionRepository = createDbSessionRepository();

function normalizeFilePath(filePath) {
  return path.relative(config.repoRoot, filePath).replace(/\\/g, "/");
}

// 每场面试一个 JSON 文件，既方便回放，也方便后续按 session 维度追查耗时。
function sessionFilePath(sessionId) {
  return path.join(config.sessionDir, `${sessionId}.json`);
}

function runtimeStorageMode() {
  return String(config.interviewRuntimeStorageMode || "database_only").toLowerCase();
}

export function shouldPersistSessionsToDb() {
  return runtimeStorageMode() !== "file";
}

export function shouldPersistSessionsToFile() {
  return runtimeStorageMode() !== "database_only";
}

function normalizeSessionSnapshot(snapshot, fallback = {}, persistedRecord = {}) {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && snapshot.id) {
    return {
      ...snapshot,
      id: snapshot.id || persistedRecord.id || fallback.id,
      status: snapshot.status || persistedRecord.status || fallback.status,
      createdAt: snapshot.createdAt || persistedRecord.createdAt || fallback.createdAt,
      updatedAt: snapshot.updatedAt || persistedRecord.updatedAt || fallback.updatedAt,
      version: persistedRecord.version ?? snapshot.version ?? fallback.version ?? null
    };
  }
  return fallback;
}

async function listFileSessions() {
  const entries = await fs.readdir(config.sessionDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  return Promise.all(files.map((file) => readJson(path.join(config.sessionDir, file.name))));
}

export function createSessionId() {
  return `session_${crypto.randomUUID()}`;
}

export async function mirrorSessionToFile(session, logContext = {}) {
  if (!shouldPersistSessionsToFile()) {
    return session;
  }

  const logger = sessionStoreLogger.child({
    sessionId: session.id,
    ...logContext
  });
  const filePath = sessionFilePath(session.id);
  const span = logger.startSpan("storage.session.mirror", {
    filePath: normalizeFilePath(filePath)
  });

  try {
    await writeJson(filePath, session, {
      sessionId: session.id,
      ...logContext
    });
    span.end({
      status: session.status || "unknown",
      turns: session.turns?.length || 0
    });
  } catch (error) {
    span.fail(error, {
      status: session.status || "unknown",
      turns: session.turns?.length || 0
    });
    throw error;
  }
}

export const saveSession = mirrorSessionToFile;

export async function loadSession(sessionId, logContext = {}) {
  const logger = sessionStoreLogger.child({
    sessionId,
    ...logContext
  });
  const filePath = sessionFilePath(sessionId);
  const span = logger.startSpan("storage.session.load", {
    filePath: normalizeFilePath(filePath)
  });

  try {
    let session = null;

    if (shouldPersistSessionsToDb()) {
      try {
        const dbRecord = await dbSessionRepository.getById(sessionId);
        session = dbRecord ? await hydrateRuntimeSessionFromDbRecord(dbRecord) : null;
      } catch (error) {
        logger.warn("storage.session.load_db_failed", error, {
          storageMode: runtimeStorageMode()
        });
      }
    }

    if (!session) {
      if (!shouldPersistSessionsToFile()) {
        const error = new Error(`Session not found in database: ${sessionId}`);
        error.code = "SESSION_NOT_FOUND";
        error.sessionId = sessionId;
        throw error;
      }

      session = await readJson(filePath, {
        sessionId,
        ...logContext
      });
    }

    span.end({
      status: session.status || "unknown",
      turns: session.turns?.length || 0
    });
    return session;
  } catch (error) {
    span.fail(error);
    throw error;
  }
}

export async function listSessions() {
  const span = sessionStoreLogger.startSpan("storage.session.list");

  try {
    if (shouldPersistSessionsToDb()) {
      try {
        const dbSessions = await dbSessionRepository.listRecent({
          limit: 200
        });
        const snapshots = hydrateRuntimeSessionSummariesFromDbRecords(dbSessions)
          .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
        if (snapshots.length || !shouldPersistSessionsToFile()) {
          span.end({
            sessionCount: snapshots.length,
            source: "database"
          });
          return snapshots;
        }
      } catch (error) {
        sessionStoreLogger.warn("storage.session.list_db_failed", error, {
          storageMode: runtimeStorageMode()
        });
        if (!shouldPersistSessionsToFile()) {
          throw error;
        }
      }
    }

    const sessions = await listFileSessions();
    const sortedSessions = sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    span.end({
      sessionCount: sortedSessions.length,
      source: "file"
    });
    return sortedSessions;
  } catch (error) {
    if (error.code === "ENOENT") {
      span.end({
        sessionCount: 0,
        source: "file"
      });
      return [];
    }

    span.fail(error);
    throw error;
  }
}

export async function listResumableSessions() {
  const span = sessionStoreLogger.startSpan("storage.session.list_resumable");

  try {
    if (shouldPersistSessionsToDb()) {
      try {
        const dbSessions = await dbSessionRepository.listResumableRuns({
          limit: 100
        });
        const snapshots = await hydrateRuntimeSessionsFromDbRecords(dbSessions);
        span.end({
          sessionCount: snapshots.length,
          source: "database"
        });
        return snapshots;
      } catch (error) {
        sessionStoreLogger.warn("storage.session.list_resumable_db_failed", error, {
          storageMode: runtimeStorageMode()
        });
        if (!shouldPersistSessionsToFile()) {
          throw error;
        }
      }
    }

    const sessions = await listFileSessions();
    const resumableSessions = sessions.filter((session) => (
      session.status === "processing" &&
      session.currentRun?.status === "running" &&
      ["start", "answer"].includes(session.currentRun?.kind)
    ));
    span.end({
      sessionCount: resumableSessions.length,
      source: "file"
    });
    return resumableSessions;
  } catch (error) {
    if (error.code === "ENOENT") {
      span.end({
        sessionCount: 0,
        source: "file"
      });
      return [];
    }

    span.fail(error);
    throw error;
  }
}
