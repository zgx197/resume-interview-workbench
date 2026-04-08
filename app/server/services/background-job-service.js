import { createDbBackgroundJobRepository } from "../repositories/db/db-background-job-repository.js";
import { createLogger } from "../lib/logger.js";

const backgroundJobRepository = createDbBackgroundJobRepository();
const jobLogger = createLogger({ component: "background-job-db" });

function nowIso() {
  return new Date().toISOString();
}

function resolveScheduledAt(job, delayMs, timestamp) {
  if (job?.scheduledAt) {
    return job.scheduledAt;
  }

  const resolvedDelayMs = Number.isFinite(Number(delayMs))
    ? Math.max(0, Math.floor(Number(delayMs)))
    : 0;
  const baseTimestamp = job?.queuedAt || job?.startedAt || timestamp;
  const baseTime = Date.parse(baseTimestamp);
  if (!Number.isFinite(baseTime)) {
    return timestamp;
  }

  return new Date(baseTime + resolvedDelayMs).toISOString();
}

export async function upsertBackgroundJobSnapshot({
  id = null,
  jobKey = null,
  sessionId,
  kind,
  targetType = null,
  targetId = null,
  job,
  delayMs = null
}) {
  const timestamp = nowIso();
  const resolvedTargetType = targetType || (targetId ? "thread" : "session");
  const resolvedJobKey = jobKey || `${sessionId}:${kind}:${targetId || "session"}`;
  return backgroundJobRepository.upsertSnapshot({
    id: id || resolvedJobKey,
    jobKey: resolvedJobKey,
    kind,
    targetType: resolvedTargetType,
    targetId,
    sessionId,
    status: job?.status || "idle",
    attempts: job?.attempts || 0,
    scheduledAt: resolveScheduledAt(job, delayMs, timestamp),
    startedAt: job?.startedAt || null,
    finishedAt: job?.completedAt || job?.failedAt || null,
    lastError: job?.error || null,
    payload: {
      delayMs: Number.isFinite(Number(delayMs)) ? Math.max(0, Math.floor(Number(delayMs))) : null
    },
    result: {
      queuedAt: job?.queuedAt || null,
      completedAt: job?.completedAt || null,
      failedAt: job?.failedAt || null
    },
    createdAt: job?.queuedAt || timestamp,
    updatedAt: timestamp
  });
}

export async function listBackgroundJobSnapshots(filter = {}) {
  return backgroundJobRepository.listSnapshots(filter);
}

export async function listResumableBackgroundJobs(filter = {}) {
  return backgroundJobRepository.listResumable(filter);
}

export async function getBackgroundJobSnapshot(jobKey) {
  return backgroundJobRepository.getByJobKey(jobKey);
}

export async function leaseNextBackgroundJob(workerId, options = {}) {
  return backgroundJobRepository.leaseNext(workerId, options);
}

export async function leaseBackgroundJob(jobKey, workerId, options = {}) {
  return backgroundJobRepository.leaseByJobKey(jobKey, workerId, options);
}

export async function startBackgroundJobLease(jobKey, workerId) {
  return backgroundJobRepository.startLease(jobKey, workerId);
}

export async function heartbeatBackgroundJobLease(jobKey, workerId, options = {}) {
  return backgroundJobRepository.heartbeatLease(jobKey, workerId, options);
}

export async function completeBackgroundJobLease(jobKey, workerId, result = {}) {
  return backgroundJobRepository.completeLease(jobKey, workerId, result);
}

export async function failBackgroundJobLease(jobKey, workerId, failure = {}) {
  return backgroundJobRepository.failLease(jobKey, workerId, failure);
}

export async function recoverBackgroundJobLeases(filter = {}) {
  return backgroundJobRepository.recoverLeases(filter);
}

export function upsertBackgroundJobSnapshotInBackground(input) {
  void upsertBackgroundJobSnapshot(input).catch((error) => {
    jobLogger.warn("background_job.db_sync_failed", error, {
      sessionId: input.sessionId,
      kind: input.kind,
      targetId: input.targetId || null
    });
  });
}
