import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "./logger.js";

const fsLogger = createLogger({ component: "fs-utils" });

function normalizeFilePath(filePath) {
  return path.relative(config.repoRoot, filePath).replace(/\\/g, "/");
}

// 统一封装 JSON 文件读写，并在最底层补齐 I/O 日志，
// 这样上层即使只知道“某次加载变慢”，也能继续下钻到具体文件读写。
export async function readJson(filePath, logContext = {}) {
  const logger = fsLogger.child(logContext);
  const normalizedPath = normalizeFilePath(filePath);
  const span = logger.startSpan("storage.json.read", {
    filePath: normalizedPath
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      span.end({
        filePath: normalizedPath,
        attempts: attempt + 1,
        sizeBytes: Buffer.byteLength(raw, "utf8")
      });
      return parsed;
    } catch (error) {
      const retryable = error instanceof SyntaxError || error.code === "ENOENT";
      if (!retryable || attempt === 3) {
        span.fail(error, {
          filePath: normalizedPath,
          attempts: attempt + 1
        });
        throw error;
      }

      logger.warn("storage.json.retry", error, {
        filePath: normalizedPath,
        attempts: attempt + 1,
        nextDelayMs: 20 * (attempt + 1)
      });
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }

  throw new Error(`Unable to read JSON file: ${filePath}`);
}

export async function writeJson(filePath, value, logContext = {}) {
  const logger = fsLogger.child(logContext);
  const normalizedPath = normalizeFilePath(filePath);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const span = logger.startSpan("storage.json.write", {
    filePath: normalizedPath,
    sizeBytes: Buffer.byteLength(serialized, "utf8")
  });

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFilePath, serialized, "utf8");

  try {
    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    if (["EEXIST", "EPERM"].includes(error.code)) {
      logger.warn("storage.json.rename_retry", error, {
        filePath: normalizedPath,
        tempFilePath: normalizeFilePath(tempFilePath)
      });
      await fs.rm(filePath, { force: true });
      await fs.rename(tempFilePath, filePath);
    } else {
      span.fail(error, {
        filePath: normalizedPath
      });
      throw error;
    }
  } finally {
    await fs.rm(tempFilePath, { force: true }).catch(() => {});
  }

  span.end({
    filePath: normalizedPath,
    tempFilePath: normalizeFilePath(tempFilePath)
  });
}

export async function listJsonFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));
}
