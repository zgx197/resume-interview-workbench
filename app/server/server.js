import http from "node:http";
import { config } from "./config.js";
import { loadEnvFile } from "./env.js";
import { readRequestJson, sendError, sendJson, sendStaticFile } from "./lib/http.js";
import { answerInterviewQuestion, createInterviewSession, getBootstrapData, getInterviewSession, resumePendingSessions } from "./services/interview-service.js";
import { subscribeSession } from "./services/session-events.js";
import { deleteInterviewTemplate, listInterviewTemplates, saveInterviewTemplate } from "./services/template-service.js";

function sendSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, await getBootstrapData());
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
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

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
    if (error.code === "ENOENT") {
      sendError(res, 404, "File not found.");
      return;
    }

    sendError(res, 500, error.message);
  }
}

await loadEnvFile();

const server = http.createServer((req, res) => {
  requestHandler(req, res);
});

server.listen(config.port, () => {
  console.log(`resume-interview-workbench listening on http://localhost:${config.port}`);
  resumePendingSessions()
    .then((count) => {
      if (count > 0) {
        console.log(`resumed ${count} pending session(s)`);
      }
    })
    .catch((error) => {
      console.error(`failed to resume pending sessions: ${error.message}`);
    });
});
