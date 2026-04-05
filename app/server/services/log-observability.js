import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const observabilityLogger = createLogger({ component: "log-observability" });
const LOG_FILE_PATTERN = /^app-\d{4}-\d{2}-\d{2}\.jsonl$/;

function normalizeLimit(value, fallback, { min = 1, max = 200 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseEntryTime(entry) {
  const timestamp = Date.parse(entry?.ts || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortEntriesByTimeDesc(entries) {
  return [...entries].sort((left, right) => parseEntryTime(right) - parseEntryTime(left));
}

function sortEntriesByTimeAsc(entries) {
  return [...entries].sort((left, right) => parseEntryTime(left) - parseEntryTime(right));
}

function isUserFacingObservabilityEntry(entry) {
  return entry.component !== "log-observability";
}

function pickEntryFields(entry, extra = {}) {
  return {
    ts: entry.ts || null,
    level: entry.level || "info",
    component: entry.component || "unknown",
    event: entry.event || "unknown",
    sessionId: entry.sessionId || null,
    runId: entry.runId || null,
    threadId: entry.threadId || null,
    jobId: entry.jobId || null,
    turnIndex: Number.isFinite(entry.turnIndex) ? entry.turnIndex : null,
    durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
    ...extra
  };
}

function buildTimelineLabel(entry) {
  const meta = entry.meta || {};

  if (entry.event === "session.created") {
    return "会话已创建";
  }

  if (entry.event === "answer.accepted") {
    return `第 ${entry.turnIndex || meta.turnIndex || "?"} 轮回答已接收`;
  }

  if (entry.event === "run.started") {
    return `${meta.runKind || "run"} 开始`;
  }

  if (entry.event === "run.completed") {
    return `${meta.runKind || "run"} 完成`;
  }

  if (entry.event === "run.failed") {
    return `${meta.runKind || "run"} 失败`;
  }

  if (entry.event === "run.phase.completed") {
    return `${meta.phase || "phase"} 阶段完成`;
  }

  if (entry.event === "run.phase.failed") {
    return `${meta.phase || "phase"} 阶段失败`;
  }

  if (entry.event === "provider.generate_json.completed") {
    return `${meta.purpose || "provider"} 调用完成${meta.fallbackUsed ? "（回退）" : ""}`;
  }

  if (entry.event === "provider.fallback.used") {
    return `${entry.component} 触发回退`;
  }

  if (entry.event === "background_job.queued") {
    return `${meta.jobKind || "job"} 已排队`;
  }

  if (entry.event === "background_job.started") {
    return `${meta.jobKind || "job"} 执行中`;
  }

  if (entry.event === "background_job.completed") {
    return `${meta.jobKind || "job"} 已完成`;
  }

  if (entry.event === "background_job.failed") {
    return `${meta.jobKind || "job"} 已失败`;
  }

  if (entry.event === "background_job.retry_scheduled") {
    return `${meta.jobKind || "job"} 已安排重试`;
  }

  return `${entry.component} / ${entry.event}`;
}

function isTimelineEntry(entry) {
  return [
    "session.created",
    "answer.accepted",
    "run.started",
    "run.completed",
    "run.failed",
    "run.phase.completed",
    "run.phase.failed",
    "provider.generate_json.completed",
    "provider.fallback.used",
    "background_job.queued",
    "background_job.started",
    "background_job.completed",
    "background_job.failed",
    "background_job.retry_scheduled"
  ].includes(entry.event);
}

function buildSlowSpanItem(entry) {
  const meta = entry.meta || {};
  return pickEntryFields(entry, {
    summary: buildTimelineLabel(entry),
    phase: meta.phase || null,
    purpose: meta.purpose || null,
    jobKind: meta.jobKind || null,
    status: entry.event.endsWith(".failed") ? "failed" : "completed",
    slow: Boolean(meta.slow || (entry.durationMs || 0) >= config.logSlowThresholdMs)
  });
}

function summarizeSlowSpans(entries, limit) {
  const spanEntries = entries.filter((entry) => Number.isFinite(entry.durationMs));
  const thresholdMatches = spanEntries.filter((entry) => (
    Boolean(entry.meta?.slow) || entry.durationMs >= config.logSlowThresholdMs
  ));
  const sourceEntries = thresholdMatches.length
    ? thresholdMatches
    : [...spanEntries].sort((left, right) => (
      (right.durationMs || 0) - (left.durationMs || 0) ||
      parseEntryTime(right) - parseEntryTime(left)
    ));

  return {
    mode: thresholdMatches.length ? "threshold" : "top_fallback",
    thresholdMs: config.logSlowThresholdMs,
    items: sourceEntries
      .slice(0, limit)
      .map(buildSlowSpanItem)
  };
}

function summarizeProviderCalls(entries, limit) {
  return sortEntriesByTimeDesc(
    entries.filter((entry) => (
      isUserFacingObservabilityEntry(entry) &&
      entry.event === "provider.generate_json.completed"
    ))
  )
    .slice(0, limit)
    .map((entry) => {
      const meta = entry.meta || {};
      return pickEntryFields(entry, {
        purpose: meta.purpose || null,
        model: meta.model || meta.provider || "unknown",
        thinkingType: meta.thinkingType || null,
        toolMode: Boolean(meta.toolMode),
        enableWebSearch: Boolean(meta.enableWebSearch),
        fallbackUsed: Boolean(meta.fallbackUsed),
        fallbackReason: meta.fallbackReason || null,
        inputChars: Number.isFinite(meta.inputChars) ? meta.inputChars : null,
        summary: `${meta.purpose || "provider"} / ${meta.model || "unknown"}${meta.fallbackUsed ? " / fallback" : ""}`
      });
    });
}

function summarizeSessionTimeline(entries, timelineLimit) {
  return sortEntriesByTimeAsc(
    entries.filter((entry) => isUserFacingObservabilityEntry(entry) && isTimelineEntry(entry))
  )
    .slice(-timelineLimit)
    .map((entry) => {
      const meta = entry.meta || {};
      return pickEntryFields(entry, {
        label: buildTimelineLabel(entry),
        phase: meta.phase || null,
        purpose: meta.purpose || null,
        jobKind: meta.jobKind || null,
        action: meta.action || null,
        fallbackUsed: Boolean(meta.fallbackUsed)
      });
    });
}

function summarizeSessionBackgroundJobs(entries, jobLimit) {
  const buckets = new Map();

  for (const entry of entries) {
    if (!entry.jobId || !entry.event.startsWith("background_job.") || !isUserFacingObservabilityEntry(entry)) {
      continue;
    }

    const current = buckets.get(entry.jobId) || {
      jobId: entry.jobId,
      jobKind: entry.meta?.jobKind || null,
      targetId: entry.meta?.targetId || null,
      sessionId: entry.sessionId || null,
      threadId: entry.threadId || null,
      queuedAt: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      lastEvent: null,
      lastEventAt: null,
      durationMs: null,
      retryCount: 0,
      status: "idle"
    };
    const currentLastEventTime = Date.parse(current.lastEventAt || "");
    const nextEventTime = parseEntryTime(entry);

    current.jobKind ||= entry.meta?.jobKind || null;
    current.targetId ||= entry.meta?.targetId || null;

    if (entry.event === "background_job.queued") {
      current.queuedAt ||= entry.ts || null;
    } else if (entry.event === "background_job.started") {
      current.startedAt = entry.ts || current.startedAt;
    } else if (entry.event === "background_job.completed") {
      current.completedAt = entry.ts || current.completedAt;
      current.durationMs = Number.isFinite(entry.durationMs) ? entry.durationMs : current.durationMs;
    } else if (entry.event === "background_job.failed") {
      current.failedAt = entry.ts || current.failedAt;
      current.durationMs = Number.isFinite(entry.durationMs) ? entry.durationMs : current.durationMs;
    } else if (entry.event === "background_job.retry_scheduled") {
      current.retryCount += 1;
    }

    if (!Number.isFinite(currentLastEventTime) || nextEventTime >= currentLastEventTime) {
      current.lastEvent = entry.event;
      current.lastEventAt = entry.ts || current.lastEventAt;

      if (entry.event === "background_job.queued") {
        current.status = "pending";
      } else if (entry.event === "background_job.started") {
        current.status = "running";
      } else if (entry.event === "background_job.completed") {
        current.status = "completed";
      } else if (entry.event === "background_job.failed") {
        current.status = "failed";
      }
    }

    buckets.set(entry.jobId, current);
  }

  return sortEntriesByTimeDesc(
    [...buckets.values()].map((item) => ({
      ts: item.lastEventAt,
      ...item
    }))
  )
    .slice(0, jobLimit)
    .map((item) => ({
      jobId: item.jobId,
      jobKind: item.jobKind,
      targetId: item.targetId,
      sessionId: item.sessionId,
      threadId: item.threadId,
      status: item.status,
      retryCount: item.retryCount,
      queuedAt: item.queuedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      failedAt: item.failedAt,
      lastEvent: item.lastEvent,
      lastEventAt: item.lastEventAt,
      durationMs: item.durationMs,
      summary: `${item.jobKind || "job"} / ${item.status}`
    }));
}

async function listRecentLogFiles(fileLimit) {
  try {
    const entries = await fs.readdir(config.logDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && LOG_FILE_PATTERN.test(entry.name))
      .map((entry) => path.join(config.logDir, entry.name))
      .sort((left, right) => path.basename(right).localeCompare(path.basename(left)))
      .slice(0, fileLimit);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readEntriesFromFile(filePath, lineLimitPerFile) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n").filter(Boolean).slice(-lineLimitPerFile);
  const entries = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch (error) {
      observabilityLogger.warn("observability.log_line_ignored", error, {
        filePath: path.relative(config.repoRoot, filePath).replace(/\\/g, "/")
      });
    }
  }

  return entries;
}

async function loadRecentLogEntries({ fileLimit = 3, lineLimitPerFile = 3000, maxEntries = 8000 } = {}) {
  const span = observabilityLogger.startSpan("observability.load_recent_entries", {
    fileLimit,
    lineLimitPerFile,
    maxEntries
  });

  try {
    const files = await listRecentLogFiles(fileLimit);
    let entries = [];

    for (const filePath of files) {
      const fileEntries = await readEntriesFromFile(filePath, lineLimitPerFile);
      entries = entries.concat(fileEntries);
      if (entries.length >= maxEntries) {
        break;
      }
    }

    const sortedEntries = sortEntriesByTimeDesc(entries).slice(0, maxEntries);
    span.end({
      fileCount: files.length,
      entryCount: sortedEntries.length
    });
    return {
      files: files.map((filePath) => path.relative(config.repoRoot, filePath).replace(/\\/g, "/")),
      entries: sortedEntries
    };
  } catch (error) {
    span.fail(error);
    throw error;
  }
}

export async function getObservabilityOverview({
  limit = 20,
  fileLimit = 3,
  lineLimitPerFile = 3000
} = {}) {
  const normalizedLimit = normalizeLimit(limit, 20);
  const normalizedFileLimit = normalizeLimit(fileLimit, 3, { min: 1, max: 7 });
  const normalizedLineLimit = normalizeLimit(lineLimitPerFile, 3000, { min: 100, max: 20000 });
  const { files, entries } = await loadRecentLogEntries({
    fileLimit: normalizedFileLimit,
    lineLimitPerFile: normalizedLineLimit
  });
  const visibleEntries = entries.filter((entry) => isUserFacingObservabilityEntry(entry));

  return {
    generatedAt: new Date().toISOString(),
    source: {
      logDir: path.relative(config.repoRoot, config.logDir).replace(/\\/g, "/"),
      files,
      scannedEntryCount: entries.length,
      visibleEntryCount: visibleEntries.length
    },
    slowSpans: summarizeSlowSpans(visibleEntries, normalizedLimit),
    recentProviderCalls: summarizeProviderCalls(visibleEntries, normalizedLimit),
    recentTimeline: summarizeSessionTimeline(
      visibleEntries,
      normalizeLimit(limit, 20, { min: 5, max: 60 })
    )
  };
}

export async function getSessionObservabilitySummary(sessionId, {
  timelineLimit = 60,
  providerLimit = 20,
  slowLimit = 20,
  jobLimit = 20,
  fileLimit = 3,
  lineLimitPerFile = 3000
} = {}) {
  const { files, entries } = await loadRecentLogEntries({
    fileLimit: normalizeLimit(fileLimit, 3, { min: 1, max: 7 }),
    lineLimitPerFile: normalizeLimit(lineLimitPerFile, 3000, { min: 100, max: 20000 })
  });
  const sessionEntries = entries.filter((entry) => (
    isUserFacingObservabilityEntry(entry) &&
    entry.sessionId === sessionId
  ));

  return {
    generatedAt: new Date().toISOString(),
    sessionId,
    source: {
      files,
      scannedEntryCount: entries.length,
      matchedEntryCount: sessionEntries.length
    },
    timeline: summarizeSessionTimeline(sessionEntries, normalizeLimit(timelineLimit, 60, { min: 5, max: 200 })),
    recentProviderCalls: summarizeProviderCalls(sessionEntries, normalizeLimit(providerLimit, 20)),
    slowSpans: summarizeSlowSpans(sessionEntries, normalizeLimit(slowLimit, 20)),
    backgroundJobs: summarizeSessionBackgroundJobs(sessionEntries, normalizeLimit(jobLimit, 20))
  };
}
