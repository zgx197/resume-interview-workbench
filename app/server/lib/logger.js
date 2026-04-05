import { config } from "../config.js";
import { createConsoleSink, createJsonlFileSink } from "./log-sinks.js";
import { createSpan } from "./span.js";

const LOG_LEVEL_PRIORITY = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
};

const TOP_LEVEL_FIELDS = new Set([
  "requestId",
  "sessionId",
  "runId",
  "threadId",
  "jobId",
  "turnIndex"
]);

let defaultSinks = null;

function normalizeLevel(level) {
  return LOG_LEVEL_PRIORITY[level] ? level : "info";
}

function shouldLog(level, minLevel) {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}

function normalizeError(error) {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Unknown error",
      code: error.code || null,
      stack: config.logLevel === "trace" || config.logLevel === "debug" ? (error.stack || null) : null
    };
  }

  if (typeof error === "object") {
    return {
      name: String(error.name || "Error"),
      message: String(error.message || "Unknown error"),
      code: error.code || null,
      stack: null
    };
  }

  return {
    name: "Error",
    message: String(error),
    code: null,
    stack: null
  };
}

function splitFields(fields = {}) {
  const topLevel = {};
  const meta = {};

  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined) {
      continue;
    }

    if (key === "durationMs") {
      topLevel.durationMs = value;
      continue;
    }

    if (TOP_LEVEL_FIELDS.has(key)) {
      topLevel[key] = value;
      continue;
    }

    meta[key] = value;
  }

  return { topLevel, meta };
}

function buildEntry({ level, component, event, context, fields, error }) {
  const { topLevel, meta } = splitFields(fields);
  const mergedContext = { ...(context || {}), ...topLevel };
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    event
  };

  for (const key of ["requestId", "sessionId", "runId", "threadId", "jobId"]) {
    if (mergedContext[key]) {
      entry[key] = mergedContext[key];
    }
  }

  if (Number.isFinite(mergedContext.turnIndex)) {
    entry.turnIndex = mergedContext.turnIndex;
  }

  if (Number.isFinite(topLevel.durationMs)) {
    entry.durationMs = topLevel.durationMs;
  }

  if (Object.keys(meta).length) {
    entry.meta = meta;
  }

  const normalizedError = normalizeError(error);
  if (normalizedError) {
    entry.error = normalizedError;
  }

  return entry;
}

function getDefaultSinks() {
  if (!defaultSinks) {
    defaultSinks = [
      createConsoleSink({ format: config.logFormat }),
      createJsonlFileSink({ dirPath: config.logDir, enabled: config.logEnableFile })
    ];
  }
  return defaultSinks;
}

function writeToSinks(sinks, entry) {
  for (const sink of sinks) {
    try {
      sink.write(entry);
    } catch (error) {
      console.error(`[logger] sink ${sink.name || "unknown"} failed: ${error.message}`);
    }
  }
}

function resolveErrorAndFields(errorOrFields, maybeFields) {
  if (errorOrFields instanceof Error) {
    return {
      error: errorOrFields,
      fields: maybeFields || {}
    };
  }

  if (errorOrFields && typeof errorOrFields === "object" && errorOrFields.error instanceof Error) {
    const { error, ...rest } = errorOrFields;
    return {
      error,
      fields: {
        ...rest,
        ...(maybeFields || {})
      }
    };
  }

  return {
    error: null,
    fields: errorOrFields || {}
  };
}

// Logger 本身只关心三件事：构造标准日志、合并上下文、把结果发往 sinks。
export function createLogger({ component = "app", context = {}, sinks = getDefaultSinks(), minLevel = config.logLevel } = {}) {
  const normalizedMinLevel = normalizeLevel(minLevel);

  function emit(level, event, errorOrFields, maybeFields) {
    const normalizedLevel = normalizeLevel(level);
    if (!shouldLog(normalizedLevel, normalizedMinLevel)) {
      return null;
    }

    const { error, fields } = resolveErrorAndFields(errorOrFields, maybeFields);
    const entry = buildEntry({
      level: normalizedLevel,
      component,
      event,
      context,
      fields,
      error
    });
    writeToSinks(sinks, entry);
    return entry;
  }

  return {
    component,
    context,
    child(extraContext = {}) {
      const nextComponent = extraContext.component || component;
      const mergedContext = {
        ...context,
        ...Object.fromEntries(Object.entries(extraContext).filter(([key]) => key !== "component"))
      };
      return createLogger({
        component: nextComponent,
        context: mergedContext,
        sinks,
        minLevel: normalizedMinLevel
      });
    },
    trace(event, fields = {}) {
      return emit("trace", event, fields);
    },
    debug(event, fields = {}) {
      return emit("debug", event, fields);
    },
    info(event, fields = {}) {
      return emit("info", event, fields);
    },
    warn(event, errorOrFields = {}, maybeFields = {}) {
      return emit("warn", event, errorOrFields, maybeFields);
    },
    error(event, errorOrFields = {}, maybeFields = {}) {
      return emit("error", event, errorOrFields, maybeFields);
    },
    startSpan(event, fields = {}) {
      return createSpan({
        logger: this,
        event,
        fields
      });
    },
    async drain() {
      await Promise.all(
        sinks
          .filter((sink) => typeof sink.drain === "function")
          .map((sink) => sink.drain())
      );
    }
  };
}
