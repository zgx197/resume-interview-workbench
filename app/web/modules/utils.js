// 会话视图和图谱调试视图共用的格式化/渲染辅助函数。
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "--";
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  if (durationMs < 60_000) {
    const seconds = durationMs / 1000;
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function diffDurationMs(startedAt, endedAt = new Date()) {
  if (!startedAt) {
    return null;
  }
  const start = new Date(startedAt);
  const end = endedAt instanceof Date ? endedAt : new Date(endedAt);
  const diff = end.getTime() - start.getTime();
  if (Number.isNaN(diff)) {
    return null;
  }
  return Math.max(0, diff);
}

export function getLivePhaseDuration(phase, now = new Date()) {
  if (!phase) {
    return null;
  }
  if (phase.status === "running") {
    return diffDurationMs(phase.startedAt, now) ?? phase.durationMs ?? null;
  }
  return phase.durationMs ?? diffDurationMs(phase.startedAt, phase.endedAt) ?? null;
}

export function formatDateTime(value) {
  if (!value) {
    return "暂无";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "暂无";
  }
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function normalizeMultilineText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function renderInlineMarkdown(value) {
  const escaped = escapeHtml(String(value ?? ""));
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// 这里只支持项目里真正用到的那一小部分 Markdown，
// 目标是可控，而不是完整兼容。
function renderMarkdownBlock(block) {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return "";
  }
  if (lines.every((line) => /^[-*+]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*+]\s+/, ""))}</li>`).join("")}</ul>`;
  }
  if (lines.every((line) => /^\d+\.\s+/.test(line))) {
    return `<ol>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
  }
  return `<p>${lines.map((line) => renderInlineMarkdown(line)).join("<br />")}</p>`;
}

export function renderMarkdown(value, { empty = "暂无内容" } = {}) {
  const text = normalizeMultilineText(value);
  if (!text) {
    return `<p class="muted">${escapeHtml(empty)}</p>`;
  }
  const segments = text.split(/```/);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) {
        return `<pre class="markdown-code"><code>${escapeHtml(segment.trim())}</code></pre>`;
      }
      return segment
        .split(/\n{2,}/)
        .map((block) => renderMarkdownBlock(block.trim()))
        .join("");
    })
    .join("");
}

export function renderPill(text, tone = "") {
  const toneClass = tone ? ` ${escapeHtml(tone)}` : "";
  return `<span class="inline-pill${toneClass}">${escapeHtml(text)}</span>`;
}

export function formatJsonPreview(value) {
  return `<pre class="json-preview">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

export function truncateText(value, maxLength = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "暂无说明";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
