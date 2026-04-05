import fs from "node:fs/promises";
import path from "node:path";

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "unserializable_log_entry" });
  }
}

function selectConsoleMethod(level) {
  if (level === "error") {
    return console.error;
  }
  if (level === "warn") {
    return console.warn;
  }
  return console.log;
}

function buildPrettyLine(entry) {
  const segments = [
    entry.ts,
    entry.level.toUpperCase().padEnd(5, " "),
    `[${entry.component}]`,
    entry.event
  ];

  for (const key of ["requestId", "sessionId", "runId", "threadId", "jobId"]) {
    if (entry[key]) {
      segments.push(`${key}=${entry[key]}`);
    }
  }

  if (Number.isFinite(entry.turnIndex)) {
    segments.push(`turnIndex=${entry.turnIndex}`);
  }

  if (Number.isFinite(entry.durationMs)) {
    segments.push(`durationMs=${entry.durationMs}`);
  }

  if (entry.meta && Object.keys(entry.meta).length) {
    segments.push(`meta=${safeStringify(entry.meta)}`);
  }

  if (entry.error) {
    segments.push(`error=${safeStringify(entry.error)}`);
  }

  return segments.join(" ");
}

// 控制台 sink 面向开发时即时观察，支持 pretty 与 json 两种格式。
export function createConsoleSink({ format = "pretty" } = {}) {
  return {
    name: "console",
    write(entry) {
      const method = selectConsoleMethod(entry.level);
      method(format === "json" ? safeStringify(entry) : buildPrettyLine(entry));
    }
  };
}

// 文件 sink 统一使用 JSONL 追加写入，并通过内部 Promise 队列避免并发写乱序。
export function createJsonlFileSink({ dirPath, enabled = true } = {}) {
  let writeQueue = Promise.resolve();
  let dirReadyPromise = null;
  let lastSinkErrorAt = 0;

  async function ensureDir() {
    if (!dirReadyPromise) {
      dirReadyPromise = fs.mkdir(dirPath, { recursive: true });
    }
    await dirReadyPromise;
  }

  async function appendLine(entry) {
    await ensureDir();
    const dateTag = String(entry.ts || "").slice(0, 10) || "unknown-date";
    const filePath = path.join(dirPath, `app-${dateTag}.jsonl`);
    await fs.appendFile(filePath, `${safeStringify(entry)}\n`, "utf8");
  }

  function reportSinkError(error) {
    const now = Date.now();
    if (now - lastSinkErrorAt < 5000) {
      return;
    }
    lastSinkErrorAt = now;
    console.error(`[logger] failed to write JSONL log: ${error.message}`);
  }

  return {
    name: "jsonl-file",
    write(entry) {
      if (!enabled || !dirPath) {
        return;
      }

      writeQueue = writeQueue
        .catch(() => {})
        .then(() => appendLine(entry))
        .catch((error) => {
          reportSinkError(error);
        });
    },
    async drain() {
      await writeQueue.catch(() => {});
    }
  };
}
