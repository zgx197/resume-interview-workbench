import fs from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

// 当前应用的请求体都比较小，直接完整读取可以换来更简单、
// 更稳定的解析逻辑，不需要引入流式处理复杂度。
export async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

export function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, {
    error: {
      message,
      details: details || null
    }
  });
}

// 静态资源服务故意保持收敛：所有文件都从 web 根目录解析，
// 并通过扩展名推断内容类型。
export async function sendStaticFile(res, rootDir, relativePath) {
  const safePath = relativePath === "/" ? "/index.html" : relativePath;
  const filePath = path.join(rootDir, safePath);
  const extension = path.extname(filePath);
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
  const raw = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(raw);
}
