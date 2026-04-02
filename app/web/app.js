import { Network } from "/vendor/vis-network.min.js";

const state = {
  bootstrap: null,
  session: null,
  eventSource: null,
  streamSessionId: null,
  runClock: null,
  graphNetwork: null,
  graphShellReady: false,
  selectedGraphNodeId: "",
  currentTemplateId: "",
  loadedTemplateSnapshot: ""
};

const elements = {
  providerBadge: document.querySelector("#provider-badge"),
  candidateName: document.querySelector("#candidate-name"),
  candidateRole: document.querySelector("#candidate-role"),
  candidateSummary: document.querySelector("#candidate-summary"),
  templateStatus: document.querySelector("#template-status"),
  templateSelect: document.querySelector("#template-select"),
  templateMeta: document.querySelector("#template-meta"),
  loadTemplateButton: document.querySelector("#load-template-button"),
  newTemplateButton: document.querySelector("#new-template-button"),
  copyTemplateButton: document.querySelector("#copy-template-button"),
  deleteTemplateButton: document.querySelector("#delete-template-button"),
  templateNameInput: document.querySelector("#template-name-input"),
  companyNameInput: document.querySelector("#company-name-input"),
  companyIntroInput: document.querySelector("#company-intro-input"),
  jobDirectionInput: document.querySelector("#job-direction-input"),
  jobDescriptionInput: document.querySelector("#job-description-input"),
  additionalContextInput: document.querySelector("#additional-context-input"),
  interviewerRoleNameInput: document.querySelector("#interviewer-role-name-input"),
  roleSelect: document.querySelector("#role-select"),
  jobSelect: document.querySelector("#job-select"),
  webSearchInput: document.querySelector("#web-search-input"),
  saveTemplateButton: document.querySelector("#save-template-button"),
  startButton: document.querySelector("#start-button"),
  topicGrid: document.querySelector("#topic-grid"),
  sessionTitle: document.querySelector("#session-title"),
  sessionSubtitle: document.querySelector("#session-subtitle"),
  stageChip: document.querySelector("#stage-chip"),
  runStatus: document.querySelector("#run-status"),
  runGraph: document.querySelector("#run-graph"),
  graphDetail: document.querySelector("#graph-detail"),
  turnCounter: document.querySelector("#turn-counter"),
  planList: document.querySelector("#plan-list"),
  conversation: document.querySelector("#conversation"),
  answerInput: document.querySelector("#answer-input"),
  answerButton: document.querySelector("#answer-button"),
  reportPanel: document.querySelector("#report-panel")
};

const RUN_DEBUG_KEYS = ["observe", "deliberation", "decision", "execution", "feedback"];

const PHASE_META = {
  observe: { label: "观察", description: "读取候选人、当前上下文与上一轮结果。" },
  deliberate: { label: "思考", description: "判断当前轮次的策略、深挖方向与搜索价值。" },
  decide: { label: "决策", description: "确定追问、切题、收尾或结束面试。" },
  execute: { label: "执行", description: "生成问题、报告或调用外部能力。" },
  feedback: { label: "反馈", description: "回写状态、更新线程并等待下一步输入。" }
};

const RUN_DEBUG_LABELS = {
  observe: "观察层",
  deliberation: "思考层",
  decision: "决策层",
  execution: "执行层",
  feedback: "反馈层"
};

const TOPIC_LABELS = {
  language_fundamentals: "语言基础",
  game_algorithms: "游戏算法",
  game_framework: "游戏框架",
  system_design: "系统设计",
  ai_agent_design: "AI Agent 设计"
};

const SESSION_STATUS_LABELS = {
  idle: "空闲",
  processing: "处理中",
  active: "进行中",
  completed: "已完成",
  failed: "失败"
};

const THREAD_STATUS_LABELS = {
  active: "进行中",
  closed: "已关闭"
};

function request(url, options = {}) {
  return fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message || "请求失败");
    }
    return payload;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function classToken(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
}

function formatDuration(durationMs) {
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

function diffDurationMs(startedAt, endedAt = new Date()) {
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

function getLiveRunDuration(run, now = new Date()) {
  if (!run) {
    return null;
  }
  if (run.status === "running") {
    return diffDurationMs(run.startedAt, now) ?? run.durationMs ?? null;
  }
  return run.durationMs ?? diffDurationMs(run.startedAt, run.completedAt) ?? null;
}

function getLivePhaseDuration(phase, now = new Date()) {
  if (!phase) {
    return null;
  }
  if (phase.status === "running") {
    return diffDurationMs(phase.startedAt, now) ?? phase.durationMs ?? null;
  }
  return phase.durationMs ?? diffDurationMs(phase.startedAt, phase.endedAt) ?? null;
}

function formatDateTime(value) {
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

function formatList(items, fallback = "暂无") {
  return Array.isArray(items) && items.length
    ? items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")
    : `<li class="muted">${escapeHtml(fallback)}</li>`;
}

function formatJsonPreview(value) {
  return `<pre class="json-preview">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function normalizeMultilineText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function renderInlineMarkdown(value) {
  const escaped = escapeHtml(String(value ?? ""));
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

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

function renderMarkdown(value, { empty = "暂无内容" } = {}) {
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

function renderPill(text, tone = "") {
  const toneClass = tone ? ` ${escapeHtml(tone)}` : "";
  return `<span class="inline-pill${toneClass}">${escapeHtml(text)}</span>`;
}

function sortTemplates(templates) {
  return [...templates].sort((left, right) => {
    const leftRecent = left.recentUsedAt || "";
    const rightRecent = right.recentUsedAt || "";
    if (leftRecent !== rightRecent) {
      return rightRecent.localeCompare(leftRecent);
    }
    return (right.updatedAt || "").localeCompare(left.updatedAt || "");
  });
}

function getDefaultRole() {
  return state.bootstrap?.roles?.[0] || null;
}

function getDefaultJob() {
  return state.bootstrap?.jobs?.[0] || null;
}

function createBlankTemplate() {
  const defaultRole = getDefaultRole();
  const defaultJob = getDefaultJob();
  return {
    id: "",
    name: "",
    companyName: "",
    companyIntro: "",
    jobDirection: "",
    jobDescription: "",
    additionalContext: "",
    interviewerRoleName: defaultRole?.name || "",
    roleId: defaultRole?.id || "",
    jobId: defaultJob?.id || "",
    createdAt: "",
    updatedAt: "",
    recentUsedAt: ""
  };
}

function deriveTemplateName(template) {
  const pieces = [template.companyName, template.jobDirection, template.interviewerRoleName]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return pieces.join(" · ") || "未命名模板";
}

function buildTemplateDraft() {
  return {
    id: state.currentTemplateId || "",
    name: elements.templateNameInput.value.trim(),
    companyName: elements.companyNameInput.value.trim(),
    companyIntro: elements.companyIntroInput.value.trim(),
    jobDirection: elements.jobDirectionInput.value.trim(),
    jobDescription: elements.jobDescriptionInput.value.trim(),
    additionalContext: elements.additionalContextInput.value.trim(),
    interviewerRoleName: elements.interviewerRoleNameInput.value.trim(),
    roleId: elements.roleSelect.value,
    jobId: elements.jobSelect.value
  };
}

function buildPersistedTemplatePayload({ forceCopy = false } = {}) {
  const draft = buildTemplateDraft();
  return {
    ...draft,
    id: forceCopy ? "" : draft.id,
    name: draft.name || deriveTemplateName(draft)
  };
}

function serializeTemplateDraft(template) {
  return JSON.stringify({
    name: template.name || "",
    companyName: template.companyName || "",
    companyIntro: template.companyIntro || "",
    jobDirection: template.jobDirection || "",
    jobDescription: template.jobDescription || "",
    additionalContext: template.additionalContext || "",
    interviewerRoleName: template.interviewerRoleName || "",
    roleId: template.roleId || "",
    jobId: template.jobId || ""
  });
}

function isCurrentTemplateSaved() {
  if (!state.currentTemplateId || !state.loadedTemplateSnapshot) {
    return false;
  }
  return serializeTemplateDraft(buildTemplateDraft()) === state.loadedTemplateSnapshot;
}

function findTemplateById(templateId) {
  return state.bootstrap?.templates?.find((template) => template.id === templateId) || null;
}

function upsertTemplate(template) {
  const templates = state.bootstrap.templates || [];
  const index = templates.findIndex((item) => item.id === template.id);
  if (index >= 0) {
    templates.splice(index, 1, template);
  } else {
    templates.push(template);
  }
  state.bootstrap.templates = sortTemplates(templates);
}

function removeTemplate(templateId) {
  state.bootstrap.templates = (state.bootstrap.templates || []).filter((item) => item.id !== templateId);
}

function renderTemplateStatus() {
  const saved = isCurrentTemplateSaved();
  elements.templateStatus.textContent = saved ? "已保存" : "未保存";
  elements.templateStatus.className = `status-badge ${saved ? "saved" : "neutral"}`;
}

function renderCurrentTemplateMeta() {
  const draft = buildTemplateDraft();
  const savedTemplate = state.currentTemplateId ? findTemplateById(state.currentTemplateId) : null;
  const hasContent = Boolean(
    draft.name || draft.companyName || draft.jobDirection || draft.jobDescription || draft.interviewerRoleName
  );
  elements.deleteTemplateButton.disabled = !state.currentTemplateId;
  elements.copyTemplateButton.disabled = !hasContent;
  if (!savedTemplate) {
    elements.templateMeta.className = "template-meta empty-state";
    elements.templateMeta.textContent = hasContent
      ? "当前内容尚未保存为模板。保存后会进入模板库，并记录最近使用时间。"
      : "选择模板后，这里会显示最近使用与最后更新时间。";
    return;
  }
  elements.templateMeta.className = "template-meta";
  elements.templateMeta.innerHTML = `
    <div class="template-meta-title">${escapeHtml(savedTemplate.name)}</div>
    <div class="muted">最近使用：${escapeHtml(formatDateTime(savedTemplate.recentUsedAt))}</div>
    <div class="muted">最后更新：${escapeHtml(formatDateTime(savedTemplate.updatedAt))}</div>
  `;
}

function updateTemplateChrome() {
  renderTemplateStatus();
  renderCurrentTemplateMeta();
}

function fillTemplateForm(template) {
  const nextTemplate = template || createBlankTemplate();
  state.currentTemplateId = nextTemplate.id || "";
  elements.templateNameInput.value = nextTemplate.name || "";
  elements.companyNameInput.value = nextTemplate.companyName || "";
  elements.companyIntroInput.value = nextTemplate.companyIntro || "";
  elements.jobDirectionInput.value = nextTemplate.jobDirection || "";
  elements.jobDescriptionInput.value = nextTemplate.jobDescription || "";
  elements.additionalContextInput.value = nextTemplate.additionalContext || "";
  elements.interviewerRoleNameInput.value = nextTemplate.interviewerRoleName || "";
  elements.roleSelect.value = nextTemplate.roleId || getDefaultRole()?.id || "";
  elements.jobSelect.value = nextTemplate.jobId || getDefaultJob()?.id || "";
  elements.templateSelect.value = nextTemplate.id || "";
  state.loadedTemplateSnapshot = nextTemplate.id ? serializeTemplateDraft(nextTemplate) : "";
  updateTemplateChrome();
}

function renderTemplatePicker() {
  const templates = sortTemplates(state.bootstrap.templates || []);
  elements.templateSelect.innerHTML = [
    '<option value="">当前编辑内容（未绑定模板）</option>',
    ...templates.map((template) => {
      const isRecent = Boolean(template.recentUsedAt);
      const label = `${isRecent ? "最近 · " : ""}${template.name}`;
      return `<option value="${escapeHtml(template.id)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
  elements.templateSelect.value = state.currentTemplateId || "";
  renderCurrentTemplateMeta();
}

function renderBootstrap() {
  const { candidate, roles, jobs, provider } = state.bootstrap;
  elements.providerBadge.textContent = provider.configured
    ? `Provider · ${provider.mode}`
    : "Provider · fallback only";
  elements.candidateName.textContent = candidate.profile.name || "未命名候选人";
  elements.candidateRole.textContent = candidate.profile.role || "暂无岗位信息";
  elements.candidateSummary.innerHTML = (candidate.summaryPoints || [])
    .slice(0, 4)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  elements.roleSelect.innerHTML = roles
    .map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`)
    .join("");
  elements.jobSelect.innerHTML = jobs
    .map((job) => `<option value="${escapeHtml(job.id)}">${escapeHtml(job.title)}</option>`)
    .join("");
  elements.topicGrid.innerHTML = (candidate.topTopics || [])
    .map((topic) => `<span class="topic-tag">${escapeHtml(topic.label)}</span>`)
    .join("");
  state.bootstrap.templates = sortTemplates(state.bootstrap.templates || []);
  renderTemplatePicker();
  fillTemplateForm(state.bootstrap.templates[0] || createBlankTemplate());
}
function topicLabel(category) {
  return TOPIC_LABELS[category] || category || "未分类";
}

function sessionStatusLabel(status) {
  return SESSION_STATUS_LABELS[status] || status || "未知";
}

function threadStatusLabel(status) {
  return THREAD_STATUS_LABELS[status] || status || "未知";
}

function findCurrentThread(session) {
  if (!session) {
    return null;
  }
  return session.topicThreads?.find((thread) => thread.id === session.currentThreadId)
    || session.topicThreads?.find((thread) => thread.status === "active")
    || session.topicThreads?.at(-1)
    || null;
}

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
      const avgScore = bucket.averageScore ? `均分 ${bucket.averageScore}` : "未评分";

      return `
        <details class="fold-card plan-card ${isCurrent ? "is-current" : ""}" ${isCurrent ? "open" : ""}>
          <summary>
            <div class="fold-summary-main">
              <p class="card-kicker">${escapeHtml(topicLabel(stage.category))}</p>
              <h3 class="card-title">出题意图</h3>
              <p class="summary-copy">展开查看证据来源与提问理由。</p>
            </div>
            <div class="summary-badges">
              ${renderPill(`${bucket.asked || 0} / ${bucket.planned || 0} 题`, isCurrent ? "accent" : "")}
              ${renderPill(avgScore)}
            </div>
          </summary>
          <div class="fold-body">
            <p class="detail-label">目标主题</p>
            <div class="chip-wrap">
              ${topics.length ? topics.map((topic) => `<span class="topic-tag compact">${escapeHtml(topic)}</span>`).join("") : '<span class="muted">等待问题生成</span>'}
            </div>
          </div>
        </details>
      `;
    })
    .join("");
}

function renderAssessmentDetails(assessment) {
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
            <h3 class="card-title">${escapeHtml(thread?.label || topicLabel(turn.question.topicCategory))}</h3>
          </div>
          <div class="summary-badges">
            ${renderPill(topicLabel(turn.question.topicCategory))}
            ${renderPill(assessmentLabel, turn.processing ? "accent" : "")}
          </div>
        </header>

        <section class="turn-block">
          <p class="detail-label">面试官提问</p>
          <div class="markdown-block">${renderMarkdown(turn.question.text)}</div>
        </section>

        <section class="turn-block">
          <p class="detail-label">候选人回答</p>
          <div class="markdown-block answer">${renderMarkdown(turn.answer, { empty: "暂无回答" })}</div>
        </section>

        <details class="fold-card embedded-card" ${turn.processing ? "open" : ""}>
          <summary>
            <div class="fold-summary-main">
              <p class="card-kicker">Assessment</p>
              <h3 class="card-title">出题意图</h3>
              <p class="summary-copy">展开查看证据来源与提问理由。</p>
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
            <h3 class="card-title">${escapeHtml(thread?.label || topicLabel(state.session.nextQuestion.topicCategory))}</h3>
          </div>
          <div class="summary-badges">
            ${renderPill(state.session.nextQuestion._providerMeta?.strategyLabel || "question")}
            ${renderPill(state.session.nextQuestion.evidenceSource || "无证据来源")}
          </div>
        </header>

        <section class="turn-block">
          <p class="detail-label">当前提问</p>
          <div class="markdown-block">${renderMarkdown(state.session.nextQuestion.text)}</div>
        </section>

        <details class="fold-card embedded-card">
          <summary>
            <div class="fold-summary-main">
              <p class="card-kicker">Question Intent</p>
              <h3 class="card-title">出题意图</h3>
              <p class="summary-copy">展开查看证据来源与提问理由。</p>
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

function toDebugKey(phaseName) {
  if (phaseName === "deliberate") {
    return "deliberation";
  }
  return phaseName;
}

function truncateText(value, maxLength = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "暂无说明";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function destroyGraphNetwork() {
  if (state.graphNetwork) {
    state.graphNetwork.destroy();
    state.graphNetwork = null;
  }
  state.graphShellReady = false;
}

function buildPhaseDetail(phase, run) {
  const meta = PHASE_META[phase.name] || {};
  const debug = run.debug?.[toDebugKey(phase.name)] || null;
  const sections = [
    {
      title: "阶段说明",
      content: `<div class="markdown-block subtle">${renderMarkdown(meta.description, { empty: "暂无说明" })}</div>`
    },
    {
      title: "阶段摘要",
      content: `<div class="markdown-block">${renderMarkdown(phase.summary, { empty: "当前阶段暂无摘要" })}</div>`
    }
  ];

  if (debug?.summary) {
    sections.push({
      title: "AI 当前思路",
      content: `<div class="markdown-block">${renderMarkdown(debug.summary)}</div>`
    });
  }

  if (debug?.question?.text) {
    sections.push({
      title: "问题草案",
      content: `<div class="markdown-block">${renderMarkdown(debug.question.text)}</div>`
    });
  }

  if (debug?.preliminaryAssessment) {
    sections.push({
      title: "预评估",
      content: renderAssessmentDetails(debug.preliminaryAssessment)
    });
  }

  return {
    id: `phase:${phase.name}`,
    kicker: "State Node",
    title: meta.label || phase.name,
    subtitle: phase.status,
    summary: phase.summary || meta.description || "当前阶段暂无摘要。",
    badges: [
      phase.status,
      formatDuration(getLivePhaseDuration(phase, new Date())),
      (phase.strategyLabels || []).at(-1) || "no-model"
    ],
    metrics: [
      { label: "开始时间", value: formatDateTime(phase.startedAt) },
      { label: "结束时间", value: formatDateTime(phase.endedAt) },
      { label: "模型策略", value: (phase.strategyLabels || []).join(" · ") || "当前阶段没有模型调用" },
      { label: "阶段名称", value: phase.name }
    ],
    sections,
    raw: debug || phase
  };
}

function buildThreadDetail(thread) {
  const closure = thread.closureReason || (thread.status === "active" ? "进行中" : "已关闭");
  return {
    id: `thread:${thread.id}`,
    kicker: "Thread Node",
    title: thread.label || topicLabel(thread.category),
    subtitle: threadStatusLabel(thread.status),
    summary: closure,
    badges: [
      topicLabel(thread.category),
      `Q ${thread.questionCount}`,
      `F ${thread.followupCount}`,
      `S ${thread.searchCount}`
    ],
    metrics: [
      { label: "状态", value: threadStatusLabel(thread.status) },
      { label: "打开时间", value: formatDateTime(thread.openedAt) },
      { label: "关闭时间", value: formatDateTime(thread.closedAt) },
      { label: "证据源", value: thread.lastEvidenceSource || "暂无" }
    ],
    sections: [
      {
        title: "线程概述",
        content: `<div class="markdown-block subtle">${renderMarkdown(closure)}</div>`
      },
      {
        title: "最近问题",
        content: `<div class="markdown-block">${renderMarkdown(thread.lastQuestionText, { empty: "暂无问题记录" })}</div>`
      }
    ],
    raw: thread
  };
}

function buildQuestionDetail(question) {
  return {
    id: "question:current",
    kicker: "Question Node",
    title: "当前问题",
    subtitle: topicLabel(question.topicCategory),
    summary: truncateText(question.text, 120),
    badges: [
      question._providerMeta?.strategyLabel || "question",
      question.evidenceSource || "无证据来源"
    ],
    metrics: [
      { label: "主题", value: topicLabel(question.topicCategory) },
      { label: "证据源", value: question.evidenceSource || "暂无" },
      { label: "线程 ID", value: question.threadId || "暂无" }
    ],
    sections: [
      {
        title: "问题内容",
        content: `<div class="markdown-block">${renderMarkdown(question.text)}</div>`
      },
      {
        title: "出题意图",
        content: `<div class="markdown-block subtle">${renderMarkdown(question.rationale, { empty: "暂无" })}</div>`
      }
    ],
    raw: question
  };
}

function buildGraphSpec(session) {
  const run = session.currentRun;
  const now = new Date();
  const details = new Map();
  const nodes = [];
  const edges = [];
  const orderedPhases = run.phaseStatus || [];
  const total = orderedPhases.length || 1;
  const phaseX = new Map();

  orderedPhases.forEach((phase, index) => {
    const meta = PHASE_META[phase.name] || {};
    const nodeId = `phase:${phase.name}`;
    const x = (index - (total - 1) / 2) * 320;
    phaseX.set(phase.name, x);

    nodes.push({
      id: nodeId,
      x,
      y: 0,
      physics: false,
      label: `${meta.label || phase.name}\n${phase.status}\n${formatDuration(getLivePhaseDuration(phase, now))}`,
      color: {
        background: phase.status === "running"
          ? "#e5f1ef"
          : phase.status === "completed"
            ? "#edf5ef"
            : phase.status === "failed"
              ? "#f7eceb"
              : "#f7f4ef",
        border: phase.status === "running"
          ? "#0f5b62"
          : phase.status === "completed"
            ? "#2b6a50"
            : phase.status === "failed"
              ? "#912f2f"
              : "#d8d1c6",
        highlight: {
          background: "#f4efe6",
          border: "#0f5b62"
        }
      },
      borderWidth: run.phase === phase.name && run.status === "running" ? 3 : 1.6
    });
    details.set(nodeId, buildPhaseDetail(phase, run));

    if (index > 0) {
      edges.push({
        id: `edge:phase:${orderedPhases[index - 1].name}->${phase.name}`,
        from: `phase:${orderedPhases[index - 1].name}`,
        to: nodeId,
        arrows: "to",
        smooth: false,
        width: 2,
        color: { color: "#8aaeb2", highlight: "#0f5b62" }
      });
    }
  });

  const currentThread = findCurrentThread(session);
  if (currentThread) {
    const threadId = `thread:${currentThread.id}`;
    const executeX = phaseX.get("execute") ?? phaseX.get(run.phase) ?? 0;
    const feedbackX = phaseX.get("feedback") ?? executeX + 320;
    const threadX = Math.round((executeX + feedbackX) / 2);

    nodes.push({
      id: threadId,
      x: threadX,
      y: 220,
      physics: false,
      label: `当前线程\n${truncateText(currentThread.label || topicLabel(currentThread.category), 22)}\n追问 ${currentThread.followupCount} · 搜索 ${currentThread.searchCount}`,
      color: {
        background: currentThread.status === "active" ? "#e8f1f1" : "#f3f0ea",
        border: currentThread.status === "active" ? "#0f5b62" : "#b9afa2",
        highlight: {
          background: "#f4efe6",
          border: "#0f5b62"
        }
      },
      borderWidth: currentThread.status === "active" ? 2.4 : 1.6
    });
    details.set(threadId, buildThreadDetail(currentThread));
    edges.push({
      id: `edge:phase:execute->thread:${currentThread.id}`,
      from: "phase:execute",
      to: threadId,
      arrows: "to",
      smooth: { enabled: true, type: "cubicBezier", roundness: 0.16 },
      width: 2,
      dashes: currentThread.status !== "active",
      color: { color: "#9ca8ab", highlight: "#0f5b62" }
    });

    if (session.nextQuestion) {
      nodes.push({
        id: "question:current",
        x: threadX,
        y: 430,
        physics: false,
        label: `当前问题\n${truncateText(session.nextQuestion.text, 30)}`,
        color: {
          background: "#f0f5f5",
          border: "#6f9da1",
          highlight: {
            background: "#f4efe6",
            border: "#0f5b62"
          }
        },
        borderWidth: 2
      });
      details.set("question:current", buildQuestionDetail(session.nextQuestion));
      edges.push({
        id: `edge:thread:${currentThread.id}->question:current`,
        from: threadId,
        to: "question:current",
        arrows: "to",
        smooth: { enabled: true, type: "cubicBezier", roundness: 0.08 },
        width: 2,
        color: { color: "#b3b0aa", highlight: "#0f5b62" }
      });
      edges.push({
        id: "edge:question:current->phase:feedback",
        from: "question:current",
        to: "phase:feedback",
        arrows: "to",
        smooth: { enabled: true, type: "cubicBezier", roundness: -0.16 },
        width: 2,
        dashes: true,
        color: { color: "#c0b7ab", highlight: "#0f5b62" }
      });
    } else {
      edges.push({
        id: `edge:thread:${currentThread.id}->phase:feedback`,
        from: threadId,
        to: "phase:feedback",
        arrows: "to",
        smooth: { enabled: true, type: "cubicBezier", roundness: -0.12 },
        width: 2,
        dashes: true,
        color: { color: "#c0b7ab", highlight: "#0f5b62" }
      });
    }
  }

  const activeNodeId = details.has(state.selectedGraphNodeId)
    ? state.selectedGraphNodeId
    : (details.has(`phase:${run.phase}`) ? `phase:${run.phase}` : details.keys().next().value || "");

  state.selectedGraphNodeId = activeNodeId;
  return { nodes, edges, details, activeNodeId };
}
function renderGraphDetail(detail) {
  if (!detail) {
    elements.graphDetail.className = "graph-detail empty-state";
    elements.graphDetail.textContent = "选择图中的节点后，这里会显示该节点的详细信息。";
    return;
  }

  elements.graphDetail.className = "graph-detail";
  elements.graphDetail.innerHTML = `
    <article class="graph-detail-card">
      <header class="graph-detail-header">
        <div>
          <p class="card-kicker">${escapeHtml(detail.kicker)}</p>
          <h3 class="card-title">${escapeHtml(detail.title)}</h3>
          <p class="summary-copy">${escapeHtml(detail.summary || detail.subtitle || "暂无摘要")}</p>
        </div>
        <div class="summary-badges">
          ${(detail.badges || []).map((badge) => renderPill(badge)).join("")}
        </div>
      </header>

      <div class="metric-grid compact">
        ${(detail.metrics || []).map((item) => `
          <div class="metric-tile">
            <span class="metric-label">${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join("")}
      </div>

      <div class="graph-detail-sections">
        ${(detail.sections || []).map((section) => `
          <section class="graph-detail-section">
            <p class="detail-label">${escapeHtml(section.title)}</p>
            ${section.content}
          </section>
        `).join("")}
      </div>

      <details class="raw-json">
        <summary>查看结构化原始数据</summary>
        ${formatJsonPreview(detail.raw)}
      </details>
    </article>
  `;
}

function ensureRunGraphShell() {
  if (state.graphShellReady && elements.runGraph.querySelector("#graph-network")) {
    return;
  }

  elements.runGraph.className = "run-graph";
  elements.runGraph.innerHTML = `
    <div class="run-overview">
      <div class="metric-tile accent">
        <span class="metric-label">当前阶段</span>
        <strong id="run-phase-label">--</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">当前回合</span>
        <strong id="run-kind-label">--</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">阶段耗时</span>
        <strong id="run-phase-duration">--</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">模型策略</span>
        <strong id="run-strategy-label">--</strong>
      </div>
    </div>
    <div class="graph-surface">
      <div id="graph-network" class="graph-network"></div>
    </div>
  `;
  state.graphShellReady = true;
}

function syncGraphView(spec) {
  if (!state.graphNetwork) {
    initializeGraphView(spec);
    return;
  }

  const nodesData = state.graphNetwork.body.data.nodes;
  const edgesData = state.graphNetwork.body.data.edges;
  const currentPositions = state.graphNetwork.getPositions();

  const nextNodes = spec.nodes.map((node) => {
    const current = currentPositions[node.id];
    return current ? { ...node, x: current.x, y: current.y } : node;
  });

  const nextNodeIds = new Set(nextNodes.map((node) => node.id));
  const currentNodeIds = nodesData.getIds();
  const removedNodeIds = currentNodeIds.filter((id) => !nextNodeIds.has(id));
  if (removedNodeIds.length) {
    nodesData.remove(removedNodeIds);
  }
  nodesData.update(nextNodes);

  const nextEdgeIds = new Set(spec.edges.map((edge) => edge.id || `${edge.from}->${edge.to}`));
  const currentEdges = edgesData.get();
  const removedEdgeIds = currentEdges
    .filter((edge) => !nextEdgeIds.has(edge.id || `${edge.from}->${edge.to}`))
    .map((edge) => edge.id);
  if (removedEdgeIds.length) {
    edgesData.remove(removedEdgeIds);
  }

  edgesData.update(spec.edges.map((edge) => ({
    id: edge.id || `${edge.from}->${edge.to}`,
    ...edge
  })));

  if (spec.activeNodeId) {
    state.graphNetwork.selectNodes([spec.activeNodeId]);
  } else {
    state.graphNetwork.unselectAll();
  }
}

function initializeGraphView(spec) {
  const container = document.querySelector("#graph-network");
  if (!container) {
    return;
  }

  destroyGraphNetwork();
  state.graphNetwork = new Network(container, {
    nodes: spec.nodes,
    edges: spec.edges
  }, {
    autoResize: true,
    layout: {
      improvedLayout: false
    },
    physics: false,
    interaction: {
      dragNodes: true,
      dragView: true,
      zoomView: true,
      hover: true,
      multiselect: false
    },
    nodes: {
      shape: "box",
      borderWidth: 1.5,
      borderRadius: 18,
      margin: {
        top: 14,
        right: 16,
        bottom: 14,
        left: 16
      },
      widthConstraint: {
        minimum: 170,
        maximum: 210
      },
      font: {
        face: "Microsoft YaHei",
        size: 16,
        color: "#1f1b16"
      },
      shadow: {
        enabled: false
      }
    },
    edges: {
      smooth: false,
      selectionWidth: 0,
      hoverWidth: 0,
      arrows: {
        to: {
          enabled: true,
          scaleFactor: 0.72
        }
      }
    }
  });

  state.graphNetwork.once("afterDrawing", () => {
    state.graphNetwork?.fit({
      animation: false,
      minZoomLevel: 0.75,
      maxZoomLevel: 1.05
    });
  });

  state.graphNetwork.on("click", (params) => {
    if (!params.nodes?.length) {
      return;
    }
    state.selectedGraphNodeId = params.nodes[0];
    renderGraphDetail(spec.details.get(state.selectedGraphNodeId));
  });

  if (spec.activeNodeId) {
    state.graphNetwork.selectNodes([spec.activeNodeId]);
  }
  state.graphShellReady = true;
}
function renderRunState() {
  if (!state.session?.currentRun) {
    destroyGraphNetwork();
    elements.runStatus.textContent = "idle";
    elements.runGraph.className = "run-graph empty-state";
    elements.runGraph.textContent = "开始面试后，这里会显示当前回合的状态图。";
    elements.graphDetail.className = "graph-detail empty-state";
    elements.graphDetail.textContent = "选择图中的节点后，这里会显示该节点的详细信息。";
    return;
  }

  const run = state.session.currentRun;
  const currentPhaseMeta = PHASE_META[run.phase] || {};
  const activePhase = (run.phaseStatus || []).find((phase) => phase.name === run.phase) || null;
  const strategyPreview = activePhase?.strategyLabels?.at(-1)
    || state.session.nextQuestion?._providerMeta?.strategyLabel
    || "waiting strategy";
  const spec = buildGraphSpec(state.session);

  elements.runStatus.textContent = `${run.kind} · ${run.status}`;
  ensureRunGraphShell();
  elements.runGraph.querySelector("#run-phase-label").textContent = currentPhaseMeta.label || run.phase || "idle";
  elements.runGraph.querySelector("#run-kind-label").textContent = `${run.kind} · ${run.status}`;
  elements.runGraph.querySelector("#run-phase-duration").textContent = formatDuration(getLivePhaseDuration(activePhase, new Date()));
  elements.runGraph.querySelector("#run-strategy-label").textContent = strategyPreview;

  syncGraphView(spec);
  renderGraphDetail(spec.details.get(spec.activeNodeId));
}
function renderThreadState() {
  // Thread information is now surfaced through the graph inspector detail panel.
}

function renderReport() {
  if (!state.session?.report) {
    elements.reportPanel.className = "empty-state";
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
      <ul class="supporting-list">${formatList(report.strengths, "暂无")}</ul>
    </article>
    <article class="report-card">
      <p class="card-kicker">Risks</p>
      <ul class="supporting-list">${formatList(report.risks, "暂无")}</ul>
    </article>
  `;
}

function syncAnswerControls() {
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

function renderSession() {
  if (!state.session) {
    elements.sessionTitle.textContent = "尚未开始";
    elements.sessionSubtitle.textContent = "先选择模板或创建一个新的面试模板，再启动面试。";
    elements.stageChip.textContent = "Idle";
    elements.turnCounter.textContent = "0 / 0";
    renderPlan();
    renderConversation();
    renderRunState();
    renderReport();
    syncAnswerControls();
    stopRunClock();
    return;
  }

  const stage = state.session.plan?.stages?.[state.session.stageIndex];
  const template = state.session.interviewTemplate;
  const thread = findCurrentThread(state.session);

  elements.sessionTitle.textContent = template
    ? `${template.companyName} · ${template.jobDirection}`
    : `${state.session.role.name} · ${state.session.job.title}`;

  elements.sessionSubtitle.textContent = template
    ? `${template.interviewerRoleName} · ${state.session.plan?.summary || "暂无计划摘要"}${state.session.enableWebSearch ? " · 已启用联网搜索" : ""}`
    : `${state.session.plan?.summary || "暂无计划摘要"}${state.session.enableWebSearch ? " · 已启用联网搜索" : ""}`;

  elements.stageChip.textContent = stage?.title || sessionStatusLabel(state.session.status);
  elements.turnCounter.textContent = `${state.session.turns.length} / ${state.session.plan?.targetTurnCount || 0}`;
  elements.runStatus.textContent = `${sessionStatusLabel(state.session.status)}${thread ? ` · ${thread.label}` : ""}`;

  renderPlan();
  renderConversation();
  renderRunState();
  renderReport();
  syncAnswerControls();
  ensureRunClock();
}

function stopSessionStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
    state.streamSessionId = null;
  }

  stopRunClock();
}

function startSessionStream(sessionId) {
  if (state.eventSource && state.streamSessionId === sessionId) {
    return;
  }

  stopSessionStream();
  const stream = new EventSource(`/api/interviews/${sessionId}/events`);
  stream.addEventListener("session", (event) => {
    state.session = JSON.parse(event.data);
    renderSession();
  });
  stream.onerror = () => {
    if (stream.readyState === EventSource.CLOSED) {
      state.eventSource = null;
      state.streamSessionId = null;
    }
  };

  state.eventSource = stream;
  state.streamSessionId = sessionId;
}

async function saveTemplate() {
  const payload = buildPersistedTemplatePayload();
  elements.saveTemplateButton.disabled = true;

  try {
    const saved = await request("/api/templates", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    upsertTemplate(saved);
    renderTemplatePicker();
    fillTemplateForm(saved);
  } finally {
    elements.saveTemplateButton.disabled = false;
  }
}

async function copyTemplate() {
  const payload = buildPersistedTemplatePayload({ forceCopy: true });
  payload.name = `${payload.name} 副本`;
  elements.copyTemplateButton.disabled = true;

  try {
    const copied = await request("/api/templates", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    upsertTemplate(copied);
    renderTemplatePicker();
    fillTemplateForm(copied);
  } finally {
    elements.copyTemplateButton.disabled = false;
  }
}

async function deleteCurrentTemplate() {
  if (!state.currentTemplateId) {
    return;
  }

  const template = findTemplateById(state.currentTemplateId);
  if (!template) {
    return;
  }

  const confirmed = window.confirm(`确定删除模板“${template.name}”吗？`);
  if (!confirmed) {
    return;
  }

  elements.deleteTemplateButton.disabled = true;
  try {
    await request(`/api/templates/${template.id}`, {
      method: "DELETE"
    });
    removeTemplate(template.id);
    renderTemplatePicker();
    fillTemplateForm(state.bootstrap.templates[0] || createBlankTemplate());
  } finally {
    elements.deleteTemplateButton.disabled = false;
  }
}

async function startInterview() {
  elements.startButton.disabled = true;

  try {
    const payload = {
      enableWebSearch: elements.webSearchInput.checked
    };

    if (isCurrentTemplateSaved()) {
      payload.templateId = state.currentTemplateId;
    } else {
      payload.template = buildPersistedTemplatePayload();
    }

    state.session = await request("/api/interviews", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (state.session.interviewTemplate?.id) {
      upsertTemplate(state.session.interviewTemplate);
      renderTemplatePicker();
      if (isCurrentTemplateSaved()) {
        fillTemplateForm(state.session.interviewTemplate);
      }
    }

    elements.answerInput.value = "";
    renderSession();
    startSessionStream(state.session.id);
  } finally {
    elements.startButton.disabled = false;
  }
}

async function submitAnswer() {
  if (!state.session || !elements.answerInput.value.trim()) {
    return;
  }

  elements.answerButton.disabled = true;
  try {
    state.session = await request(`/api/interviews/${state.session.id}/answer`, {
      method: "POST",
      body: JSON.stringify({
        answer: elements.answerInput.value.trim()
      })
    });
    elements.answerInput.value = "";
    renderSession();
    startSessionStream(state.session.id);
  } finally {
    syncAnswerControls();
  }
}

function loadSelectedTemplate() {
  const template = findTemplateById(elements.templateSelect.value);
  fillTemplateForm(template || createBlankTemplate());
}

function bindTemplateFormDirtyTracking() {
  [
    elements.templateNameInput,
    elements.companyNameInput,
    elements.companyIntroInput,
    elements.jobDirectionInput,
    elements.jobDescriptionInput,
    elements.additionalContextInput,
    elements.interviewerRoleNameInput,
    elements.roleSelect,
    elements.jobSelect
  ].forEach((element) => {
    element.addEventListener("input", updateTemplateChrome);
    element.addEventListener("change", updateTemplateChrome);
  });
}

elements.loadTemplateButton.addEventListener("click", loadSelectedTemplate);
elements.newTemplateButton.addEventListener("click", () => fillTemplateForm(createBlankTemplate()));
elements.copyTemplateButton.addEventListener("click", copyTemplate);
elements.deleteTemplateButton.addEventListener("click", deleteCurrentTemplate);
elements.saveTemplateButton.addEventListener("click", saveTemplate);
elements.startButton.addEventListener("click", startInterview);
elements.answerButton.addEventListener("click", submitAnswer);
elements.answerInput.addEventListener("input", syncAnswerControls);
bindTemplateFormDirtyTracking();

request("/api/bootstrap")
  .then((bootstrap) => {
    state.bootstrap = bootstrap;
    renderBootstrap();
    renderSession();
  })
  .catch((error) => {
    elements.providerBadge.textContent = error.message;
  });






