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
import {
  buildTemplateDraft,
  buildTemplateSectionStatus,
  createBlankTemplate,
  deriveTemplateName,
  fillTemplateForm,
  findTemplateById,
  isCurrentTemplateSaved,
  renderTemplatePicker,
  sortTemplates
} from "./templates.js";
import {  escapeHtml,
  formatDateTime,
  formatDuration,
  getLivePhaseDuration,
  renderLabelWithTooltip,
  renderMarkdown,
  renderPill,
  truncateText
} from "./utils.js";
import { APP_VIEW_META, isNavViewActive } from "./views.js";

const BACKGROUND_JOB_STATUS_LABELS = {
  pending: "排队中",
  running: "执行中",
  failed: "已失败",
  completed: "已完成",
  idle: "未启动"
};

const APP_OVERLAY_META = {
  planning: {
    eyebrow: "Planning",
    title: "计划图谱工作区",
    description: "集中查看图谱、阶段推进和当前提问焦点。"
  },
  review: {
    eyebrow: "Review",
    title: "复盘观察工作区",
    description: "把复盘、任务和运行观测收进独立侧栏。",
    tabs: [
      { id: "report", label: "复盘" },
      { id: "jobs", label: "任务" },
      { id: "observability", label: "观测" }
    ]
  }
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

const SESSION_WORKSPACE_META = {
  realtime: {
    label: "实时对话",
    description: "查看当前问题、历史轮次与答题输入。"
  },
  planning: {
    label: "计划图谱",
    description: "从图谱里看阶段推进和提问策略。"
  },
  review: {
    label: "复盘观察",
    description: "查看复盘、任务与观测结果。"
  }
};

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

  if (elements.navSessionMode) {
    elements.navSessionMode.textContent = buildSessionModeLabel(state.session);
  }

  if (elements.activeThread) {
    const thread = findCurrentThread(state.session);
    elements.activeThread.textContent = thread?.label || "等待线程";
  }

  if (elements.navActiveThread) {
    const thread = findCurrentThread(state.session);
    elements.navActiveThread.textContent = thread?.label || "等待线程";
  }
}

function renderNavigation() {
  for (const button of elements.navButtons || []) {
    const isActive = isNavViewActive(button.dataset.navView, state.currentView);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  }
}

function renderActiveView() {
  for (const section of elements.viewSections || []) {
    const isActive = section.dataset.viewSection === state.currentView;
    section.classList.toggle("is-hidden", !isActive);
  }
}

function renderSessionWorkspaceChrome() {
  const activeWorkspace = state.currentSessionWorkspace || "realtime";

  for (const button of elements.sessionWorkspaceButtons || []) {
    const isActive = button.dataset.sessionWorkspace === activeWorkspace;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  }

  for (const section of elements.sessionWorkspaceSections || []) {
    const isActive = section.dataset.sessionWorkspaceSection === activeWorkspace;
    section.classList.toggle("is-hidden", !isActive);
  }
}

function buildOverlayPanelSnapshot(element, fallbackText) {
  const html = element?.innerHTML?.trim();
  const className = element?.className || "empty-state";
  if (html) {
    return `<div class="${className}">${html}</div>`;
  }

  return `<div class="${className}">${escapeHtml(element?.textContent || fallbackText)}</div>`;
}

function buildOverlaySessionSummary() {
  if (!state.session) {
    return `
      <article class="panel modal-panel overlay-summary-panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Session</p>
            <h3>当前没有活动会话</h3>
          </div>
        </div>
        <div class="panel-body">
          <p class="summary-copy">开始面试后，这里会给出当前阶段、线程和覆盖进度摘要。</p>
        </div>
      </article>
    `;
  }

  const stage = state.session.plan?.stages?.[state.session.stageIndex];
  const thread = findCurrentThread(state.session);
  const backgroundJobs = state.session.backgroundJobs || [];

  return `
    <article class="panel modal-panel overlay-summary-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Session</p>
          <h3>当前会话摘要</h3>
        </div>
      </div>
      <div class="panel-body">
        <div class="metric-grid compact">
          <div class="metric-tile accent">
            <span class="metric-label">状态</span>
            <strong>${escapeHtml(sessionStatusLabel(state.session.status))}</strong>
          </div>
          <div class="metric-tile">
            <span class="metric-label">轮次</span>
            <strong>${escapeHtml(`${state.session.turns.length} / ${state.session.plan?.targetTurnCount || 0}`)}</strong>
          </div>
          <div class="metric-tile">
            <span class="metric-label">阶段</span>
            <strong>${escapeHtml(stage?.title || "待规划")}</strong>
          </div>
          <div class="metric-tile">
            <span class="metric-label">线程</span>
            <strong>${escapeHtml(thread?.label || "等待线程")}</strong>
          </div>
          <div class="metric-tile">
            <span class="metric-label">后台任务</span>
            <strong>${escapeHtml(backgroundJobs.length || 0)}</strong>
          </div>
          <div class="metric-tile">
            <span class="metric-label">报告</span>
            <strong>${escapeHtml(state.session.report ? "已生成" : "待生成")}</strong>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderAppOverlay() {
  if (!elements.overlayRoot || !elements.overlayBody) {
    return;
  }

  const overlayMeta = APP_OVERLAY_META[state.currentOverlay] || null;
  if (!overlayMeta || state.currentView !== "session") {
    elements.overlayRoot.hidden = true;
    elements.overlayRoot.classList.remove("is-open");
    elements.overlayRoot.setAttribute("aria-hidden", "true");
    elements.overlayBody.innerHTML = "";
    elements.overlayTabs.hidden = true;
    elements.overlayTabs.innerHTML = "";
    document.body.classList.remove("is-modal-open");
    return;
  }

  elements.overlayRoot.hidden = false;
  elements.overlayRoot.classList.add("is-open");
  elements.overlayRoot.setAttribute("aria-hidden", "false");
  elements.overlayEyebrow.textContent = overlayMeta.eyebrow;
  elements.overlayTitle.textContent = overlayMeta.title;
  elements.overlayDescription.textContent = overlayMeta.description;
  document.body.classList.add("is-modal-open");

  if (overlayMeta.tabs?.length) {
    const activeTab = overlayMeta.tabs.some((tab) => tab.id === state.currentOverlayTab)
      ? state.currentOverlayTab
      : overlayMeta.tabs[0].id;
    state.currentOverlayTab = activeTab;
    elements.overlayTabs.hidden = false;
    elements.overlayTabs.innerHTML = overlayMeta.tabs.map((tab) => `
      <button
        type="button"
        class="segment-tab ${tab.id === activeTab ? "is-active" : ""}"
        data-overlay-tab="${tab.id}"
      >
        ${escapeHtml(tab.label)}
      </button>
    `).join("");
  } else {
    state.currentOverlayTab = "";
    elements.overlayTabs.hidden = true;
    elements.overlayTabs.innerHTML = "";
  }

  if (state.currentOverlay === "planning") {
    elements.overlayBody.innerHTML = `
      <div class="modal-grid app-overlay-grid planning-overlay-grid">
        <div class="modal-column">
          <article class="panel modal-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Graph</p>
                <h3>计划图谱</h3>
              </div>
            </div>
            <div class="panel-body">
              ${buildOverlayPanelSnapshot(elements.runGraph, "计划图谱加载中...")}
            </div>
          </article>
          <article class="panel modal-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Focus</p>
                <h3>当前节点观察</h3>
              </div>
            </div>
            <div class="panel-body">
              ${buildOverlayPanelSnapshot(elements.graphDetail, "这里会显示当前节点的详细信息。")}
            </div>
          </article>
        </div>
        <article class="panel modal-panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Plan</p>
              <h3>阶段计划详情</h3>
            </div>
          </div>
          <div class="panel-body">
            ${buildOverlayPanelSnapshot(elements.planList, "阶段计划加载中...")}
          </div>
        </article>
      </div>
    `;
    return;
  }

  const reviewTab = state.currentOverlayTab || "report";
  const reviewContentMap = {
    report: {
      title: "结构化复盘",
      content: buildOverlayPanelSnapshot(elements.reportPanel, "完成面试后，这里会显示结构化复盘。")
    },
    jobs: {
      title: "后台任务",
      content: buildOverlayPanelSnapshot(elements.backgroundJobsPanel, "开始面试后，这里会显示后台任务状态。")
    },
    observability: {
      title: "运行观测",
      content: buildOverlayPanelSnapshot(elements.observabilityPanel, "日志聚合视图加载中...")
    }
  };
  const activeReviewContent = reviewContentMap[reviewTab] || reviewContentMap.report;

  elements.overlayBody.innerHTML = `
    <div class="modal-grid app-overlay-grid review-overlay-grid">
      <article class="panel modal-panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Workspace</p>
            <h3>${escapeHtml(activeReviewContent.title)}</h3>
          </div>
        </div>
        <div class="panel-body">
          ${activeReviewContent.content}
        </div>
      </article>
      ${buildOverlaySessionSummary()}
    </div>
  `;
}

function renderViewHeader() {
  if (!elements.viewTitle || !elements.viewDescription || !elements.viewEyebrow) {
    return;
  }

  if (state.currentView === "session") {
    const workspaceMeta = SESSION_WORKSPACE_META[state.currentSessionWorkspace] || SESSION_WORKSPACE_META.realtime;
    elements.viewEyebrow.textContent = "Session";

    if (!state.session) {
      elements.viewTitle.textContent = "会话工作区";
      elements.viewDescription.textContent = workspaceMeta.description;
      return;
    }

    const template = state.session.interviewTemplate;
    elements.viewTitle.textContent = template
      ? (template.name || `${template.companyName || "模板"} / ${template.jobDirection || "面试"}`)
      : `${state.session.role?.name || "面试官"} / ${state.session.job?.title || "当前会话"}`;
    elements.viewDescription.textContent = state.session.plan?.summary
      ? `${workspaceMeta.label} · ${state.session.plan.summary}`
      : workspaceMeta.description;
    return;
  }

  if (state.currentView === "template-editor") {
    const template = state.currentTemplateId ? findTemplateById(state.currentTemplateId) : null;
    const draft = buildTemplateDraft();
    elements.viewEyebrow.textContent = "Template Editor";
    elements.viewTitle.textContent = template?.name || draft.name || deriveTemplateName(draft);
    elements.viewDescription.textContent = template
      ? "在独立模板工作台里维护字段、说明和高级配置。"
      : "当前正在编辑一个未保存模板，保存后会进入模板资产库。";
    return;
  }

  const meta = APP_VIEW_META[state.currentView] || APP_VIEW_META.dashboard;
  elements.viewEyebrow.textContent = meta.eyebrow;
  elements.viewTitle.textContent = meta.title;
  elements.viewDescription.textContent = meta.description;
}

function renderDashboardOverviewPanel() {
  if (!elements.dashboardOverviewPanel || !state.bootstrap) {
    return;
  }

  const candidate = state.bootstrap.candidate || {};
  const provider = state.bootstrap.provider || {};
  const session = state.session;
  const currentTemplate = state.currentTemplateId
    ? findTemplateById(state.currentTemplateId)
    : null;

  elements.dashboardOverviewPanel.className = "panel";
  elements.dashboardOverviewPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="eyebrow">Workspace</p>
        <h2>当前工作区概览</h2>
      </div>
      <div class="summary-badges">
        ${renderPill(candidate.ready ? "简历已就绪" : "待导入简历", candidate.ready ? "accent" : "")}
        ${renderPill(provider.configured ? provider.mode : "provider fallback")}
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric-tile">
        <span class="metric-label">简历状态</span>
        <strong>${escapeHtml(candidate.ready ? "Ready" : "Missing")}</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">模板数量</span>
        <strong>${escapeHtml((state.bootstrap.templates || []).length)}</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">当前会话</span>
        <strong>${escapeHtml(session ? sessionStatusLabel(session.status) : "Idle")}</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">当前模板</span>
        <strong>${escapeHtml(currentTemplate?.name || "未绑定")}</strong>
      </div>
    </div>
    <div class="quick-action-row">
      <button type="button" class="primary-button" data-nav-view="start">开始新面试</button>
      <button type="button" class="secondary-button" data-nav-view="templates">打开模板中心</button>
      <button type="button" class="secondary-button" data-nav-view="settings">查看设置</button>
    </div>
  `;
}

function renderDashboardSessionPanel() {
  if (!elements.dashboardSessionPanel) {
    return;
  }

  const session = state.session;
  if (!session) {
    elements.dashboardSessionPanel.className = "panel";
    elements.dashboardSessionPanel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Recent Session</p>
          <h2>还没有进行中的会话</h2>
        </div>
      </div>
      <p class="summary-copy">补齐简历和模板后，就可以从“开始面试”发起新会话。</p>
      <div class="quick-action-row">
        <button type="button" class="secondary-button" data-nav-view="start">前往开始面试</button>
      </div>
    `;
    return;
  }

  const thread = findCurrentThread(session);
  elements.dashboardSessionPanel.className = "panel";
  elements.dashboardSessionPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="eyebrow">Recent Session</p>
        <h2>${escapeHtml(session.interviewTemplate?.name || session.job?.title || "当前会话")}</h2>
      </div>
      <div class="summary-badges">
        ${renderPill(sessionStatusLabel(session.status), session.status === "active" ? "accent" : "")}
        ${renderPill(`${session.turns?.length || 0} rounds`)}
      </div>
    </div>
    <div class="graph-detail-sections">
      <section class="graph-detail-section">
        <p class="detail-label">${renderLabelWithTooltip("线程", "当前问题落在哪条话题线程里，方便判断追问是否还在同一上下文。")}</p>
        <p class="summary-copy">${escapeHtml(thread?.label || "等待进入新的问题线程")}</p>
      </section>
      <section class="graph-detail-section">
        <p class="detail-label">${renderLabelWithTooltip("计划", "这里显示当前会话的阶段计划摘要，不再把完整说明全部展开到首页。")}</p>
        <p class="summary-copy">${escapeHtml(session.plan?.summary || "当前还没有可展示的计划摘要。")}</p>
      </section>
    </div>
    <div class="quick-action-row">
      <button type="button" class="primary-button" data-nav-view="session">继续当前会话</button>
      <button type="button" class="secondary-button" data-nav-view="start">新建一场面试</button>
    </div>
  `;
}

function renderStartSessionPanel() {
  if (!elements.startSessionPanel || !state.bootstrap) {
    return;
  }

  const candidate = state.bootstrap.candidate || {};
  const currentTemplate = state.currentTemplateId
    ? findTemplateById(state.currentTemplateId)
    : null;
  const draft = buildTemplateDraft();
  const effectiveTemplate = currentTemplate || draft;
  const readiness = buildTemplateSectionStatus(effectiveTemplate);
  const templateName = currentTemplate?.name || draft.name || deriveTemplateName(draft);
  const summaryParts = [
    draft.jobDirection || currentTemplate?.jobDirection,
    draft.interviewerRoleName || currentTemplate?.interviewerRoleName
  ].filter(Boolean);
  const hasSavedTemplate = Boolean(currentTemplate?.id && isCurrentTemplateSaved());
  const hasLaunchReadyTemplate = readiness.completedCount >= Math.max(5, readiness.totalCount - 1);
  const launchDescription = draft.jobDescription || currentTemplate?.jobDescription || "当前模板还没有岗位说明，建议先回到模板编辑页补充。";
  const webSearchEnabled = Boolean(elements.webSearchInput?.checked);
  const preflightItems = [
    {
      title: "简历工作区",
      ready: Boolean(candidate.ready),
      description: candidate.ready ? "简历已导入，可用于生成问题和上下文证据。" : "还没有导入简历，当前不能正式启动面试。"
    },
    {
      title: "模板完成度",
      ready: hasLaunchReadyTemplate,
      description: hasLaunchReadyTemplate
        ? `模板完成度 ${readiness.completedCount}/${readiness.totalCount}，可以进入启动阶段。`
        : `模板完成度 ${readiness.completedCount}/${readiness.totalCount}，建议继续补齐后再启动。`
    },
    {
      title: "模板保存状态",
      ready: hasSavedTemplate,
      description: hasSavedTemplate
        ? "当前使用的是已保存模板，后续会话会绑定这份模板资产。"
        : "当前会话会使用编辑区草稿启动，但仍建议先保存模板。"
    },
    {
      title: "联网开关",
      ready: true,
      description: webSearchEnabled
        ? "已允许 AI 在规划和出题阶段按需联网搜索。"
        : "当前为离线规划模式，只使用本地简历和模板上下文。"
    }
  ];

  elements.startSessionPanel.className = "panel";
  elements.startSessionPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="eyebrow">Launch</p>
        <h2>启动新的面试会话</h2>
      </div>
      <div class="summary-badges">
        ${renderPill(candidate.ready ? "简历已导入" : "请先导入简历", candidate.ready ? "accent" : "")}
        ${renderPill(hasSavedTemplate ? "已保存模板" : "使用当前草稿")}
      </div>
    </div>

    <div class="launch-step-grid">
      <article class="launch-step-card">
        <p class="card-kicker">Step 01</p>
        <h3>确认模板</h3>
        <strong>${escapeHtml(templateName || "未命名模板")}</strong>
        <p>${escapeHtml(summaryParts.join(" / ") || "待补充岗位方向与面试官角色")}</p>
      </article>
      <article class="launch-step-card">
        <p class="card-kicker">Step 02</p>
        <h3>检查完成度</h3>
        <strong>${escapeHtml(`${readiness.completedCount}/${readiness.totalCount}`)}</strong>
        <p>${escapeHtml(hasLaunchReadyTemplate ? "模板内容基本齐全，可以作为正式启动配置。" : "模板还不够完整，建议先回模板页完善。")}</p>
      </article>
      <article class="launch-step-card current">
        <p class="card-kicker">Step 03</p>
        <h3>发起会话</h3>
        <strong>${escapeHtml(candidate.ready ? "预检已具备" : "等待预检通过")}</strong>
        <p>${escapeHtml(webSearchEnabled ? "将以可联网模式启动会话。" : "将以离线模式启动会话。")}</p>
      </article>
    </div>

    <div class="launch-preflight-grid">
      ${preflightItems.map((item) => `
        <article class="launch-preflight-card">
          <p class="card-kicker">${escapeHtml(item.title)}</p>
          <h3>${escapeHtml(item.ready ? "已就绪" : "待补充")}</h3>
          <p>${escapeHtml(item.description)}</p>
        </article>
      `).join("")}
    </div>

    <div class="graph-detail-sections">
      <section class="graph-detail-section">
        <p class="detail-label">${renderLabelWithTooltip("当前说明", "使用当前模板里的岗位说明作为本次启动前的快速预览。")}</p>
        <p class="summary-copy">${escapeHtml(truncateText(launchDescription, 110))}</p>
      </section>
      <section class="graph-detail-section">
        <p class="detail-label">${renderLabelWithTooltip("启动建议", "这一步只负责预检和启动；如果模板还没补齐，建议先回模板页完善。")}</p>
        <p class="summary-copy">${escapeHtml(hasLaunchReadyTemplate ? "预检通过后即可直接启动。" : "建议先补齐模板，再进入正式面试。")}</p>
      </section>
    </div>
  `;
}

function renderSettingsOverviewPanel() {
  if (!elements.settingsOverviewPanel || !state.bootstrap) {
    return;
  }

  const provider = state.bootstrap.provider || {};
  const candidate = state.bootstrap.candidate || {};
  const runtime = state.desktopRuntime || {};
  const settings = state.appSettings || {};
  const ai = settings.ai || {};
  const embedding = settings.embedding || {};

  elements.settingsOverviewPanel.className = "panel";
  elements.settingsOverviewPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="eyebrow">Environment</p>
        <h2>运行环境概览</h2>
      </div>
      <div class="summary-badges">
        ${renderPill(runtime.enabled ? "desktop runtime" : "web runtime")}
        ${renderPill(provider.configured ? provider.mode : "fallback")}
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric-tile">
        <span class="metric-label">主模型</span>
        <strong>${escapeHtml(ai.model || provider.mode || "未配置")}</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">简历工作区</span>
        <strong>${escapeHtml(candidate.ready ? "Ready" : "Missing")}</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">数据目录</span>
        <strong>${escapeHtml(runtime.dataDir || candidate.workspacePath || "Local workspace")}</strong>
      </div>
      <div class="metric-tile">
        <span class="metric-label">Embedding</span>
        <strong>${escapeHtml(embedding.model || "未配置")}</strong>
      </div>
    </div>
    <div class="graph-detail-sections">
      <section class="graph-detail-section">
        <p class="detail-label">${renderLabelWithTooltip("配置文件", "设置保存后会直接写入当前运行环境对应的 .env 文件。")}</p>
        <div class="markdown-code">${escapeHtml(settings.envFilePath || "Loading...")}</div>
      </section>
      <section class="graph-detail-section">
        <p class="detail-label">${renderLabelWithTooltip("当前口径", "主模型链路当前稳定支持 Moonshot；Embedding 使用兼容 OpenAI 接口的配置方式。")}</p>
        <p class="summary-copy">设置页现在可以直接填写并保存 API Key、模型名和接口地址。</p>
      </section>
    </div>
  `;
}

function renderSettingsConfigPanel() {
  if (!elements.settingsConfigPanel) {
    return;
  }

  if (state.appSettingsError) {
    elements.settingsConfigPanel.className = "empty-state";
    elements.settingsConfigPanel.textContent = state.appSettingsError;
    return;
  }

  if (!state.appSettings) {
    elements.settingsConfigPanel.className = "empty-state";
    elements.settingsConfigPanel.textContent = "Loading settings...";
    return;
  }

  const ai = state.appSettings.ai || {};
  const embedding = state.appSettings.embedding || {};
  const runtime = state.appSettings.runtime || {};
  const statusClass = state.appSettingsStatusTone === "saved"
    ? "saved"
    : state.appSettingsStatusTone === "error"
      ? "error"
      : "neutral";
  const statusText = state.appSettingsSaving
    ? "正在保存..."
    : (state.appSettingsStatus || "本地设置");

  elements.settingsConfigPanel.className = "settings-stack";
  elements.settingsConfigPanel.innerHTML = `
    <article class="settings-hero-card">
      <div>
        <p class="eyebrow">Profile</p>
        <h3>把常用配置收进应用内</h3>
        <p class="summary-copy">这里的设置会直接作用于当前本地运行环境，不需要再手动打开 .env 修改。</p>
      </div>
      <div class="summary-badges">
        ${renderPill(runtime.desktopRuntimeMode || "web")}
        ${renderPill(runtime.storageMode || "database_only")}
      </div>
    </article>

    <article class="settings-form-card">
      <div class="settings-card-header">
        <div>
          <p class="eyebrow">Main AI</p>
          <h3>主模型配置</h3>
        </div>
        <span class="status-badge neutral">Moonshot</span>
      </div>
      <div class="settings-form-grid">
        <label class="field">
          <span>${renderLabelWithTooltip("Provider", "当前主推理链路稳定支持 Moonshot，后续如果接更多 provider 再从这里扩展。")}</span>
          <select id="settings-ai-provider">
            ${(ai.providerOptions || [{ id: "moonshot", label: "Moonshot / Kimi" }]).map((option) => `
              <option value="${escapeHtml(option.id)}" ${option.id === ai.provider ? "selected" : ""}>
                ${escapeHtml(option.label)}
              </option>
            `).join("")}
          </select>
        </label>

        <label class="field">
          <span>Thinking</span>
          <select id="settings-ai-thinking">
            <option value="enabled" ${ai.thinking !== "disabled" ? "selected" : ""}>enabled</option>
            <option value="disabled" ${ai.thinking === "disabled" ? "selected" : ""}>disabled</option>
          </select>
        </label>

        <label class="field settings-field-span-2">
          <span>API Key</span>
          <input id="settings-ai-api-key" type="password" value="${escapeHtml(ai.apiKey || "")}" placeholder="输入 Moonshot API Key" spellcheck="false" />
        </label>

        <label class="field">
          <span>Model</span>
          <input id="settings-ai-model" type="text" value="${escapeHtml(ai.model || "")}" placeholder="例如 kimi-k2.5" spellcheck="false" />
        </label>

        <label class="field">
          <span>Base URL</span>
          <input id="settings-ai-base-url" type="text" value="${escapeHtml(ai.baseUrl || "")}" placeholder="https://api.moonshot.cn/v1" spellcheck="false" />
        </label>
      </div>
    </article>

    <article class="settings-form-card">
      <div class="settings-card-header">
        <div>
          <p class="eyebrow">Embedding</p>
          <h3>向量配置</h3>
        </div>
        <span class="status-badge neutral">OpenAI Compatible</span>
      </div>
      <div class="settings-form-grid">
        <label class="field">
          <span>${renderLabelWithTooltip("Provider", "Embedding 当前按兼容 OpenAI 风格接口来配置，适合接百炼这类兼容端点。")}</span>
          <input id="settings-embedding-provider" type="text" value="${escapeHtml(embedding.provider || "")}" placeholder="openai_compatible" spellcheck="false" />
        </label>

        <label class="field">
          <span>Dimensions</span>
          <input id="settings-embedding-dimensions" type="number" min="0" step="1" value="${escapeHtml(embedding.dimensions || "")}" placeholder="留空则使用服务端默认值" />
        </label>

        <label class="field settings-field-span-2">
          <span>API Key</span>
          <input id="settings-embedding-api-key" type="password" value="${escapeHtml(embedding.apiKey || "")}" placeholder="输入 Embedding API Key" spellcheck="false" />
        </label>

        <label class="field">
          <span>Model</span>
          <input id="settings-embedding-model" type="text" value="${escapeHtml(embedding.model || "")}" placeholder="例如 text-embedding-v4" spellcheck="false" />
        </label>

        <label class="field">
          <span>Base URL</span>
          <input id="settings-embedding-base-url" type="text" value="${escapeHtml(embedding.baseUrl || "")}" placeholder="兼容 OpenAI 的 /v1 根地址" spellcheck="false" />
        </label>
      </div>
      <label class="toggle-field settings-toggle">
        <input id="settings-embedding-sync-on-write" type="checkbox" ${embedding.syncOnWrite ? "checked" : ""} />
        <span>写入知识库后立即同步生成 embedding</span>
      </label>
    </article>

    <div class="settings-action-row">
      <span class="status-badge ${statusClass}">${escapeHtml(statusText)}</span>
      <button type="button" class="secondary-button" data-settings-reset="true" ${state.appSettingsSaving ? "disabled" : ""}>恢复当前值</button>
      <button type="button" class="primary-button" data-settings-save="true" ${state.appSettingsSaving ? "disabled" : ""}>保存设置</button>
    </div>
  `;
}

function renderAppChrome() {
  renderNavigation();
  renderActiveView();
  renderViewHeader();
  renderDashboardOverviewPanel();
  renderDashboardSessionPanel();
  renderStartSessionPanel();
  renderSettingsOverviewPanel();
  renderSettingsConfigPanel();
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
  const hasDraftContent = Boolean(
    elements.templateNameInput?.value
    || elements.companyNameInput?.value
    || elements.jobDirectionInput?.value
    || elements.jobDescriptionInput?.value
    || elements.interviewerRoleNameInput?.value
  );
  const currentTemplateExists = state.currentTemplateId
    ? Boolean(findTemplateById(state.currentTemplateId))
    : false;
  if ((!state.currentTemplateId && !hasDraftContent) || (state.currentTemplateId && !currentTemplateExists)) {
    fillTemplateForm(state.bootstrap.templates[0] || createBlankTemplate());
  }
  updateShellSummary();
  renderAppChrome();
}

// 计划区默认保持高信息密度，但把次级细节折叠起来，
// 这样在调试信息变多之后仍然能保持可读性。
function renderPlanLegacy() {
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
function resolveSelectedPlanStageIndex(stages, fallbackIndex = 0) {
  if (!stages.length) {
    state.selectedPlanStageIndex = "";
    return -1;
  }

  const explicitIndex = Number.parseInt(String(state.selectedPlanStageIndex), 10);
  const normalizedFallback = Number.isInteger(fallbackIndex)
    ? Math.min(Math.max(fallbackIndex, 0), stages.length - 1)
    : 0;
  const nextIndex = Number.isInteger(explicitIndex) && explicitIndex >= 0 && explicitIndex < stages.length
    ? explicitIndex
    : normalizedFallback;

  state.selectedPlanStageIndex = String(nextIndex);
  return nextIndex;
}

function buildPlanStageState(index, currentIndex) {
  if (index < currentIndex) {
    return {
      label: "已完成",
      tone: ""
    };
  }

  if (index === currentIndex) {
    return {
      label: "进行中",
      tone: "accent"
    };
  }

  return {
    label: "未开始",
    tone: ""
  };
}

function buildPlanStageWorkspace(stage, index, stages, session) {
  const coverage = session.coverage || {};
  const bucket = coverage[stage.category] || {};
  const stageState = buildPlanStageState(index, session.stageIndex);
  const targetTopics = (stage.targetTopics || [])
    .map((topic) => topic?.label || topic?.name || topic)
    .filter(Boolean);
  const relatedNodes = (session.topicGraph?.nodes || [])
    .filter((node) => (node.stageTitles || []).includes(stage.title) || node.category === stage.category)
    .sort((left, right) => (
      Number(Boolean(right.currentQuestion || right.activeThreadId)) - Number(Boolean(left.currentQuestion || left.activeThreadId))
      || (right.askCount || 0) - (left.askCount || 0)
      || String(left.label || "").localeCompare(String(right.label || ""))
    ));
  const activeThread = findCurrentThread(session);
  const currentQuestion = session.nextQuestion?.topicCategory === stage.category
    ? session.nextQuestion
    : null;
  const stageSummary = truncateText(stage.goal || stage.promptHint || "当前阶段暂无补充说明。", 72);
  const currentQuestionPreview = truncateText(
    currentQuestion?.text || "当前问题还没有落到这个阶段。",
    84
  );

  return `
    <div class="plan-stage-strip" role="tablist" aria-label="阶段计划">
      ${stages.map((item, itemIndex) => {
        const itemState = buildPlanStageState(itemIndex, session.stageIndex);
        const isActive = itemIndex === index;
        const itemBucket = coverage[item.category] || {};

        return `
          <button
            type="button"
            class="plan-stage-button ${isActive ? "is-active" : ""}"
            data-plan-stage-index="${itemIndex}"
            aria-pressed="${isActive ? "true" : "false"}"
          >
            <span class="plan-stage-button-step">阶段 ${itemIndex + 1}</span>
            <strong class="plan-stage-button-title">${escapeHtml(item.title || "阶段")}</strong>
            <span class="plan-stage-button-meta">${escapeHtml(itemState.label)} · ${escapeHtml(`${itemBucket.asked || 0}/${itemBucket.planned || 0}`)}</span>
          </button>
        `;
      }).join("")}
    </div>

    <article class="plan-stage-detail-card">
      <header class="graph-detail-header">
        <div>
          <p class="card-kicker">${escapeHtml(topicLabel(stage.category))}</p>
          <h3 class="card-title">${escapeHtml(stage.title || `阶段 ${index + 1}`)}</h3>
          <p class="summary-copy">${escapeHtml(stageSummary)}</p>
        </div>
        <div class="summary-badges">
          ${renderPill(`阶段 ${index + 1}/${stages.length}`)}
          ${renderPill(stageState.label, stageState.tone)}
          ${renderPill(`${bucket.asked || 0} / ${bucket.planned || 0} 题`)}
          ${renderPill(`均分 ${bucket.averageScore ?? "--"}`)}
        </div>
      </header>

      <div class="metric-grid compact">
        <div class="metric-tile accent">
          <span class="metric-label">覆盖进度</span>
          <strong>${escapeHtml(`${bucket.asked || 0} / ${bucket.planned || 0}`)}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">目标主题</span>
          <strong>${escapeHtml(targetTopics.length || 0)}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">图谱节点</span>
          <strong>${escapeHtml(relatedNodes.length || 0)}</strong>
        </div>
        <div class="metric-tile">
          <span class="metric-label">当前线程</span>
          <strong>${escapeHtml(activeThread?.label || "待进入")}</strong>
        </div>
      </div>

      <div class="plan-stage-detail-grid">
        <section class="graph-detail-section">
          <p class="detail-label">${renderLabelWithTooltip("目标", "本阶段希望验证的核心能力、经验范围和面试意图。")}</p>
          <div class="markdown-block">${renderMarkdown(stage.goal, { empty: "暂无阶段目标说明" })}</div>
        </section>

        <section class="graph-detail-section">
          <p class="detail-label">${renderLabelWithTooltip("提示", "给出提问方向、追问方式或本阶段的操作提醒。")}</p>
          <div class="markdown-block subtle">${renderMarkdown(stage.promptHint, { empty: "暂无提问提示" })}</div>
        </section>

        <section class="graph-detail-section">
          <p class="detail-label">${renderLabelWithTooltip("主题", "这个阶段重点覆盖的能力主题或项目维度。")}</p>
          <div class="chip-wrap">
            ${targetTopics.length
              ? targetTopics.map((topic) => `<span class="topic-tag compact">${escapeHtml(topic)}</span>`).join("")
              : '<span class="muted">暂无目标主题</span>'}
          </div>
        </section>

        <section class="graph-detail-section">
          <p class="detail-label">${renderLabelWithTooltip("节点", "与当前阶段相关的图谱节点，可用来观察覆盖范围和追问落点。")}</p>
          <div class="chip-wrap">
            ${relatedNodes.length
              ? relatedNodes.slice(0, 8).map((node) => `<span class="topic-tag compact">${escapeHtml(node.label)}</span>`).join("")
              : '<span class="muted">当前还没有落到图谱节点</span>'}
          </div>
        </section>

        <section class="graph-detail-section">
          <p class="detail-label">${renderLabelWithTooltip("信号", "显示当前阶段状态、活跃线程和本阶段相关的当前问题。")}</p>
          <div class="markdown-block subtle">${renderMarkdown([
            `- 状态：${stageState.label}`,
            `- 线程：${activeThread?.label || "暂无活跃线程"}`,
            `- 当前题：${currentQuestionPreview}`
          ].join("\n"))}</div>
        </section>

        <section class="graph-detail-section">
          <p class="detail-label">${renderLabelWithTooltip("备注", "记录阶段补充说明、人工判断或自动生成的额外摘要。")}</p>
          <div class="markdown-block subtle">${renderMarkdown(stage.notes || stage.summary, { empty: "当前阶段还没有附加备注" })}</div>
        </section>
      </div>
    </article>
  `;
}

function renderPlanWorkspace() {
  if (!state.session) {
    elements.planList.className = "plan-list empty-state";
    elements.planList.textContent = "开始面试后，这里会展示阶段切换和详细计划。";
    return;
  }

  const stages = state.session.plan?.stages || [];
  if (!stages.length) {
    elements.planList.className = "plan-list empty-state";
    elements.planList.textContent = "当前会话还没有生成阶段计划。";
    state.selectedPlanStageIndex = "";
    return;
  }

  const activeIndex = resolveSelectedPlanStageIndex(stages, state.session.stageIndex);
  elements.planList.className = "plan-list plan-workspace";
  elements.planList.innerHTML = buildPlanStageWorkspace(
    stages[activeIndex] || stages[0],
    activeIndex,
    stages,
    state.session
  );
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
  renderAppChrome();
  renderSessionWorkspaceChrome();

  if (!state.session) {
    elements.sessionTitle.textContent = "尚未开始";
    elements.sessionSubtitle.textContent = "先选择模板或创建一个新的面试模板，再启动面试。";
    elements.stageChip.textContent = "Idle";
    elements.turnCounter.textContent = "0 / 0";
    renderPlanWorkspace();
    renderConversation();
    renderRunState();
    renderReport();
    renderBackgroundJobs();
    renderObservabilityPanel();
    renderDesktopRuntimePanel();
    syncAnswerControls();
    stopRunClock();
    renderSessionWorkspaceChrome();
    renderAppChrome();
    renderAppOverlay();
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
    ? `${template.interviewerRoleName || "面试官"} · ${truncateText(state.session.plan?.summary || "正在生成正式面试计划。", 48)}${state.session.enableWebSearch ? " · 联网" : ""}`
    : `${truncateText(state.session.plan?.summary || "正在生成正式面试计划。", 48)}${state.session.enableWebSearch ? " · 联网" : ""}`;

  elements.stageChip.textContent = activePhase
    ? `${activePhase.name} 路 ${formatDuration(getLivePhaseDuration(activePhase, new Date()))}`
    : (stage?.title || sessionStatusLabel(state.session.status));
  elements.turnCounter.textContent = `${state.session.turns.length} / ${state.session.plan?.targetTurnCount || 0}`;
  elements.runStatus.textContent = `${sessionStatusLabel(state.session.status)}${thread ? ` · ${thread.label}` : ""}`;

  renderPlanWorkspace();
  renderConversation();
  renderRunState();
  renderReport();
  renderBackgroundJobs();
  renderObservabilityPanel();
  renderDesktopRuntimePanel();
  syncAnswerControls();
  ensureRunClock();
  renderSessionWorkspaceChrome();
  updateShellSummary();
  renderAppChrome();
  renderAppOverlay();
}
