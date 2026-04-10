import fs from "node:fs/promises";
import { config } from "../config.js";
import { query } from "../db/client.js";
import { closeDbPool } from "../db/client.js";
import { loadEnvFile } from "../env.js";
import { loadInterviewCatalog } from "../services/catalog-loader.js";
import { createInterviewSession, getInterviewSession } from "../services/interview-service.js";
import { loadResumePackage } from "../services/resume-loader.js";

// 轮询等待后台处理结束，确保脚本打印的是最终可见状态，
// 而不是中途的 processing 快照。
async function waitForSession(sessionId, predicate, timeoutMs = 180000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = await getInterviewSession(sessionId);
    if (predicate(session)) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for session ${sessionId}`);
}

function buildDatabaseUnavailableError(error) {
  const details = [
    `Database is not reachable at ${config.databaseUrl}.`,
    `Current runtime storage mode is ${config.interviewRuntimeStorageMode}, so npm run check requires PostgreSQL to be running.`,
    "Expected local setup:",
    "1. Desktop mode: provide DESKTOP_POSTGRES_BIN_DIR or run the Tauri desktop bootstrap",
    "2. Local dev mode: start Docker Desktop / Docker daemon",
    "3. Run npm run db:up",
    "4. Run npm run db:migrate",
    "5. Re-run npm run check",
    "Optional helpers:",
    "- npm run db:doctor",
    "- npm run setup:local",
    "- npm run desktop:doctor"
  ];

  if (error?.code) {
    details.push(`Underlying error: ${error.code}`);
  }

  return new Error(details.join("\n"));
}

async function ensureDatabaseReady() {
  try {
    await query("select 1 as ok;");
  } catch (error) {
    if ([
      "ECONNREFUSED",
      "ENOTFOUND",
      "EHOSTUNREACH",
      "ETIMEDOUT"
    ].includes(error?.code)) {
      throw buildDatabaseUnavailableError(error);
    }
    throw error;
  }
}

async function main() {
  await loadEnvFile();
  await ensureDatabaseReady();
  const packageFiles = await fs.readdir(config.resumePackageDir);
  const catalog = await loadInterviewCatalog();
  const resumePackage = await loadResumePackage();

  console.log("resume-package files:", packageFiles.join(", "));
  console.log("roles:", catalog.roles.map((role) => role.id).join(", "));
  console.log("jobs:", catalog.jobs.map((job) => job.id).join(", "));
  console.log("candidate:", resumePackage.normalized.profile.name);
  console.log("provider:", config.aiProvider, config.moonshotModel, config.moonshotThinking);

  const session = await createInterviewSession({
    roleId: catalog.roles[0].id,
    jobId: catalog.jobs[0].id,
    notes: "automated check"
  });
  const ready = await waitForSession(session.id, (current) => current.status !== "processing");

  console.log("sample session:", ready.id);
  console.log("first question:", ready.nextQuestion.text);
  console.log("first question strategy:", ready.nextQuestion.strategy);
  console.log("plan strategy:", ready.plan.strategy);
  console.log("run status:", ready.currentRun?.status);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
    process.exit(process.exitCode || 0);
  });
