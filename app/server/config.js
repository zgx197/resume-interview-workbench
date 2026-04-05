import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

function resolveRepoPath(value, fallbackRelativePath) {
  const targetPath = value || fallbackRelativePath;
  return path.isAbsolute(targetPath) ? targetPath : path.join(repoRoot, targetPath);
}

// 统一管理环境变量和目录路径，避免业务代码里反复读取 process.env
// 或重复拼接仓库内的资源路径。
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
  get interviewRuntimeMode() {
    return process.env.INTERVIEW_RUNTIME_MODE || "fast";
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
  }
};
