import http from "node:http";
import { config } from "./config.js";
import { loadEnvFile } from "./env.js";
import { readRequestJson, sendError, sendJson, sendStaticFile } from "./lib/http.js";
import { createLogger } from "./lib/logger.js";
import { answerInterviewQuestion, createInterviewSession, getBootstrapData, getInterviewSession, resumePendingSessions } from "./services/interview-service.js";
import { getObservabilityOverview, getSessionObservabilitySummary } from "./services/log-observability.js";
import { subscribeSession } from "./services/session-events.js";
import { deleteInterviewTemplate, listInterviewTemplates, saveInterviewTemplate } from "./services/template-service.js";

const serverLogger = createLogger({ component: "server" });

function readPositiveInt(searchParams, key, fallback) {
  const raw = searchParams.get(key);
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// HTTP 入口故意保持很薄：这里只做路由分发，
// 真正的状态流转、持久化和面试逻辑都在 service 层。
function sendSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// 这里使用手写路由而不是引入框架，
// 目的是把请求面保持得足够小，便于定位和调试。
async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, await getBootstrapData());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/debug/logs/summary") {
    sendJson(res, 200, await getObservabilityOverview({
      limit: readPositiveInt(url.searchParams, "limit", 20),
      fileLimit: readPositiveInt(url.searchParams, "fileLimit", 3),
      lineLimitPerFile: readPositiveInt(url.searchParams, "lineLimitPerFile", 3000)
    }));
    return true;
  }

  const debugSessionMatch = url.pathname.match(/^\/api\/debug\/logs\/sessions\/([^/]+)$/);
  if (debugSessionMatch && req.method === "GET") {
    sendJson(res, 200, await getSessionObservabilitySummary(debugSessionMatch[1], {
      timelineLimit: readPositiveInt(url.searchParams, "timelineLimit", 60),
      providerLimit: readPositiveInt(url.searchParams, "providerLimit", 20),
      slowLimit: readPositiveInt(url.searchParams, "slowLimit", 20),
      jobLimit: readPositiveInt(url.searchParams, "jobLimit", 20),
      fileLimit: readPositiveInt(url.searchParams, "fileLimit", 3),
      lineLimitPerFile: readPositiveInt(url.searchParams, "lineLimitPerFile", 3000)
    }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/interviews") {
    const body = await readRequestJson(req);
    if (!body.templateId && !body.template && (!body.roleId || !body.jobId)) {
      sendError(res, 400, "templateId, template, or roleId/jobId are required.");
      return true;
    }
    sendJson(res, 201, await createInterviewSession(body));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/templates") {
    sendJson(res, 200, await listInterviewTemplates());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/templates") {
    const body = await readRequestJson(req);
    sendJson(res, body.id ? 200 : 201, await saveInterviewTemplate(body));
    return true;
  }

  const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (templateMatch && req.method === "DELETE") {
    await deleteInterviewTemplate(templateMatch[1]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const match = url.pathname.match(/^\/api\/interviews\/([^/]+)(?:\/(answer|events))?$/);
  if (!match) {
    return false;
  }

  const sessionId = match[1];
  if (req.method === "GET" && url.pathname === `/api/interviews/${sessionId}/events`) {
    const snapshot = await getInterviewSession(sessionId);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    sendSseEvent(res, "session", snapshot);
    const unsubscribe = subscribeSession(sessionId, (payload) => {
      sendSseEvent(res, "session", payload);
    });
    req.on("close", () => {
      unsubscribe();
      res.end();
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === `/api/interviews/${sessionId}`) {
    sendJson(res, 200, await getInterviewSession(sessionId));
    return true;
  }

  if (req.method === "POST" && url.pathname === `/api/interviews/${sessionId}/answer`) {
    const body = await readRequestJson(req);
    if (!body.answer || !String(body.answer).trim()) {
      sendError(res, 400, "answer is required.");
      return true;
    }
    sendJson(res, 200, await answerInterviewQuestion(sessionId, String(body.answer)));
    return true;
  }

  return false;
}

async function requestHandler(req, res) {
  let pathname = req.url || "";
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    pathname = url.pathname;

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) {
        sendError(res, 404, "API route not found.");
      }
      return;
    }

    const assetPath = url.pathname === "/" ? "/index.html" : url.pathname;
    await sendStaticFile(res, config.webDir, assetPath);
  } catch (error) {
    serverLogger.error("http.request.failed", error, {
      method: req.method,
      pathname
    });

    if (error.code === "ENOENT") {
      sendError(res, 404, "File not found.");
      return;
    }

    sendError(res, 500, error.message);
  }
}

await loadEnvFile();

// 会话会完整落盘，所以进程重启后可以恢复未完成的面试。
const server = http.createServer((req, res) => {
  requestHandler(req, res);
});

server.listen(config.port, () => {
  serverLogger.info("server.started", {
    port: config.port,
    url: `http://localhost:${config.port}`,
    logLevel: config.logLevel,
    logFormat: config.logFormat,
    logDir: config.logDir,
    fileLoggingEnabled: config.logEnableFile
  });

  const resumeSpan = serverLogger.startSpan("server.resume_pending_sessions");
  resumePendingSessions()
    .then((count) => {
      resumeSpan.end({ resumedCount: count });
    })
    .catch((error) => {
      resumeSpan.fail(error);
    });
});
