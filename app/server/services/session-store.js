import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { readJson, writeJson } from "../lib/fs-utils.js";
import { createLogger } from "../lib/logger.js";

const sessionStoreLogger = createLogger({ component: "session-store" });

function normalizeFilePath(filePath) {
  return path.relative(config.repoRoot, filePath).replace(/\\/g, "/");
}

// 每场面试一个 JSON 文件，既方便回放，也方便后续按 session 维度追查耗时。
function sessionFilePath(sessionId) {
  return path.join(config.sessionDir, `${sessionId}.json`);
}

export function createSessionId() {
  return `session_${crypto.randomUUID()}`;
}

export async function saveSession(session, logContext = {}) {
  const logger = sessionStoreLogger.child({
    sessionId: session.id,
    ...logContext
  });
  const filePath = sessionFilePath(session.id);
  const span = logger.startSpan("storage.session.save", {
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
    const session = await readJson(filePath, {
      sessionId,
      ...logContext
    });
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
    const entries = await fs.readdir(config.sessionDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const sessions = await Promise.all(files.map((file) => readJson(path.join(config.sessionDir, file.name))));
    const sortedSessions = sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    span.end({
      sessionCount: sortedSessions.length
    });
    return sortedSessions;
  } catch (error) {
    if (error.code === "ENOENT") {
      span.end({
        sessionCount: 0
      });
      return [];
    }

    span.fail(error);
    throw error;
  }
}
