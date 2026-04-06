import http from "node:http";
import { config } from "./config.js";
import { loadEnvFile } from "./env.js";
import { readRequestJson, sendError, sendJson, sendStaticFile } from "./lib/http.js";
import { createLogger } from "./lib/logger.js";
import { answerInterviewQuestion, createInterviewSession, getBootstrapData, getInterviewSession, listInterviewSessions, resumePendingSessions, startBackgroundJobWorker } from "./services/interview-service.js";
import { getObservabilityOverview, getSessionObservabilitySummary } from "./services/log-observability.js";
import { listBackgroundJobSnapshots } from "./services/background-job-service.js";
import { getKnowledgeDocumentEmbeddingStatus, listKnowledgeDocuments, searchSimilarKnowledge, syncKnowledgeEmbeddings } from "./services/knowledge-service.js";
import { getQuestionBankItem, getQuestionBankSnapshot, listQuestionBankCategories, listQuestionBankTags, saveQuestionBankItem } from "./services/question-bank-service.js";
import { getReviewSet, listReviewAttempts, listReviewItems, listReviewSets, recommendReviewSet, recordReviewAttempt, saveReviewSet, updateReviewItemStatus } from "./services/review-service.js";
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

  if (req.method === "GET" && url.pathname === "/api/interviews") {
    sendJson(res, 200, await listInterviewSessions({
      status: url.searchParams.get("status") || null,
      limit: readPositiveInt(url.searchParams, "limit", 100)
    }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/questions/categories") {
    sendJson(res, 200, await listQuestionBankCategories());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/questions/tags") {
    sendJson(res, 200, await listQuestionBankTags({
      category: url.searchParams.get("category") || null,
      tagCategory: url.searchParams.get("tagCategory") || null
    }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/questions") {
    sendJson(res, 200, await getQuestionBankSnapshot({
      category: url.searchParams.get("category") || null,
      q: url.searchParams.get("q") || null,
      sourceType: url.searchParams.get("sourceType") || null,
      tagKey: url.searchParams.get("tagKey") || null,
      difficulty: url.searchParams.get("difficulty") || null,
      minDifficulty: url.searchParams.get("minDifficulty") || null,
      maxDifficulty: url.searchParams.get("maxDifficulty") || null,
      limit: readPositiveInt(url.searchParams, "limit", 50)
    }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/questions") {
    const body = await readRequestJson(req);
    sendJson(res, body.id ? 200 : 201, await saveQuestionBankItem(body));
    return true;
  }

  const questionMatch = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
  if (questionMatch && req.method === "GET") {
    const question = await getQuestionBankItem(questionMatch[1]);
    if (!question) {
      sendError(res, 404, "Question not found.");
      return true;
    }
    sendJson(res, 200, question);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/reviews") {
    sendJson(res, 200, await listReviewItems({
      status: url.searchParams.get("status") || null,
      topicId: url.searchParams.get("topicId") || null,
      sessionId: url.searchParams.get("sessionId") || null,
      limit: readPositiveInt(url.searchParams, "limit", 50)
    }));
    return true;
  }

  const reviewStatusMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/status$/);
  if (reviewStatusMatch && req.method === "POST") {
    const body = await readRequestJson(req);
    const updated = await updateReviewItemStatus(reviewStatusMatch[1], body || {});
    if (!updated) {
      sendError(res, 404, "Review item not found.");
      return true;
    }
    sendJson(res, 200, updated);
    return true;
  }

  const reviewAttemptsMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/attempts$/);
  if (reviewAttemptsMatch && req.method === "GET") {
    sendJson(res, 200, await listReviewAttempts(reviewAttemptsMatch[1], {
      limit: readPositiveInt(url.searchParams, "limit", 20)
    }));
    return true;
  }

  if (reviewAttemptsMatch && req.method === "POST") {
    const body = await readRequestJson(req);
    const result = await recordReviewAttempt(reviewAttemptsMatch[1], body || {});
    if (!result) {
      sendError(res, 404, "Review item not found.");
      return true;
    }
    sendJson(res, 201, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/review-sets") {
    sendJson(res, 200, await listReviewSets({
      status: url.searchParams.get("status") || null,
      limit: readPositiveInt(url.searchParams, "limit", 20)
    }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/review-sets") {
    const body = await readRequestJson(req);
    sendJson(res, body.id ? 200 : 201, await saveReviewSet(body || {}));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/review-sets/recommended") {
    const body = await readRequestJson(req).catch(() => ({}));
    sendJson(res, 200, await recommendReviewSet(body || {}));
    return true;
  }

  const reviewSetMatch = url.pathname.match(/^\/api\/review-sets\/([^/]+)$/);
  if (reviewSetMatch && req.method === "GET") {
    const reviewSet = await getReviewSet(reviewSetMatch[1]);
    if (!reviewSet) {
      sendError(res, 404, "Review set not found.");
      return true;
    }
    sendJson(res, 200, reviewSet);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/background-jobs") {
    sendJson(res, 200, await listBackgroundJobSnapshots({
      sessionId: url.searchParams.get("sessionId") || null,
      kind: url.searchParams.get("kind") || null,
      status: url.searchParams.get("status") || null,
      limit: readPositiveInt(url.searchParams, "limit", 50)
    }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/knowledge") {
    sendJson(res, 200, await listKnowledgeDocuments({
      q: url.searchParams.get("q") || null,
      documentType: url.searchParams.get("documentType") || null,
      sourceTable: url.searchParams.get("sourceTable") || null,
      sourceId: url.searchParams.get("sourceId") || null,
      status: url.searchParams.get("status") || null,
      limit: readPositiveInt(url.searchParams, "limit", 50)
    }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/knowledge/similar") {
    sendJson(res, 200, await searchSimilarKnowledge({
      query: url.searchParams.get("q") || null,
      documentId: url.searchParams.get("documentId") || null,
      documentType: url.searchParams.get("documentType") || null,
      limit: readPositiveInt(url.searchParams, "limit", 10)
    }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/knowledge/embeddings/sync") {
    const body = await readRequestJson(req).catch(() => ({}));
    sendJson(res, 200, await syncKnowledgeEmbeddings({
      documentType: body?.documentType || null,
      limit: Number.isFinite(Number(body?.limit)) ? Number(body.limit) : 20
    }));
    return true;
  }

  const knowledgeEmbeddingMatch = url.pathname.match(/^\/api\/knowledge\/([^/]+)\/embedding-status$/);
  if (knowledgeEmbeddingMatch && req.method === "GET") {
    sendJson(res, 200, await getKnowledgeDocumentEmbeddingStatus(knowledgeEmbeddingMatch[1]));
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

  startBackgroundJobWorker();
});
