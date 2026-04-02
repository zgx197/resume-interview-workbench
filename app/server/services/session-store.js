import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { readJson, writeJson } from "../lib/fs-utils.js";

function sessionFilePath(sessionId) {
  return path.join(config.sessionDir, `${sessionId}.json`);
}

export function createSessionId() {
  return `session_${crypto.randomUUID()}`;
}

export async function saveSession(session) {
  await writeJson(sessionFilePath(session.id), session);
}

export async function loadSession(sessionId) {
  return readJson(sessionFilePath(sessionId));
}

export async function listSessions() {
  try {
    const entries = await fs.readdir(config.sessionDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const sessions = await Promise.all(files.map((file) => readJson(path.join(config.sessionDir, file.name))));
    return sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
