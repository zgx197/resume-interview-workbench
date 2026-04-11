import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const MANAGED_SETTING_KEYS = [
  "AI_PROVIDER",
  "MOONSHOT_API_KEY",
  "MOONSHOT_MODEL",
  "MOONSHOT_BASE_URL",
  "MOONSHOT_THINKING",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_API_KEY",
  "EMBEDDING_MODEL",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_DIMENSIONS",
  "EMBEDDING_SYNC_ON_WRITE"
];

function resolveSettingsEnvFilePath() {
  return path.resolve(
    process.env.DESKTOP_ENV_FILE
      || process.env.ENV_FILE
      || path.join(config.repoRoot, ".env")
  );
}

async function ensureEnvFile(envFilePath) {
  await fs.mkdir(path.dirname(envFilePath), { recursive: true });
  try {
    await fs.access(envFilePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await fs.writeFile(envFilePath, "", "utf8");
  }
}

async function readEnvFileLines(envFilePath) {
  try {
    const raw = await fs.readFile(envFilePath, "utf8");
    return raw.split(/\r?\n/);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function upsertEnvValue(lines, key, value) {
  const normalizedValue = String(value ?? "").trim();
  const nextLine = `${key}=${normalizedValue}`;
  const entryPattern = new RegExp(`^\\s*${key}=`);
  const nextLines = [];
  let replaced = false;

  for (const line of lines) {
    if (entryPattern.test(line)) {
      if (!replaced) {
        nextLines.push(nextLine);
        replaced = true;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!replaced) {
    if (nextLines.length && nextLines.at(-1)?.trim() !== "") {
      nextLines.push("");
    }
    nextLines.push(nextLine);
  }

  return nextLines;
}

function normalizeBoolean(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  return !["0", "false", "no", "off", "disabled"].includes(String(value).trim().toLowerCase());
}

function normalizeAiSettings(payload = {}) {
  return {
    provider: String(payload.provider || "moonshot").trim().toLowerCase() || "moonshot",
    apiKey: String(payload.apiKey || "").trim(),
    model: String(payload.model || "kimi-k2.5").trim() || "kimi-k2.5",
    baseUrl: String(payload.baseUrl || "https://api.moonshot.cn/v1").trim() || "https://api.moonshot.cn/v1",
    thinking: String(payload.thinking || "enabled").trim().toLowerCase() === "disabled" ? "disabled" : "enabled"
  };
}

function normalizeEmbeddingSettings(payload = {}) {
  const dimensionsRaw = String(payload.dimensions || "").trim();
  const dimensionsValue = Number(dimensionsRaw);
  return {
    provider: String(payload.provider || "openai_compatible").trim() || "openai_compatible",
    apiKey: String(payload.apiKey || "").trim(),
    model: String(payload.model || "text-embedding-v4").trim() || "text-embedding-v4",
    baseUrl: String(payload.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1").trim()
      || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    dimensions: Number.isFinite(dimensionsValue) && dimensionsValue > 0 ? String(Math.floor(dimensionsValue)) : "",
    syncOnWrite: normalizeBoolean(payload.syncOnWrite, true)
  };
}

function validateSettingsPayload(payload = {}) {
  const ai = normalizeAiSettings(payload.ai);
  const embedding = normalizeEmbeddingSettings(payload.embedding);

  if (ai.provider !== "moonshot") {
    throw new Error("Main AI provider currently only supports moonshot.");
  }

  return { ai, embedding };
}

function buildAppSettingsView(envFilePath) {
  return {
    envFilePath,
    canPersist: true,
    ai: {
      provider: config.aiProvider,
      providerOptions: [
        {
          id: "moonshot",
          label: "Moonshot / Kimi",
          enabled: true
        }
      ],
      apiKey: config.moonshotApiKey,
      model: config.moonshotModel,
      baseUrl: config.moonshotBaseUrl,
      thinking: config.moonshotThinking === "disabled" ? "disabled" : "enabled"
    },
    embedding: {
      provider: config.embeddingProvider,
      apiKey: config.embeddingApiKey,
      model: config.embeddingModel,
      baseUrl: config.embeddingBaseUrl,
      dimensions: config.embeddingDimensions ? String(config.embeddingDimensions) : "",
      syncOnWrite: config.embeddingSyncOnWrite
    },
    runtime: {
      storageMode: config.interviewRuntimeStorageMode,
      databaseUrl: config.databaseUrl,
      desktopRuntimeMode: process.env.DESKTOP_RUNTIME_MODE || "web",
      desktopDatabaseMode: process.env.DESKTOP_DATABASE_MODE || "external"
    }
  };
}

export async function getAppSettings() {
  const envFilePath = resolveSettingsEnvFilePath();
  await ensureEnvFile(envFilePath);
  return buildAppSettingsView(envFilePath);
}

export async function saveAppSettings(payload = {}) {
  const envFilePath = resolveSettingsEnvFilePath();
  const { ai, embedding } = validateSettingsPayload(payload);
  await ensureEnvFile(envFilePath);

  let lines = await readEnvFileLines(envFilePath);
  const nextValues = {
    AI_PROVIDER: ai.provider,
    MOONSHOT_API_KEY: ai.apiKey,
    MOONSHOT_MODEL: ai.model,
    MOONSHOT_BASE_URL: ai.baseUrl,
    MOONSHOT_THINKING: ai.thinking,
    EMBEDDING_PROVIDER: embedding.provider,
    EMBEDDING_API_KEY: embedding.apiKey,
    EMBEDDING_MODEL: embedding.model,
    EMBEDDING_BASE_URL: embedding.baseUrl,
    EMBEDDING_DIMENSIONS: embedding.dimensions,
    EMBEDDING_SYNC_ON_WRITE: embedding.syncOnWrite ? "true" : "false"
  };

  for (const key of MANAGED_SETTING_KEYS) {
    lines = upsertEnvValue(lines, key, nextValues[key] ?? "");
    process.env[key] = nextValues[key] ?? "";
  }

  await fs.writeFile(envFilePath, `${lines.join("\n").replace(/\n*$/, "\n")}`, "utf8");
  return buildAppSettingsView(envFilePath);
}
