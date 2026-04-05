import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

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
    return path.join(repoRoot, process.env.SESSION_DIR || "sessions");
  }
};
