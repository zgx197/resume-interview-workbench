import { SESSION_STATUS_LABELS, THREAD_STATUS_LABELS, TOPIC_LABELS } from "./constants.js";
import { escapeHtml, formatDateTime, renderInlineMarkdown, renderMarkdown } from "./utils.js";

export function topicLabel(category) {
  return TOPIC_LABELS[category] || category || "未分类";
}

export function sessionStatusLabel(status) {
  return SESSION_STATUS_LABELS[status] || status || "未知";
}

export function threadStatusLabel(status) {
  return THREAD_STATUS_LABELS[status] || status || "未知";
}

export function findCurrentThread(session) {
  if (!session) {
    return null;
  }
  return session.topicThreads?.find((thread) => thread.id === session.currentThreadId)
    || session.topicThreads?.find((thread) => thread.status === "active")
    || session.topicThreads?.at(-1)
    || null;
}

function formatList(items, fallback = "暂无") {
  return Array.isArray(items) && items.length
    ? items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")
    : `<li class="muted">${escapeHtml(fallback)}</li>`;
}

export function renderAssessmentDetails(assessment) {
  if (!assessment) {
    return '<p class="muted">等待本轮评估结果。</p>';
  }

  return `
    <div class="metric-grid">
      <div class="metric-tile">
        <span class="metric-label">评分</span>
        <strong>${escapeHtml(assessment.score)} / 5</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">置信度</span>
        <strong>${escapeHtml(assessment.confidence || "暂无")}</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">追问建议</span>
        <strong>${assessment.followupNeeded ? "需要" : "可切题"}</strong>
      </div>
    </div>
    <div class="detail-split">
      <div>
        <p class="detail-label">亮点</p>
        <ul class="supporting-list">${formatList(assessment.strengths, "暂无亮点摘要")}</ul>
      </div>
      <div>
        <p class="detail-label">风险</p>
        <ul class="supporting-list">${formatList(assessment.risks, "暂无风险摘要")}</ul>
      </div>
    </div>
    ${(assessment.evidenceUsed || []).length
      ? `
        <div>
          <p class="detail-label">引用证据</p>
          <div class="chip-wrap">
            ${assessment.evidenceUsed.map((item) => `<span class="topic-tag compact">${escapeHtml(item)}</span>`).join("")}
          </div>
        </div>
      `
      : ""}
    ${assessment.suggestedFollowup
      ? `
        <div>
          <p class="detail-label">建议追问</p>
          <div class="markdown-block subtle">${renderMarkdown(assessment.suggestedFollowup)}</div>
        </div>
      `
      : ""}
  `;
}

export function buildSessionModeLabel(session) {
  if (!session) {
    return "待开始";
  }
  const searchLabel = session.enableWebSearch ? "联网" : "离线";
  return `${sessionStatusLabel(session.status)} · ${searchLabel}`;
}

export function buildTemplateMeta(template) {
  return `
    <div class="template-meta-title">${escapeHtml(template.name)}</div>
    <div class="muted">最近使用：${escapeHtml(formatDateTime(template.recentUsedAt))}</div>
    <div class="muted">最后更新：${escapeHtml(formatDateTime(template.updatedAt))}</div>
  `;
}
