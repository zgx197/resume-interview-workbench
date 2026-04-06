import fs from "node:fs/promises";
import path from "node:path";
import { closeDbPool } from "../db/client.js";
import { loadEnvFile } from "../env.js";
import { readJson } from "../lib/fs-utils.js";
import { createDbSessionRepository } from "../repositories/db/db-session-repository.js";
import { config } from "../config.js";
import { upsertBackgroundJobSnapshot } from "../services/background-job-service.js";
import { syncInterviewRuntimeSnapshot } from "../services/runtime-persistence-service.js";

const sessionRepository = createDbSessionRepository();

function parseArgs(argv) {
  const options = {
    limit: null,
    sessionId: null,
    skipJobs: false
  };

  for (const arg of argv) {
    if (arg === "--skip-jobs") {
      options.skipJobs = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      options.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
      continue;
    }

    if (arg.startsWith("--session-id=")) {
      options.sessionId = String(arg.slice("--session-id=".length) || "").trim() || null;
    }
  }

  return options;
}

function isJobSnapshotActive(job) {
  return Boolean(
    job &&
    typeof job === "object" &&
    job.status &&
    job.status !== "idle"
  );
}

function collectSessionJobs(session) {
  const jobs = [];

  if (isJobSnapshotActive(session.planJob)) {
    jobs.push({
      kind: "plan_refresh",
      targetId: null,
      job: session.planJob
    });
  }

  if (isJobSnapshotActive(session.reportJob)) {
    jobs.push({
      kind: "report",
      targetId: null,
      job: session.reportJob
    });
  }

  for (const thread of session.topicThreads || []) {
    if (!thread?.id || !isJobSnapshotActive(thread.summaryJob)) {
      continue;
    }

    jobs.push({
      kind: "thread_summary",
      targetId: thread.id,
      job: thread.summaryJob
    });
  }

  return jobs;
}

function shouldRefreshFromFile(fileSession, dbSession) {
  if (!dbSession) {
    return true;
  }

  const fileUpdatedAt = Date.parse(fileSession?.updatedAt || "");
  const dbUpdatedAt = Date.parse(dbSession?.updatedAt || "");

  if (!Number.isFinite(fileUpdatedAt)) {
    return false;
  }

  if (!Number.isFinite(dbUpdatedAt)) {
    return true;
  }

  return fileUpdatedAt > dbUpdatedAt;
}

async function listSessionFiles(options) {
  const entries = await fs.readdir(config.sessionDir, { withFileTypes: true });
  let files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(config.sessionDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (options.sessionId) {
    files = files.filter((filePath) => path.basename(filePath, ".json") === options.sessionId);
  }

  if (options.limit) {
    files = files.slice(0, options.limit);
  }

  return files;
}

async function main() {
  await loadEnvFile();
  const options = parseArgs(process.argv.slice(2));
  const files = await listSessionFiles(options);
  const summary = {
    scanned: 0,
    inserted: 0,
    refreshed: 0,
    skipped: 0,
    jobsSynced: 0,
    failed: 0
  };

  console.log(`[db:backfill:sessions] sessionDir=${config.sessionDir}`);
  console.log(`[db:backfill:sessions] databaseUrl=${config.databaseUrl}`);
  console.log(`[db:backfill:sessions] files=${files.length}`);

  for (const filePath of files) {
    summary.scanned += 1;

    try {
      const session = await readJson(filePath);
      if (!session?.id) {
        console.warn(`[db:backfill:sessions] skip invalid file ${path.basename(filePath)}`);
        summary.skipped += 1;
        continue;
      }

      const existing = await sessionRepository.getById(session.id);
      if (shouldRefreshFromFile(session, existing)) {
        await syncInterviewRuntimeSnapshot({
          ...session,
          version: null
        });
        if (existing) {
          summary.refreshed += 1;
          console.log(`[db:backfill:sessions] refreshed ${session.id}`);
        } else {
          summary.inserted += 1;
          console.log(`[db:backfill:sessions] inserted ${session.id}`);
        }
      } else {
        summary.skipped += 1;
      }

      if (!options.skipJobs) {
        for (const job of collectSessionJobs(session)) {
          await upsertBackgroundJobSnapshot({
            sessionId: session.id,
            kind: job.kind,
            targetId: job.targetId,
            job: job.job
          });
          summary.jobsSynced += 1;
        }
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`[db:backfill:sessions] failed ${path.basename(filePath)}`);
      console.error(error);
    }
  }

  console.log(`[db:backfill:sessions] scanned=${summary.scanned} inserted=${summary.inserted} refreshed=${summary.refreshed} skipped=${summary.skipped} jobsSynced=${summary.jobsSynced} failed=${summary.failed}`);
}

main()
  .catch((error) => {
    console.error("[db:backfill:sessions] failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
