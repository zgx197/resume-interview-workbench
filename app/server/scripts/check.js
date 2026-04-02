import fs from "node:fs/promises";
import { config } from "../config.js";
import { loadEnvFile } from "../env.js";
import { loadInterviewCatalog } from "../services/catalog-loader.js";
import { createInterviewSession, getInterviewSession } from "../services/interview-service.js";
import { loadResumePackage } from "../services/resume-loader.js";

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

async function main() {
  await loadEnvFile();
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
