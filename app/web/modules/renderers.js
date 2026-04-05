import { renderRunState } from "./graph.js";
import { elements } from "./dom.js";
import {
  buildSessionModeLabel,
  findCurrentThread,
  renderAssessmentDetails,
  sessionStatusLabel,
  topicLabel
} from "./presenters.js";
import { state } from "./state.js";
import { createBlankTemplate, fillTemplateForm, renderTemplatePicker, sortTemplates } from "./templates.js";
import {
  escapeHtml,
  formatDuration,
  getLivePhaseDuration,
  renderMarkdown,
  renderPill
} from "./utils.js";

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
  updateShellSummary();
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
            <h3 class="card-title">${escapeHtml(thread?.label || topicLabel(state.session.nextQuestion.topicCategory))}</h3>
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
    ? `${template.companyName} · ${template.jobDirection}`
    : `${state.session.role.name} · ${state.session.job.title}`;

  elements.sessionSubtitle.textContent = template
    ? `${template.interviewerRoleName} · ${state.session.plan?.summary || "暂无计划摘要"}${state.session.enableWebSearch ? " · 已启用联网搜索" : ""}`
    : `${state.session.plan?.summary || "暂无计划摘要"}${state.session.enableWebSearch ? " · 已启用联网搜索" : ""}`;

  elements.stageChip.textContent = activePhase
    ? `${activePhase.name} · ${formatDuration(getLivePhaseDuration(activePhase, new Date()))}`
    : (stage?.title || sessionStatusLabel(state.session.status));
  elements.turnCounter.textContent = `${state.session.turns.length} / ${state.session.plan?.targetTurnCount || 0}`;
  elements.runStatus.textContent = `${sessionStatusLabel(state.session.status)}${thread ? ` · ${thread.label}` : ""}`;

  renderPlan();
  renderConversation();
  renderRunState();
  renderReport();
  syncAnswerControls();
  ensureRunClock();
  updateShellSummary();
}
