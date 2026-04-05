import { performance } from "node:perf_hooks";
import { config } from "../config.js";

// Span 负责把开始/完成/失败三段日志收敛成统一模式，
// 让后续 phase、provider、持久化等耗时节点都能复用同一套记录方式。
export function createSpan({ logger, event, fields = {} }) {
  const startedAt = performance.now();
  let finished = false;

  logger.info(`${event}.started`, fields);

  function buildDurationFields(extraFields = {}) {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    return {
      ...fields,
      ...extraFields,
      durationMs,
      slow: durationMs >= config.logSlowThresholdMs
    };
  }

  return {
    end(extraFields = {}) {
      if (finished) {
        return null;
      }
      finished = true;
      const payload = buildDurationFields(extraFields);
      logger.info(`${event}.completed`, payload);
      return payload.durationMs;
    },
    fail(error, extraFields = {}) {
      if (finished) {
        return null;
      }
      finished = true;
      const payload = buildDurationFields(extraFields);
      logger.error(`${event}.failed`, error, payload);
      return payload.durationMs;
    }
  };
}
