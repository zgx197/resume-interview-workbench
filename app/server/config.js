import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

function resolveRepoPath(value, fallbackRelativePath) {
  const targetPath = value || fallbackRelativePath;
  return path.isAbsolute(targetPath) ? targetPath : path.join(repoRoot, targetPath);
}

function readBooleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
}

// Centralize environment variables and project paths so the service layer
// doesn't repeatedly read process.env or rebuild repo-relative paths.
export const config = {
  repoRoot,
  get port() {
    return Number(process.env.PORT || 3000);
  },
  get aiProvider() {
    return process.env.AI_PROVIDER || "moonshot";
  },
  get moonshotApiKey() {
    return process.env.MOONSHOT_API_KEY || "";
  },
  get moonshotModel() {
    return process.env.MOONSHOT_MODEL || "kimi-k2.5";
  },
  get moonshotBaseUrl() {
    return process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1";
  },
  get moonshotThinking() {
    return process.env.MOONSHOT_THINKING || "enabled";
  },
  get embeddingProvider() {
    return process.env.EMBEDDING_PROVIDER || "openai_compatible";
  },
  get embeddingApiKey() {
    return process.env.EMBEDDING_API_KEY || "";
  },
  get embeddingModel() {
    return process.env.EMBEDDING_MODEL || "text-embedding-v4";
  },
  get embeddingBaseUrl() {
    return process.env.EMBEDDING_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  },
  get embeddingDimensions() {
    const value = Number(process.env.EMBEDDING_DIMENSIONS || "");
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  },
  get embeddingSyncOnWrite() {
    return readBooleanEnv("EMBEDDING_SYNC_ON_WRITE", true);
  },
  get postgresDb() {
    return process.env.POSTGRES_DB || "resume_interview_workbench";
  },
  get postgresUser() {
    return process.env.POSTGRES_USER || "resume_interview_workbench";
  },
  get postgresPassword() {
    return process.env.POSTGRES_PASSWORD || "resume_interview_workbench";
  },
  get postgresPort() {
    const value = Number(process.env.POSTGRES_PORT || 5432);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5432;
  },
  get databaseUrl() {
    return process.env.DATABASE_URL
      || `postgresql://${config.postgresUser}:${config.postgresPassword}@127.0.0.1:${config.postgresPort}/${config.postgresDb}`;
  },
  get databasePoolMax() {
    const value = Number(process.env.DATABASE_POOL_MAX || 10);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
  },
  get databaseSsl() {
    return readBooleanEnv("DATABASE_SSL", false);
  },
  get databaseDockerService() {
    return process.env.DATABASE_DOCKER_SERVICE || "postgres";
  },
  get interviewRuntimeMode() {
    return process.env.INTERVIEW_RUNTIME_MODE || "fast";
  },
  get interviewRuntimeStorageMode() {
    return process.env.INTERVIEW_RUNTIME_STORAGE_MODE || "database_only";
  },
  get logLevel() {
    return String(process.env.LOG_LEVEL || "info").toLowerCase();
  },
  get logFormat() {
    return String(process.env.LOG_FORMAT || "pretty").toLowerCase();
  },
  get logPayloadMode() {
    return String(process.env.LOG_PAYLOAD_MODE || "summary").toLowerCase();
  },
  get logSlowThresholdMs() {
    const value = Number(process.env.LOG_SLOW_THRESHOLD_MS || 800);
    return Number.isFinite(value) && value >= 0 ? value : 800;
  },
  get logEnableFile() {
    return String(process.env.LOG_ENABLE_FILE || "true").toLowerCase() !== "false";
  },
  get logFrontendDebug() {
    return String(process.env.LOG_FRONTEND_DEBUG || "false").toLowerCase() === "true";
  },
  get logDir() {
    return resolveRepoPath(process.env.LOG_DIR, path.join("storage", "logs"));
  },
  get resumePackageDir() {
    return path.join(repoRoot, "resume-package");
  },
  get rolesDir() {
    return path.join(repoRoot, "interview-kit", "roles");
  },
  get jobsDir() {
    return path.join(repoRoot, "interview-kit", "jobs");
  },
  get templatesDir() {
    return path.join(repoRoot, "interview-kit", "templates");
  },
  get webDir() {
    return path.join(repoRoot, "app", "web");
  },
  get sessionDir() {
    return resolveRepoPath(process.env.SESSION_DIR, "sessions");
  },
  get dbDir() {
    return path.join(repoRoot, "app", "server", "db");
  },
  get dbMigrationsDir() {
    return path.join(config.dbDir, "migrations");
  }
};
