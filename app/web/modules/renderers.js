import { renderRunState } from "./graph.js";
import { elements } from "./dom.js";
import {
  buildSessionModeLabel,
  findCurrentThread,
  renderAssessmentDetails,
  sessionStatusLabel,
  topicLabel,
  topicNodeStatusLabel
} from "./presenters.js";
import { state } from "./state.js";
import { createBlankTemplate, fillTemplateForm, renderTemplatePicker, sortTemplates } from "./templates.js";
import {
  escapeHtml,
  formatDateTime,
  formatDuration,
  getLivePhaseDuration,
  renderMarkdown,
  renderPill,
  truncateText
} from "./utils.js";

const BACKGROUND_JOB_STATUS_LABELS = {
  pending: "排队中",
  running: "执行中",
  failed: "已失败",
  completed: "已完成",
  idle: "未启动"
};

const BACKGROUND_JOB_KIND_LABELS = {
  plan_refresh: "计划刷新",
  report: "复盘生成",
  thread_summary: "线程摘要"
};

const BACKGROUND_JOB_SCOPE_LABELS = {
  session: "会话级",
  thread: "话题级"
};

const BACKGROUND_JOB_STATUS_PRIORITY = {
  running: 0,
  pending: 1,
  failed: 2,
  idle: 3,
  completed: 4
};

// renderers.js 负责所有面向产品界面的 DOM 输出。
// 故意把写 DOM 的动作集中起来，保证 session 更新行为可预期。
function updateShellSummary() {
  if (elements.candidateYears) {
    const years = state.bootstrap?.candidate?.profile?.estimatedYearsExperience;
    elements.candidateYears.textContent = Number.isFinite(years) ? `${years}y` : "--";
  }

  if (elements.templateCount) {
    elements.templateCount.textContent = String(state.bootstrap?.templates?.length || 0);
  }

  if (elements.sessionMode) {
    elements.sessionMode.textContent = buildSessionModeLabel(state.session);
  }

  if (elements.activeThread) {
    const thread = findCurrentThread(state.session);
    elements.activeThread.textContent = thread?.label || "等待线程";
  }
}

export function renderBootstrap() {
  const { candidate, roles, jobs, provider } = state.bootstrap;
  const resumeReady = Boolean(candidate.ready);
  const missingFiles = candidate.missingFiles || [];
  const summaryPoints = (candidate.summaryPoints || []).length
    ? [...candidate.summaryPoints]
    : [];
  if (!resumeReady) {
    summaryPoints.push("当前 portable 发布包不会携带开发者本地简历数据。");
    summaryPoints.push(`请把你的简历数据导入到本地工作区：${candidate.workspacePath || "Local workspace"}`);
    summaryPoints.push("推荐一次选择 resume.json、resume.meta.json、resume.schema.json 三个文件。");
  } else if (missingFiles.length) {
    summaryPoints.push(`当前工作区仍缺少：${missingFiles.join("、")}`);
  }
  elements.providerBadge.textContent = provider.configured
    ? `Provider 路 ${provider.mode}`
    : "Provider 路 fallback only";
  elements.candidateName.textContent = candidate.profile.name || "未命名候选人";
  elements.candidateRole.textContent = candidate.profile.role || "暂无岗位信息";
  elements.candidateSummary.innerHTML = summaryPoints
    .slice(0, 4)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  if (!resumeReady) {
    elements.candidateName.textContent = "未导入简历";
    elements.candidateRole.textContent = "请先导入个人简历后再开始面试";
    elements.candidateSummary.innerHTML = summaryPoints
      .slice(0, 4)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  }
  elements.roleSelect.innerHTML = roles
    .map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`)
    .join("");
  elements.jobSelect.innerHTML = jobs
    .map((job) => `<option value="${escapeHtml(job.id)}">${escapeHtml(job.title)}</option>`)
    .join("");
  elements.topicGrid.innerHTML = (candidate.topTopics || [])
    .map((topic) => `<span class="topic-tag">${escapeHtml(topic.label)}</span>`)
    .join("");
  if (!candidate.topTopics?.length) {
    elements.topicGrid.innerHTML = '<span class="topic-tag">待导入简历</span>';
  }
  if (elements.importResumeButton) {
    elements.importResumeButton.disabled = state.resumeImporting;
    elements.importResumeButton.textContent = state.resumeImporting ? "正在导入..." : "导入简历";
    elements.importResumeButton.title = candidate.workspacePath
      ? `本地工作区：${candidate.workspacePath}`
      : "";
  }
  elements.startButton.disabled = !resumeReady || state.resumeImporting;
  elements.startButton.title = resumeReady
    ? ""
    : "当前工作区还没有导入简历，暂时不能开始面试。";
  state.bootstrap.templates = sortTemplates(state.bootstrap.templates || []);
  renderTemplatePicker();
  fillTemplateForm(state.bootstrap.templates[0] || createBlankTemplate());
  updateShellSummary();
}

// 计划区默认保持高信息密度，但把次级细节折叠起来，
// 这样在调试信息变多之后仍然能保持可读性。
function renderPlan() {
  if (!state.session) {
    elements.planList.className = "plan-list empty-state";
    elements.planList.textContent = "开始面试后，这里会展示当前阶段和整体覆盖计划。";
    return;
  }

  const coverage = state.session.coverage || {};
  elements.planList.className = "plan-list";
  elements.planList.innerHTML = (state.session.plan?.stages || [])
    .map((stage, index) => {
      const bucket = coverage[stage.category] || {};
      const isCurrent = index === state.session.stageIndex;
      const topics = (stage.targetTopics || []).slice(0, 4).map((topic) => topic.label);
      const avgScore = bucket.averageScore ? `均分 ${bucket.averageScore}` : "未评估";

      return `
        <details class="fold-card plan-card ${isCurrent ? "is-current" : ""}" ${isCurrent ? "open" : ""}>
          <summary>
            <div class="fold-summary-main">
              <p class="card-kicker">${escapeHtml(topicLabel(stage.category))}</p>
              <h3 class="card-title">${escapeHtml(stage.title || "阶段")}</h3>
              <p class="summary-copy">${escapeHtml(stage.goal || "等待阶段目标。")}</p>
            </div>
            <div class="summary-badges">
              ${renderPill(`${bucket.asked || 0} / ${bucket.planned || 0} 题`, isCurrent ? "accent" : "")}
              ${renderPill(avgScore)}
            </div>
          </summary>
          <div class="fold-body">
            <div>
              <p class="detail-label">目标主题</p>
              <div class="chip-wrap">
                ${topics.length ? topics.map((topic) => `<span class="topic-tag compact">${escapeHtml(topic)}</span>`).join("") : '<span class="muted">等待问题生成</span>'}
              </div>
            </div>
            <div>
              <p class="detail-label">提示</p>
              <div class="markdown-block subtle">${renderMarkdown(stage.promptHint, { empty: "暂无提示" })}</div>
            </div>
          </div>
        </details>
      `;
    })
    .join("");
}

// 对话区同时渲染历史 turn 和当前待答题，
// 这样用户在回答之前也能看到完整的当前状态。
function renderConversation() {
  if (!state.session) {
    elements.conversation.className = "conversation empty-state";
    elements.conversation.textContent = "暂无对话。";
    return;
  }

  const cards = [];

  for (const turn of state.session.turns) {
    const thread = state.session.topicThreads?.find((item) => item.id === turn.threadId);
    const assessmentLabel = turn.processing
      ? "评估中"
      : turn.assessment
        ? `评分 ${turn.assessment.score} / 5`
        : "等待评估";

    cards.push(`
      <article class="turn-card">
        <header class="turn-header">
          <div>
            <p class="turn-role">Round ${escapeHtml(turn.index)}</p>
            <h3 class="card-title">${escapeHtml(thread?.label || turn.question.topicLabel || topicLabel(turn.question.topicCategory))}</h3>
          </div>
          <div class="summary-badges">
            ${renderPill(topicLabel(turn.question.topicCategory))}
            ${renderPill(assessmentLabel, turn.processing ? "accent" : "")}
          </div>
        </header>

        <div class="turn-meta">
          <span>${escapeHtml(turn.question.evidenceSource || "无证据来源")}</span>
          <span>${escapeHtml(turn.question._providerMeta?.strategyLabel || turn.question.strategy || "question")}</span>
        </div>

        <div class="dialogue-pair">
          <section class="dialogue-bubble interviewer">
            <p class="bubble-label">Interviewer</p>
            <div class="markdown-block">${renderMarkdown(turn.question.text)}</div>
          </section>

          <section class="dialogue-bubble candidate">
            <p class="bubble-label">Candidate</p>
            <div class="markdown-block answer">${renderMarkdown(turn.answer, { empty: "暂无回答" })}</div>
          </section>
        </div>

        <details class="fold-card embedded-card" ${turn.processing ? "open" : ""}>
          <summary>
            <div class="fold-summary-main">
              <p class="card-kicker">Assessment</p>
              <h3 class="card-title">回答评估</h3>
              <p class="summary-copy">${escapeHtml(assessmentLabel)}</p>
            </div>
            <div class="summary-badges">
              ${renderPill(assessmentLabel, turn.processing ? "accent" : "")}
            </div>
          </summary>
          <div class="fold-body">
            ${turn.processing ? '<p class="muted">评估尚未完成，请等待当前回合结束。</p>' : renderAssessmentDetails(turn.assessment)}
          </div>
        </details>
      </article>
    `);
  }

  if (state.session.nextQuestion) {
    const thread = state.session.topicThreads?.find((item) => item.id === state.session.nextQuestion.threadId);
    cards.push(`
      <article class="turn-card current-question">
        <header class="turn-header">
          <div>
            <p class="turn-role">Current Question</p>
            <h3 class="card-title">${escapeHtml(thread?.label || state.session.nextQuestion.topicLabel || topicLabel(state.session.nextQuestion.topicCategory))}</h3>
          </div>
          <div class="summary-badges">
            ${renderPill(state.session.nextQuestion._providerMeta?.strategyLabel || "question")}
            ${renderPill(state.session.nextQuestion.evidenceSource || "无证据来源")}
          </div>
        </header>

        <div class="turn-meta emphasis">
          <span>${escapeHtml(topicLabel(state.session.nextQuestion.topicCategory))}</span>
          <span>${escapeHtml(state.session.nextQuestion.threadId || "未绑定线程")}</span>
        </div>

        <section class="dialogue-bubble interviewer current">
          <p class="bubble-label">Interviewer</p>
          <div class="markdown-block">${renderMarkdown(state.session.nextQuestion.text)}</div>
        </section>

        <details class="fold-card embedded-card">
          <summary>
            <div class="fold-summary-main">
              <p class="card-kicker">Question Intent</p>
              <h3 class="card-title">出题意图</h3>
              <p class="summary-copy">${escapeHtml(state.session.nextQuestion.evidenceSource || "无证据来源")}</p>
            </div>
            <div class="summary-badges">
              ${renderPill(state.session.nextQuestion._providerMeta?.strategyLabel || "question")}
            </div>
          </summary>
          <div class="fold-body">
            <div class="detail-split">
              <div>
                <p class="detail-label">证据来源</p>
                <div class="markdown-block subtle">${renderMarkdown(state.session.nextQuestion.evidenceSource, { empty: "暂无" })}</div>
              </div>
              <div>
                <p class="detail-label">提问理由</p>
                <div class="markdown-block subtle">${renderMarkdown(state.session.nextQuestion.rationale, { empty: "暂无" })}</div>
              </div>
            </div>
          </div>
        </details>
      </article>
    `);
  }

  elements.conversation.className = "conversation";
  elements.conversation.innerHTML = cards.length ? cards.join("") : "暂无对话。";
}

function renderReportJobCard(job) {
  const statusLabels = {
    pending: "排队中",
    running: "生成中",
    failed: "生成失败",
    completed: "已完成",
    idle: "未启动"
  };
  const status = job?.status || "idle";

  return `
    <article class="report-card">
      <p class="card-kicker">Report Job</p>
      <div class="turn-header">
        <div>
          <h3 class="card-title">复盘生成状态</h3>
          <p class="summary-copy">${escapeHtml(
            status === "failed"
              ? "后台生成未完成，本次结果暂时不可用。"
              : "面试已结束，完整复盘会在后台生成完成后自动回填。"
          )}</p>
        </div>
        <div class="summary-badges">
          ${renderPill(statusLabels[status] || status, status === "running" ? "accent" : "")}
        </div>
      </div>
      <div class="metric-grid compact">
        <div class="metric-tile">
          <span class="metric-label">状态</span>
          <strong>${escapeHtml(statusLabels[status] || status)}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">尝试次数</span>
          <strong>${escapeHtml(job?.attempts ?? 0)}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">任务类型</span>
          <strong>${escapeHtml(job?.kind || "report")}</strong>
        </div>
      </div>
      <div class="markdown-block subtle">${renderMarkdown(
        job?.error
          ? `- 错误：${job.error}`
          : (status === "pending" || status === "running"
            ? "- 正在等待后台任务完成。"
            : "- 当前还没有可展示的复盘内容。")
      )}</div>
    </article>
  `;
}

function compareBackgroundJobs(left, right) {
  const leftPriority = BACKGROUND_JOB_STATUS_PRIORITY[left?.status] ?? 99;
  const rightPriority = BACKGROUND_JOB_STATUS_PRIORITY[right?.status] ?? 99;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftLabel = left?.targetLabel || "";
  const rightLabel = right?.targetLabel || "";
  return leftLabel.localeCompare(rightLabel, "zh-CN");
}

function renderBackgroundJobCard(job) {
  const status = job?.status || "idle";
  const statusLabel = BACKGROUND_JOB_STATUS_LABELS[status] || status;
  const kindLabel = BACKGROUND_JOB_KIND_LABELS[job?.kind] || job?.kind || "后台任务";
  const scopeLabel = BACKGROUND_JOB_SCOPE_LABELS[job?.scope] || job?.scope || "未知";
  const targetLabel = job?.targetLabel || kindLabel;

  return `
    <article class="report-card background-job-card">
      <div class="turn-header">
        <div>
          <p class="card-kicker">${escapeHtml(kindLabel)}</p>
          <h3 class="card-title">${escapeHtml(targetLabel)}</h3>
        </div>
        <div class="summary-badges">
          ${renderPill(statusLabel, status === "pending" || status === "running" ? "accent" : "")}
        </div>
      </div>
      <div class="metric-grid compact background-job-metrics">
        <div class="metric-tile">
          <span class="metric-label">作用域</span>
          <strong>${escapeHtml(scopeLabel)}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">尝试次数</span>
          <strong>${escapeHtml(job?.attempts ?? 0)}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">状态</span>
          <strong>${escapeHtml(statusLabel)}</strong>
        </div>
      </div>
      <div class="turn-meta ${job?.error ? "emphasis" : ""}">
        <span>${escapeHtml(job?.kind || "job")}</span>
        <span>${escapeHtml(job?.id || "未生成 ID")}</span>
      </div>
      ${job?.error
        ? `<div class="markdown-block subtle background-job-error">${renderMarkdown(`- 错误：${job.error}`)}</div>`
        : ""}
    </article>
  `;
}

// 后台冷路径任务统一从 backgroundJobs 读取并展示，
// 这样计划刷新、复盘生成和线程摘要可以在同一处观察。
function renderBackgroundJobs() {
  if (!state.session) {
    elements.backgroundJobsPanel.className = "empty-state";
    elements.backgroundJobsPanel.textContent = "开始面试后，这里会统一显示冷路径任务状态。";
    return;
  }

  const jobs = [...(state.session.backgroundJobs || [])].sort(compareBackgroundJobs);
  if (!jobs.length) {
    elements.backgroundJobsPanel.className = "empty-state";
    elements.backgroundJobsPanel.textContent = "当前没有需要跟踪的后台任务。";
    return;
  }

  elements.backgroundJobsPanel.className = "report-grid";
  elements.backgroundJobsPanel.innerHTML = jobs.map(renderBackgroundJobCard).join("");
}

function renderObservabilityRow({ title, subtitle, meta, badges = [] }) {
  return `
    <div class="observability-row">
      <div class="observability-row-main">
        <strong>${escapeHtml(title)}</strong>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <div class="observability-row-side">
        ${badges.length ? `<div class="summary-badges">${badges.join("")}</div>` : ""}
        ${meta ? `<span class="observability-meta">${escapeHtml(meta)}</span>` : ""}
      </div>
    </div>
  `;
}

function renderObservabilitySourceCard(overview, sessionSummary) {
  const files = overview?.source?.files || [];
  const sessionId = sessionSummary?.sessionId || state.session?.id || "";

  return `
    <article class="report-card observability-card">
      <div class="turn-header">
        <div>
          <p class="card-kicker">Observability</p>
          <h3 class="card-title">聚合总览</h3>
          <p class="summary-copy">最近日志文件、当前过滤范围和活跃 session 统计。</p>
        </div>
        <div class="summary-badges">
          ${renderPill(formatDateTime(overview?.generatedAt || sessionSummary?.generatedAt || null))}
        </div>
      </div>
      <div class="metric-grid compact">
        <div class="metric-tile">
          <span class="metric-label">日志文件</span>
          <strong>${escapeHtml(files.length || 0)}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">可见日志</span>
          <strong>${escapeHtml(overview?.source?.visibleEntryCount ?? "--")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">当前 Session</span>
          <strong>${escapeHtml(sessionSummary?.source?.matchedEntryCount ?? "--")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">后台任务</span>
          <strong>${escapeHtml(sessionSummary?.backgroundJobs?.length ?? "--")}</strong>
        </div>
      </div>
      <div class="chip-wrap">
        ${files.length
          ? files.map((file) => `<span class="topic-tag compact">${escapeHtml(file)}</span>`).join("")
          : '<span class="muted">暂无日志文件</span>'}
      </div>
      ${sessionId ? `<div class="turn-meta"><span>${escapeHtml(sessionId)}</span></div>` : ""}
    </article>
  `;
}

function renderSlowSpanCard(overview) {
  const items = overview?.slowSpans?.items || [];

  return `
    <article class="report-card observability-card">
      <div class="turn-header">
        <div>
          <p class="card-kicker">Slow Spans</p>
          <h3 class="card-title">最近慢调用</h3>
        </div>
        <div class="summary-badges">
          ${renderPill(`阈值 ${overview?.slowSpans?.thresholdMs ?? "--"} ms`)}
        </div>
      </div>
      <div class="observability-list">
        ${items.length
          ? items.map((item) => renderObservabilityRow({
            title: item.summary || `${item.component} / ${item.event}`,
            subtitle: item.phase || item.purpose || item.jobKind || item.event,
            meta: `${formatDateTime(item.ts)} · ${formatDuration(item.durationMs)}`,
            badges: [
              renderPill(item.component || "unknown"),
              item.status ? renderPill(item.status) : ""
            ].filter(Boolean)
          })).join("")
          : '<p class="muted">最近没有可展示的慢调用。</p>'}
      </div>
    </article>
  `;
}

function renderProviderCallCard(overview, sessionSummary) {
  const items = (sessionSummary?.recentProviderCalls?.length
    ? sessionSummary.recentProviderCalls
    : overview?.recentProviderCalls) || [];
  const scopeLabel = sessionSummary?.recentProviderCalls?.length ? "当前 Session" : "最近日志";

  return `
    <article class="report-card observability-card">
      <div class="turn-header">
        <div>
          <p class="card-kicker">Provider Calls</p>
          <h3 class="card-title">最近模型调用</h3>
        </div>
        <div class="summary-badges">
          ${renderPill(scopeLabel)}
        </div>
      </div>
      <div class="observability-list">
        ${items.length
          ? items.map((item) => renderObservabilityRow({
            title: `${item.purpose || "unknown"} / ${item.model || "unknown"}`,
            subtitle: truncateText(item.summary || item.fallbackReason || "", 56),
            meta: `${formatDateTime(item.ts)} · ${formatDuration(item.durationMs)}`,
            badges: [
              item.fallbackUsed ? renderPill("fallback", "accent") : "",
              item.thinkingType ? renderPill(item.thinkingType) : "",
              item.enableWebSearch ? renderPill("web") : ""
            ].filter(Boolean)
          })).join("")
          : '<p class="muted">最近还没有 provider 调用记录。</p>'}
      </div>
    </article>
  `;
}

function renderSessionTimelineCard(sessionSummary) {
  const items = sessionSummary?.timeline || [];

  return `
    <article class="report-card observability-card">
      <div class="turn-header">
        <div>
          <p class="card-kicker">Session Timeline</p>
          <h3 class="card-title">当前 Session 时间线</h3>
        </div>
        <div class="summary-badges">
          ${renderPill(`${items.length} 条`)}
        </div>
      </div>
      <div class="observability-list">
        ${items.length
          ? items.map((item) => renderObservabilityRow({
            title: item.label || `${item.component} / ${item.event}`,
            subtitle: item.phase || item.purpose || item.jobKind || "",
            meta: `${formatDateTime(item.ts)}${item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ""}`,
            badges: [
              item.turnIndex !== null ? renderPill(`Round ${item.turnIndex}`) : "",
              item.fallbackUsed ? renderPill("fallback", "accent") : ""
            ].filter(Boolean)
          })).join("")
          : '<p class="muted">开始面试后，这里会显示当前 session 的关键时间线。</p>'}
      </div>
    </article>
  `;
}

function renderObservability() {
  if (!elements.observabilityPanel) {
    return;
  }

  // 这里优先展示“人能快速读懂”的聚合摘要，而不是把原始日志直接倾倒到界面里。
  const overview = state.observabilityOverview;
  const sessionSummary = state.observabilitySession;

  if (!overview && !state.observabilityError) {
    elements.observabilityPanel.className = "empty-state";
    elements.observabilityPanel.textContent = "日志聚合视图加载中...";
    return;
  }

  const cards = [];

  if (state.observabilityError) {
    cards.push(`
      <article class="report-card observability-card observability-error-card">
        <p class="card-kicker">Observability</p>
        <h3 class="card-title">日志聚合视图暂不可用</h3>
        <div class="markdown-block subtle">${renderMarkdown(state.observabilityError, { empty: "请求失败" })}</div>
      </article>
    `);
  }

  if (overview) {
    cards.push(renderObservabilitySourceCard(overview, sessionSummary));
    cards.push(renderSlowSpanCard(overview));
    cards.push(renderProviderCallCard(overview, sessionSummary));
  }

  cards.push(renderSessionTimelineCard(sessionSummary));

  elements.observabilityPanel.className = "report-grid";
  elements.observabilityPanel.innerHTML = cards.join("");
}

function renderReportLegacy() {
  const reportJob = state.session?.backgroundJobs?.find((job) => job.kind === "report")
    || state.session?.reportJob
    || null;
  if (!state.session?.report) {
    elements.reportPanel.className = "empty-state";
    const reportJobStatus = reportJob?.status;
    if (reportJobStatus === "pending" || reportJobStatus === "running") {
      elements.reportPanel.className = "report-grid";
      elements.reportPanel.innerHTML = renderReportJobCard(reportJob);
      return;
      elements.reportPanel.textContent = "面试已结束，结构化复盘正在后台生成。";
      return;
    }
    if (reportJobStatus === "failed") {
      elements.reportPanel.className = "report-grid";
      elements.reportPanel.innerHTML = renderReportJobCard(reportJob);
      return;
      elements.reportPanel.textContent = "复盘生成失败，请稍后刷新重试。";
      return;
    }
    elements.reportPanel.textContent = "完成面试后，这里会显示结构化复盘。";
    return;
  }

  const report = state.session.report;
  elements.reportPanel.className = "report-grid";
  elements.reportPanel.innerHTML = `
    <article class="report-card">
      <p class="card-kicker">Summary</p>
      <div class="markdown-block">${renderMarkdown(report.summary)}</div>
    </article>
    <article class="report-card">
      <p class="card-kicker">Coverage</p>
      <div class="metric-grid compact">
        <div class="metric-tile">
          <span class="metric-label">计划主题</span>
          <strong>${escapeHtml(report.coverageSummary?.plannedTopicCount ?? "--")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">已覆盖主题</span>
          <strong>${escapeHtml(report.coverageSummary?.coveredTopicCount ?? "--")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">总轮次</span>
          <strong>${escapeHtml(report.coverageSummary?.turnCount ?? state.session.turns.length ?? "--")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">图谱均分</span>
          <strong>${escapeHtml(report.coverageSummary?.averageTopicScore ?? "--")}</strong>
        </div>
      </div>
      ${report.coverageSummary?.summary
        ? `<div class="markdown-block subtle">${renderMarkdown(report.coverageSummary.summary)}</div>`
        : ""}
    </article>
    <article class="report-card">
      <p class="card-kicker">Dimensions</p>
      <div class="report-dimensions">
        ${(report.dimensions || []).length
          ? report.dimensions.map((item) => `
              <div class="metric-tile">
                <span class="metric-label">${escapeHtml(topicLabel(item.category))}</span>
                <strong>${escapeHtml(item.averageScore)}</strong>
              </div>
            `).join("")
          : '<p class="muted">暂无维度评分。</p>'}
      </div>
    </article>
    <article class="report-card">
      <p class="card-kicker">Strengths</p>
      <ul class="supporting-list">
        ${(report.strengths || []).length
          ? report.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
          : '<li class="muted">暂无</li>'}
      </ul>
    </article>
    <article class="report-card">
      <p class="card-kicker">Risks</p>
      <ul class="supporting-list">
        ${(report.risks || []).length
          ? report.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
          : '<li class="muted">暂无</li>'}
      </ul>
    </article>
    <article class="report-card">
      <p class="card-kicker">Topic Coverage</p>
      <div class="graph-detail-sections">
        ${(report.topicCoverage || []).length
          ? report.topicCoverage.map((item) => `
              <section class="graph-detail-section">
                <div class="turn-header">
                  <div>
                    <p class="card-kicker">${escapeHtml(topicLabel(item.category))}</p>
                    <h3 class="card-title">${escapeHtml(item.label)}</h3>
                  </div>
                  <div class="summary-badges">
                    ${renderPill(topicNodeStatusLabel(item.status || "idle"))}
                    ${renderPill(`问过 ${item.askCount || 0} 次`)}
                    ${renderPill(`均分 ${item.averageScore ?? "--"}`)}
                  </div>
                </div>
                <div class="chip-wrap">
                  ${(item.stageTitles || []).length
                    ? item.stageTitles.map((stageTitle) => `<span class="topic-tag compact">${escapeHtml(stageTitle)}</span>`).join("")
                    : '<span class="muted">未绑定计划阶段</span>'}
                </div>
                <div class="markdown-block subtle">${renderMarkdown((item.evidence || []).map((evidence) => `- ${evidence}`).join("\n"), { empty: "暂无证据摘要" })}</div>
              </section>
            `).join("")
          : '<p class="muted">暂无主题覆盖摘要。</p>'}
      </div>
    </article>
    <article class="report-card">
      <p class="card-kicker">Evidence Highlights</p>
      <div class="graph-detail-sections">
        ${(report.evidenceHighlights || []).length
          ? report.evidenceHighlights.map((item) => `
              <section class="graph-detail-section">
                <div class="turn-meta emphasis">
                  <span>${escapeHtml(item.topicLabel || "未命名主题")}</span>
                  <span>${escapeHtml(item.evidenceSource || "暂无证据来源")}</span>
                  <span>${escapeHtml(item.score ?? "--")} / 5</span>
                </div>
                <div class="markdown-block subtle">${renderMarkdown(item.summary, { empty: "暂无摘要" })}</div>
              </section>
            `).join("")
          : '<p class="muted">暂无证据高亮。</p>'}
      </div>
    </article>
  `;
}

function renderReport() {
  const reportJob = state.session?.backgroundJobs?.find((job) => job.kind === "report")
    || state.session?.reportJob
    || null;

  if (!state.session?.report) {
    elements.reportPanel.className = "empty-state";
    const reportJobStatus = reportJob?.status;
    if (reportJobStatus === "pending" || reportJobStatus === "running") {
      elements.reportPanel.className = "report-grid";
      elements.reportPanel.innerHTML = renderReportJobCard(reportJob);
      return;
    }
    if (reportJobStatus === "failed") {
      elements.reportPanel.className = "report-grid";
      elements.reportPanel.innerHTML = renderReportJobCard(reportJob);
      return;
    }

    elements.reportPanel.textContent = "完成面试后，这里会显示结构化复盘。";
    return;
  }

  const report = state.session.report;
  elements.reportPanel.className = "report-grid";
  elements.reportPanel.innerHTML = `
    <article class="report-card">
      <p class="card-kicker">Summary</p>
      <div class="markdown-block">${renderMarkdown(report.summary)}</div>
    </article>
    <article class="report-card">
      <p class="card-kicker">Coverage</p>
      <div class="metric-grid compact">
        <div class="metric-tile">
          <span class="metric-label">计划主题</span>
          <strong>${escapeHtml(report.coverageSummary?.plannedTopicCount ?? "--")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">已覆盖主题</span>
          <strong>${escapeHtml(report.coverageSummary?.coveredTopicCount ?? "--")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">总轮次</span>
          <strong>${escapeHtml(report.coverageSummary?.turnCount ?? state.session.turns.length ?? "--")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">图谱均分</span>
          <strong>${escapeHtml(report.coverageSummary?.averageTopicScore ?? "--")}</strong>
        </div>
      </div>
      ${report.coverageSummary?.summary
        ? `<div class="markdown-block subtle">${renderMarkdown(report.coverageSummary.summary)}</div>`
        : ""}
    </article>
    <article class="report-card">
      <p class="card-kicker">Dimensions</p>
      <div class="report-dimensions">
        ${(report.dimensions || []).length
          ? report.dimensions.map((item) => `
              <div class="metric-tile">
                <span class="metric-label">${escapeHtml(topicLabel(item.category))}</span>
                <strong>${escapeHtml(item.averageScore)}</strong>
              </div>
            `).join("")
          : '<p class="muted">暂无维度评分。</p>'}
      </div>
    </article>
    <article class="report-card">
      <p class="card-kicker">Strengths</p>
      <ul class="supporting-list">
        ${(report.strengths || []).length
          ? report.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
          : '<li class="muted">暂无</li>'}
      </ul>
    </article>
    <article class="report-card">
      <p class="card-kicker">Risks</p>
      <ul class="supporting-list">
        ${(report.risks || []).length
          ? report.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
          : '<li class="muted">暂无</li>'}
      </ul>
    </article>
    <article class="report-card">
      <p class="card-kicker">Topic Coverage</p>
      <div class="graph-detail-sections">
        ${(report.topicCoverage || []).length
          ? report.topicCoverage.map((item) => `
              <section class="graph-detail-section">
                <div class="turn-header">
                  <div>
                    <p class="card-kicker">${escapeHtml(topicLabel(item.category))}</p>
                    <h3 class="card-title">${escapeHtml(item.label)}</h3>
                  </div>
                  <div class="summary-badges">
                    ${renderPill(topicNodeStatusLabel(item.status || "idle"))}
                    ${renderPill(`问过 ${item.askCount || 0} 次`)}
                    ${renderPill(`均分 ${item.averageScore ?? "--"}`)}
                  </div>
                </div>
                <div class="chip-wrap">
                  ${(item.stageTitles || []).length
                    ? item.stageTitles.map((stageTitle) => `<span class="topic-tag compact">${escapeHtml(stageTitle)}</span>`).join("")
                    : '<span class="muted">未绑定计划阶段</span>'}
                </div>
                <div class="markdown-block subtle">${renderMarkdown((item.evidence || []).map((evidence) => `- ${evidence}`).join("\n"), { empty: "暂无证据摘要" })}</div>
              </section>
            `).join("")
          : '<p class="muted">暂无主题覆盖摘要。</p>'}
      </div>
    </article>
    <article class="report-card">
      <p class="card-kicker">Evidence Highlights</p>
      <div class="graph-detail-sections">
        ${(report.evidenceHighlights || []).length
          ? report.evidenceHighlights.map((item) => `
              <section class="graph-detail-section">
                <div class="turn-meta emphasis">
                  <span>${escapeHtml(item.topicLabel || "未命名主题")}</span>
                  <span>${escapeHtml(item.evidenceSource || "暂无证据来源")}</span>
                  <span>${escapeHtml(item.score ?? "--")} / 5</span>
                </div>
                <div class="markdown-block subtle">${renderMarkdown(item.summary, { empty: "暂无摘要" })}</div>
              </section>
            `).join("")
          : '<p class="muted">暂无证据高亮。</p>'}
      </div>
    </article>
  `;
}

function renderObservabilityPanelRow({ title, subtitle, meta, badges = [] }) {
  return `
    <div class="observability-row compact">
      <div class="observability-row-main">
        <strong>${escapeHtml(title)}</strong>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <div class="observability-row-side">
        ${badges.length ? `<div class="summary-badges">${badges.join("")}</div>` : ""}
        ${meta ? `<span class="observability-meta">${escapeHtml(meta)}</span>` : ""}
      </div>
    </div>
  `;
}

function resolveObservabilityPanelScope() {
  if (state.observabilityScope === "session" && state.observabilitySession) {
    return "session";
  }
  return "global";
}

function buildObservabilityPanelModel() {
  const scope = resolveObservabilityPanelScope();
  const overview = state.observabilityOverview;
  const sessionSummary = state.observabilitySession;
  const source = scope === "session" ? sessionSummary : overview;

  return {
    scope,
    sessionSummary,
    files: overview?.source?.files || [],
    generatedAt: source?.generatedAt || overview?.generatedAt || sessionSummary?.generatedAt || null,
    sourceCount: scope === "session"
      ? (sessionSummary?.source?.matchedEntryCount ?? 0)
      : (overview?.source?.visibleEntryCount ?? 0),
    slowSpans: source?.slowSpans?.items || [],
    slowThresholdMs: source?.slowSpans?.thresholdMs ?? overview?.slowSpans?.thresholdMs ?? null,
    providerCalls: source?.recentProviderCalls || [],
    timeline: scope === "session"
      ? (sessionSummary?.timeline || [])
      : (overview?.recentTimeline || [])
  };
}

function renderObservabilityPanelCard({ kicker, title, countLabel, items, emptyText, buildRow }) {
  return `
    <article class="report-card observability-card compact">
      <div class="observability-card-header">
        <div>
          <p class="card-kicker">${escapeHtml(kicker)}</p>
          <h3 class="card-title">${escapeHtml(title)}</h3>
        </div>
        <div class="summary-badges">
          ${renderPill(countLabel)}
        </div>
      </div>
      <div class="observability-list compact">
        ${items.length
          ? items.map((item) => buildRow(item)).join("")
          : `<p class="muted">${escapeHtml(emptyText)}</p>`}
      </div>
    </article>
  `;
}

function renderObservabilityPanel() {
  if (!elements.observabilityPanel) {
    return;
  }

  if (!state.observabilityOverview && !state.observabilityError) {
    elements.observabilityPanel.className = "empty-state";
    elements.observabilityPanel.textContent = "日志聚合视图加载中...";
    return;
  }

  const model = buildObservabilityPanelModel();
  const isSessionScope = model.scope === "session";
  const hasSessionScope = Boolean(model.sessionSummary);
  const sessionId = model.sessionSummary?.sessionId || state.session?.id || "";

  const slowCard = renderObservabilityPanelCard({
    kicker: "Slow Spans",
    title: "最近慢调用",
    countLabel: `阈值 ${model.slowThresholdMs ?? "--"} ms`,
    items: model.slowSpans,
    emptyText: "最近没有可展示的慢调用。",
    buildRow: (item) => renderObservabilityPanelRow({
      title: item.summary || `${item.component} / ${item.event}`,
      subtitle: item.phase || item.purpose || item.jobKind || item.event,
      meta: `${formatDateTime(item.ts)} · ${formatDuration(item.durationMs)}`,
      badges: [
        renderPill(item.component || "unknown"),
        item.status ? renderPill(item.status) : ""
      ].filter(Boolean)
    })
  });

  const providerCard = renderObservabilityPanelCard({
    kicker: "Provider Calls",
    title: "最近模型调用",
    countLabel: `${model.providerCalls.length} 条`,
    items: model.providerCalls,
    emptyText: "最近还没有 provider 调用记录。",
    buildRow: (item) => renderObservabilityPanelRow({
      title: `${item.purpose || "unknown"} / ${item.model || "unknown"}`,
      subtitle: truncateText(item.summary || item.fallbackReason || "", 52),
      meta: `${formatDateTime(item.ts)} · ${formatDuration(item.durationMs)}`,
      badges: [
        item.fallbackUsed ? renderPill("fallback", "accent") : "",
        item.thinkingType ? renderPill(item.thinkingType) : "",
        item.enableWebSearch ? renderPill("web") : ""
      ].filter(Boolean)
    })
  });

  const timelineCard = renderObservabilityPanelCard({
    kicker: isSessionScope ? "Session Timeline" : "Global Timeline",
    title: isSessionScope ? "当前 Session 时间线" : "最近全局时间线",
    countLabel: `${model.timeline.length} 条`,
    items: model.timeline,
    emptyText: isSessionScope
      ? "开始面试后，这里会显示当前 session 的关键时间线。"
      : "最近还没有可展示的全局时间线。",
    buildRow: (item) => renderObservabilityPanelRow({
      title: item.label || `${item.component} / ${item.event}`,
      subtitle: item.phase || item.purpose || item.jobKind || "",
      meta: `${formatDateTime(item.ts)}${item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ""}`,
      badges: [
        item.turnIndex !== null ? renderPill(`Round ${item.turnIndex}`) : "",
        item.fallbackUsed ? renderPill("fallback", "accent") : ""
      ].filter(Boolean)
    })
  });

  const errorCard = state.observabilityError
    ? `
      <article class="report-card observability-card observability-error-card">
        <p class="card-kicker">Observability</p>
        <h3 class="card-title">日志聚合视图暂不可用</h3>
        <div class="markdown-block subtle">${renderMarkdown(state.observabilityError, { empty: "请求失败" })}</div>
      </article>
    `
    : "";

  elements.observabilityPanel.className = "observability-shell";
  elements.observabilityPanel.innerHTML = `
    <div class="observability-toolbar">
      <div>
        <p class="card-kicker">Observability</p>
        <h3 class="card-title">聚合视图</h3>
        <p class="summary-copy">慢调用、模型调用和关键时间线压缩到一屏内观察。</p>
      </div>
      <div class="observability-toolbar-side">
        <div class="scope-toggle" role="tablist" aria-label="日志聚合范围">
          <button
            type="button"
            class="scope-toggle-button ${isSessionScope ? "is-active" : ""}"
            data-observability-scope="session"
            ${hasSessionScope ? "" : "disabled"}
          >
            仅看当前 Session
          </button>
          <button
            type="button"
            class="scope-toggle-button ${!isSessionScope ? "is-active" : ""}"
            data-observability-scope="global"
          >
            看全局
          </button>
        </div>
        <div class="summary-badges">
          ${renderPill(isSessionScope ? "当前 Session" : "全局")}
          ${renderPill(formatDateTime(model.generatedAt))}
        </div>
      </div>
    </div>
    <div class="observability-summary-strip">
      <div class="summary-badges">
        ${renderPill(`日志 ${model.files.length}`)}
        ${renderPill(`范围内 ${model.sourceCount}`)}
        ${renderPill(`慢调用 ${model.slowSpans.length}`)}
        ${renderPill(`模型调用 ${model.providerCalls.length}`)}
      </div>
      ${isSessionScope && sessionId ? `<span class="observability-meta">${escapeHtml(sessionId)}</span>` : ""}
    </div>
    ${errorCard}
    <div class="observability-grid">
      ${slowCard}
      ${providerCard}
      ${timelineCard}
    </div>
  `;
}

function renderDesktopRuntimePanel() {
  if (!elements.desktopRuntimePanel) {
    return;
  }

  if (!state.desktopRuntime && !state.desktopRuntimeError) {
    elements.desktopRuntimePanel.className = "empty-state";
    elements.desktopRuntimePanel.textContent = "Loading desktop runtime...";
    return;
  }

  if (state.desktopRuntimeError) {
    elements.desktopRuntimePanel.className = "empty-state";
    elements.desktopRuntimePanel.textContent = state.desktopRuntimeError;
    return;
  }

  const runtime = state.desktopRuntime;
  const cleanupTargets = runtime?.cleanupTargets || [];
  const fullReset = runtime?.fullReset || null;

  if (!runtime?.enabled) {
    elements.desktopRuntimePanel.className = "empty-state";
    elements.desktopRuntimePanel.textContent = "当前是普通 Web 运行模式，未启用 desktop runtime。";
    return;
  }

  const counts = runtime.counts || {};
  const metricItems = [
    ["缓存", counts.cacheEntries],
    ["临时文件", counts.tmpEntries],
    ["日志", counts.logEntries],
    ["导出", counts.exportEntries]
  ];

  elements.desktopRuntimePanel.className = "report-grid";
  elements.desktopRuntimePanel.innerHTML = `
    <article class="report-card">
      <p class="card-kicker">Runtime</p>
      <div class="metric-grid compact">
        <div class="metric-tile">
          <span class="metric-label">运行模式</span>
          <strong>${escapeHtml(runtime.desktopRuntimeMode || "desktop")}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">数据库模式</span>
          <strong>${escapeHtml(runtime.desktopDatabaseMode || "managed")}</strong>
        </div>
      </div>
      <div class="graph-detail-sections">
        <section class="graph-detail-section">
          <p class="detail-label">数据目录</p>
          <div class="markdown-code">${escapeHtml(runtime.dataDir || "")}</div>
        </section>
        <section class="graph-detail-section">
          <p class="detail-label">关键路径</p>
          <div class="turn-meta">
            <span>logs: ${escapeHtml(runtime.paths?.logsDir || "")}</span>
            <span>exports: ${escapeHtml(runtime.paths?.exportsDir || "")}</span>
            <span>config: ${escapeHtml(runtime.paths?.configDir || "")}</span>
          </div>
        </section>
      </div>
    </article>
    <article class="report-card">
      <p class="card-kicker">Usage</p>
      <div class="metric-grid compact">
        ${metricItems.map(([label, count]) => `
          <div class="metric-tile">
            <span class="metric-label">${escapeHtml(label)}</span>
            <strong>${escapeHtml(count ?? 0)}</strong>
          </div>
        `).join("")}
      </div>
    </article>
    <article class="report-card">
      <p class="card-kicker">Cleanup</p>
      <div class="desktop-cleanup-grid">
        ${cleanupTargets.map((target) => `
          <button
            type="button"
            class="${target.target === "config" ? "ghost-danger-button" : "secondary-button"}"
            data-desktop-cleanup-target="${escapeHtml(target.target)}"
            ${state.desktopActionTarget === target.target ? "disabled" : ""}
          >
            ${escapeHtml(state.desktopActionTarget === target.target ? `正在清理${target.label}` : `清理${target.label}`)}
          </button>
        `).join("")}
      </div>
      <div class="graph-detail-sections">
        ${cleanupTargets.map((target) => `
          <section class="graph-detail-section">
            <div class="turn-meta">
              <span>${escapeHtml(target.label)}</span>
              <span>${escapeHtml(target.path)}</span>
            </div>
            <p class="summary-copy">${escapeHtml(target.description)}</p>
          </section>
        `).join("")}
      </div>
    </article>
    <article class="report-card desktop-danger-card">
      <p class="card-kicker">Danger Zone</p>
      <div class="turn-header">
        <div>
          <h3 class="card-title">删除全部本地数据</h3>
          <p class="summary-copy">
            该操作不会在线直接删除数据库目录，而是写入重置标记，并在下次启动时执行完整清理。
          </p>
        </div>
        <div class="summary-badges">
          ${fullReset?.pending ? renderPill("等待重启生效", "accent") : renderPill("危险操作")}
        </div>
      </div>
      <div class="graph-detail-sections">
        <section class="graph-detail-section">
          <p class="detail-label">将被清理的数据</p>
          <div class="markdown-block subtle">
            ${renderMarkdown("- PostgreSQL 本地数据\n- 题库与复习资产\n- 日志、导出、缓存与本地配置")}
          </div>
        </section>
        <section class="graph-detail-section">
          <p class="detail-label">当前状态</p>
          <div class="turn-meta">
            <span>${escapeHtml(fullReset?.pending ? "已写入重置标记" : "未计划重置")}</span>
            <span>${escapeHtml(fullReset?.markerPath || "")}</span>
          </div>
        </section>
      </div>
      <div class="desktop-danger-actions">
        <button
          type="button"
          class="ghost-danger-button"
          data-desktop-full-reset="true"
          ${(state.desktopActionTarget === "full-reset" || fullReset?.pending) ? "disabled" : ""}
        >
          ${escapeHtml(
            fullReset?.pending
              ? "已计划删除，等待重启"
              : (state.desktopActionTarget === "full-reset" ? "正在计划删除" : "删除全部本地数据")
          )}
        </button>
      </div>
    </article>
  `;
}

export function syncAnswerControls() {
  const canAnswer = state.session?.status === "active";
  elements.answerInput.disabled = !canAnswer;
  elements.answerButton.disabled = !canAnswer || !elements.answerInput.value.trim();
}

function stopRunClock() {
  if (state.runClock) {
    clearInterval(state.runClock);
    state.runClock = null;
  }
}

// 运行时钟只在当前轮处理中存在，
// 这样图谱可以实时显示阶段耗时，而不需要重新拉取 session。
function ensureRunClock() {
  if (state.session?.currentRun?.status !== "running") {
    stopRunClock();
    return;
  }

  if (state.runClock) {
    return;
  }

  state.runClock = setInterval(() => {
    renderRunState();
  }, 1000);
}

export function renderSession() {
  updateShellSummary();

  if (!state.session) {
    elements.sessionTitle.textContent = "尚未开始";
    elements.sessionSubtitle.textContent = "先选择模板或创建一个新的面试模板，再启动面试。";
    elements.stageChip.textContent = "Idle";
    elements.turnCounter.textContent = "0 / 0";
    renderPlan();
    renderConversation();
    renderRunState();
    renderReport();
    renderBackgroundJobs();
    renderObservabilityPanel();
    renderDesktopRuntimePanel();
    syncAnswerControls();
    stopRunClock();
    return;
  }

  const stage = state.session.plan?.stages?.[state.session.stageIndex];
  const template = state.session.interviewTemplate;
  const thread = findCurrentThread(state.session);
  const activePhase = (state.session.currentRun?.phaseStatus || [])
    .find((phase) => phase.name === state.session.currentRun?.phase) || null;

  elements.sessionTitle.textContent = template
    ? `${template.companyName} 路 ${template.jobDirection}`
    : `${state.session.role.name} 路 ${state.session.job.title}`;

  elements.sessionSubtitle.textContent = template
    ? `${template.interviewerRoleName} 路 ${state.session.plan?.summary || "暂无计划摘要"}${state.session.enableWebSearch ? " 路 已启用联网搜索" : ""}`
    : `${state.session.plan?.summary || "暂无计划摘要"}${state.session.enableWebSearch ? " 路 已启用联网搜索" : ""}`;

  elements.stageChip.textContent = activePhase
    ? `${activePhase.name} 路 ${formatDuration(getLivePhaseDuration(activePhase, new Date()))}`
    : (stage?.title || sessionStatusLabel(state.session.status));
  elements.turnCounter.textContent = `${state.session.turns.length} / ${state.session.plan?.targetTurnCount || 0}`;
  elements.runStatus.textContent = `${sessionStatusLabel(state.session.status)}${thread ? ` 路 ${thread.label}` : ""}`;

  renderPlan();
  renderConversation();
  renderRunState();
  renderReport();
  renderBackgroundJobs();
  renderObservabilityPanel();
  renderDesktopRuntimePanel();
  syncAnswerControls();
  ensureRunClock();
  updateShellSummary();
}
