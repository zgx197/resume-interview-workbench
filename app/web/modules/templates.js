import { elements } from "./dom.js";
import { buildTemplateMeta } from "./presenters.js";
import { state } from "./state.js";
import { escapeHtml, formatDateTime } from "./utils.js";

export function sortTemplates(templates) {
  return [...templates].sort((left, right) => {
    const leftRecent = left.recentUsedAt || "";
    const rightRecent = right.recentUsedAt || "";
    if (leftRecent !== rightRecent) {
      return rightRecent.localeCompare(leftRecent);
    }
    return (right.updatedAt || "").localeCompare(left.updatedAt || "");
  });
}

export function getDefaultRole() {
  return state.bootstrap?.roles?.[0] || null;
}

export function getDefaultJob() {
  return state.bootstrap?.jobs?.[0] || null;
}

export function createBlankTemplate() {
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

export function deriveTemplateName(template) {
  const pieces = [template.companyName, template.jobDirection, template.interviewerRoleName]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return pieces.join(" / ") || "未命名模板";
}

export function buildTemplateDraft() {
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

export function hasTemplateDraftContent(template = buildTemplateDraft()) {
  return Boolean(
    template.name
    || template.companyName
    || template.companyIntro
    || template.jobDirection
    || template.jobDescription
    || template.additionalContext
    || template.interviewerRoleName
    || template.roleId
    || template.jobId
  );
}

export function buildPersistedTemplatePayload({ forceCopy = false } = {}) {
  const draft = buildTemplateDraft();
  return {
    ...draft,
    id: forceCopy ? "" : draft.id,
    name: draft.name || deriveTemplateName(draft)
  };
}

export function serializeTemplateDraft(template) {
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

export function isCurrentTemplateSaved() {
  if (!state.currentTemplateId || !state.loadedTemplateSnapshot) {
    return false;
  }
  return serializeTemplateDraft(buildTemplateDraft()) === state.loadedTemplateSnapshot;
}

export function findTemplateById(templateId) {
  return state.bootstrap?.templates?.find((template) => template.id === templateId) || null;
}

export function setTemplateSelection(templateId) {
  state.templateSelectionId = templateId || "";
  if (elements.templateSelect) {
    elements.templateSelect.value = state.templateSelectionId;
  }
}

function normalizeTemplateSearch(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function matchTemplateSearch(template, query) {
  if (!query) {
    return true;
  }

  const haystack = [
    template.name,
    template.companyName,
    template.companyIntro,
    template.jobDirection,
    template.jobDescription,
    template.additionalContext,
    template.interviewerRoleName
  ]
    .join(" ")
    .toLocaleLowerCase();

  return haystack.includes(query);
}

function getActiveTemplateSelectionId() {
  return state.templateSelectionId || state.currentTemplateId || "";
}

function getSelectedTemplate() {
  return findTemplateById(getActiveTemplateSelectionId());
}

export function buildTemplateSectionStatus(template) {
  const basicCompleted = [
    Boolean(template.name),
    Boolean(template.companyName),
    Boolean(template.jobDirection),
    Boolean(template.interviewerRoleName)
  ];
  const narrativeCompleted = [
    Boolean(template.companyIntro),
    Boolean(template.jobDescription),
    Boolean(template.additionalContext)
  ];
  const configCompleted = [
    Boolean(template.roleId),
    Boolean(template.jobId)
  ];

  const sections = [
    {
      key: "basic",
      label: "基础信息",
      completedCount: basicCompleted.filter(Boolean).length,
      totalCount: basicCompleted.length
    },
    {
      key: "narrative",
      label: "说明内容",
      completedCount: narrativeCompleted.filter(Boolean).length,
      totalCount: narrativeCompleted.length
    },
    {
      key: "config",
      label: "高级配置",
      completedCount: configCompleted.filter(Boolean).length,
      totalCount: configCompleted.length
    }
  ];

  return {
    sections,
    completedCount: sections.reduce((sum, item) => sum + item.completedCount, 0),
    totalCount: sections.reduce((sum, item) => sum + item.totalCount, 0)
  };
}

function buildTemplateAssetStats() {
  const templates = sortTemplates(state.bootstrap?.templates || []);
  const readyCount = templates.filter((template) => {
    const readiness = buildTemplateSectionStatus(template);
    return readiness.completedCount >= Math.max(5, readiness.totalCount - 1);
  }).length;
  const selectedTemplate = getSelectedTemplate();
  const selectedReadiness = selectedTemplate ? buildTemplateSectionStatus(selectedTemplate) : null;

  return {
    totalCount: templates.length,
    readyCount,
    selectedName: selectedTemplate?.name || selectedTemplate?.companyName || "未选择模板",
    selectedProgress: selectedReadiness
      ? `${selectedReadiness.completedCount}/${selectedReadiness.totalCount}`
      : "--"
  };
}

function renderSectionProgressChips(readiness) {
  return readiness.sections.map((section) => `
    <span class="topic-tag compact">
      ${escapeHtml(section.label)} ${escapeHtml(`${section.completedCount}/${section.totalCount}`)}
    </span>
  `).join("");
}

function renderTemplateAssetOverview() {
  const stats = buildTemplateAssetStats();
  return `
    <section class="template-asset-overview">
      <div class="template-asset-overview-copy">
        <p class="eyebrow">Asset Center</p>
        <h2>模板资产中心</h2>
        <p class="summary-copy">在这里浏览模板资产、判断完善度，并决定是继续编辑还是直接用于新的面试会话。</p>
      </div>
      <div class="template-asset-overview-grid">
        <article class="metric-tile accent">
          <span class="metric-label">模板总量</span>
          <strong>${escapeHtml(stats.totalCount)}</strong>
        </article>
        <article class="metric-tile">
          <span class="metric-label">可直接复用</span>
          <strong>${escapeHtml(stats.readyCount)}</strong>
        </article>
        <article class="metric-tile">
          <span class="metric-label">当前选中</span>
          <strong>${escapeHtml(stats.selectedName)}</strong>
        </article>
        <article class="metric-tile">
          <span class="metric-label">当前完成度</span>
          <strong>${escapeHtml(stats.selectedProgress)}</strong>
        </article>
      </div>
    </section>
  `;
}

function renderTemplateLibraryDetail() {
  if (!elements.templateLibraryDetailPanel) {
    return;
  }

  const selectedTemplate = getSelectedTemplate();
  const templateCount = state.bootstrap?.templates?.length || 0;

  if (!selectedTemplate) {
    elements.templateLibraryDetailPanel.className = "panel template-library-detail-panel";
    elements.templateLibraryDetailPanel.innerHTML = `
      ${renderTemplateAssetOverview()}
      <section class="template-library-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Selection</p>
            <h2>${templateCount ? "选择一个模板继续" : "先创建你的第一个模板"}</h2>
          </div>
        </div>
        <p class="summary-copy">
          ${escapeHtml(
            templateCount
              ? "左侧列表会负责资产筛选和挑选，进入编辑页后再处理详细字段。"
              : "模板库还是空的，建议先创建一个空白模板，再逐步补齐基础信息、说明内容和高级配置。"
          )}
        </p>
        <div class="quick-action-row">
          <button type="button" class="primary-button" data-template-library-action="create-template">新建空白模板</button>
          <button type="button" class="secondary-button" data-nav-view="start">去开始面试</button>
        </div>
      </section>
    `;
    return;
  }

  const readiness = buildTemplateSectionStatus(selectedTemplate);
  const summary = [selectedTemplate.jobDirection, selectedTemplate.interviewerRoleName].filter(Boolean).join(" / ")
    || "待补充岗位方向与面试角色";
  const companyName = selectedTemplate.companyName || "未填写公司信息";
  const previewText = selectedTemplate.jobDescription
    || selectedTemplate.companyIntro
    || selectedTemplate.additionalContext
    || "当前模板还没有补充详细说明。";

  elements.templateLibraryDetailPanel.className = "panel template-library-detail-panel";
  elements.templateLibraryDetailPanel.innerHTML = `
    ${renderTemplateAssetOverview()}
    <section class="template-library-card">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Selected Template</p>
          <h2>${escapeHtml(selectedTemplate.name || deriveTemplateName(selectedTemplate))}</h2>
        </div>
        <span class="status-badge saved">${escapeHtml(`${readiness.completedCount}/${readiness.totalCount} 已补齐`)}</span>
      </div>

      <div class="metric-grid compact">
        <article class="metric-tile">
          <span class="metric-label">岗位摘要</span>
          <strong>${escapeHtml(summary)}</strong>
        </article>
        <article class="metric-tile">
          <span class="metric-label">公司信息</span>
          <strong>${escapeHtml(companyName)}</strong>
        </article>
      </div>

      <div class="chip-wrap">
        ${renderSectionProgressChips(readiness)}
      </div>

      <div class="graph-detail-sections">
        <section class="graph-detail-section">
          <p class="detail-label">最近使用</p>
          <p class="summary-copy">${escapeHtml(formatDateTime(selectedTemplate.recentUsedAt))}</p>
        </section>
        <section class="graph-detail-section">
          <p class="detail-label">最后更新</p>
          <p class="summary-copy">${escapeHtml(formatDateTime(selectedTemplate.updatedAt))}</p>
        </section>
        <section class="graph-detail-section">
          <p class="detail-label">说明预览</p>
          <p class="summary-copy">${escapeHtml(previewText)}</p>
        </section>
      </div>
    </section>

    <section class="template-library-card">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Next Step</p>
          <h2>下一步动作</h2>
        </div>
      </div>
      <p class="summary-copy">列表页用于挑选资产，真正的字段维护和微调建议放到独立编辑页中完成。</p>
      <div class="quick-action-row">
        <button type="button" class="primary-button" data-template-library-action="open-editor">进入编辑页</button>
        <button type="button" class="secondary-button" data-template-library-action="create-template">新建空白模板</button>
        <button type="button" class="secondary-button" data-nav-view="start">用于开始面试</button>
      </div>
    </section>
  `;
}

function renderTemplateWorkbenchSummary() {
  if (!elements.templateEditorSummaryPanel) {
    return;
  }

  const draft = buildTemplateDraft();
  const savedTemplate = state.currentTemplateId ? findTemplateById(state.currentTemplateId) : null;
  const readiness = buildTemplateSectionStatus(draft);
  const role = getDefaultRole();
  const job = getDefaultJob();
  const activeRoleId = draft.roleId || role?.id || "";
  const activeJobId = draft.jobId || job?.id || "";
  const roleLabel = state.bootstrap?.roles?.find((item) => item.id === activeRoleId)?.name || "未选择";
  const jobLabel = state.bootstrap?.jobs?.find((item) => item.id === activeJobId)?.title || "未选择";
  const summary = [draft.jobDirection, draft.interviewerRoleName].filter(Boolean).join(" / ")
    || "待补充岗位方向与面试角色";

  elements.templateEditorSummaryPanel.className = "panel template-editor-summary-panel";
  elements.templateEditorSummaryPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="eyebrow">Workbench</p>
        <h2>${escapeHtml(draft.name || deriveTemplateName(draft))}</h2>
      </div>
      <span class="status-badge ${isCurrentTemplateSaved() ? "saved" : "neutral"}">${escapeHtml(isCurrentTemplateSaved() ? "已保存" : "编辑中")}</span>
    </div>

    <div class="metric-grid compact">
      <article class="metric-tile accent">
        <span class="metric-label">总完成度</span>
        <strong>${escapeHtml(`${readiness.completedCount}/${readiness.totalCount}`)}</strong>
      </article>
      <article class="metric-tile">
        <span class="metric-label">保存状态</span>
        <strong>${escapeHtml(savedTemplate ? "已入库" : "未入库")}</strong>
      </article>
    </div>

    <section class="template-editor-summary-card">
      <p class="detail-label">当前摘要</p>
      <p class="summary-copy">${escapeHtml(summary)}</p>
    </section>

    <section class="template-editor-summary-card">
      <p class="detail-label">分区完成度</p>
      <div class="chip-wrap">
        ${renderSectionProgressChips(readiness)}
      </div>
    </section>

    <section class="template-editor-summary-card">
      <p class="detail-label">模板基座</p>
      <div class="turn-meta">
        <span>${escapeHtml(roleLabel)}</span>
        <span>${escapeHtml(jobLabel)}</span>
      </div>
    </section>

    <section class="template-editor-summary-card">
      <p class="detail-label">编辑建议</p>
      <p class="summary-copy">建议先补齐基础信息，再完善说明内容，最后根据需要调整高级配置，这样模板更适合后续沉淀成长期资产。</p>
    </section>
  `;
}

export function getFilteredTemplates() {
  const query = normalizeTemplateSearch(state.templateSearchQuery);
  return sortTemplates(state.bootstrap?.templates || []).filter((template) => matchTemplateSearch(template, query));
}

export function upsertTemplate(template) {
  const templates = state.bootstrap.templates || [];
  const index = templates.findIndex((item) => item.id === template.id);
  if (index >= 0) {
    templates.splice(index, 1, template);
  } else {
    templates.push(template);
  }
  state.bootstrap.templates = sortTemplates(templates);
}

export function removeTemplate(templateId) {
  state.bootstrap.templates = (state.bootstrap.templates || []).filter((item) => item.id !== templateId);
  if (state.templateSelectionId === templateId) {
    state.templateSelectionId = "";
  }
}

export function renderTemplateStatus() {
  const saved = isCurrentTemplateSaved();
  elements.templateStatus.textContent = saved ? "已保存" : "未保存";
  elements.templateStatus.className = `status-badge ${saved ? "saved" : "neutral"}`;
}

export function renderCurrentTemplateMeta() {
  const draft = buildTemplateDraft();
  const savedTemplate = state.currentTemplateId ? findTemplateById(state.currentTemplateId) : null;
  const hasContent = hasTemplateDraftContent(draft);

  elements.deleteTemplateButton.disabled = !state.currentTemplateId;
  elements.copyTemplateButton.disabled = !hasContent;

  if (!savedTemplate) {
    elements.templateMeta.className = "template-meta empty-state";
    elements.templateMeta.textContent = hasContent
      ? "当前内容还没有保存为模板。保存后会进入模板库，并记录最近使用时间。"
      : "从模板列表进入这里后，就可以把它完善成真正可复用的模板。";
    return;
  }

  elements.templateMeta.className = "template-meta";
  elements.templateMeta.innerHTML = buildTemplateMeta(savedTemplate);
}

export function renderTemplateList() {
  if (!elements.templateListPanel) {
    return;
  }

  const templates = getFilteredTemplates();
  const activeTemplateId = getActiveTemplateSelectionId();
  const searchQuery = normalizeTemplateSearch(state.templateSearchQuery);

  if (!templates.length) {
    elements.templateListPanel.className = "template-list-panel empty-state";
    elements.templateListPanel.textContent = searchQuery
      ? "没有匹配当前筛选条件的模板。"
      : "还没有可用模板，先创建一个新的模板草稿吧。";
    return;
  }

  elements.templateListPanel.className = "template-list-panel";
  elements.templateListPanel.innerHTML = templates.map((template) => {
    const isActive = template.id === activeTemplateId;
    const isEditing = template.id === state.currentTemplateId;
    const summary = [template.jobDirection, template.interviewerRoleName].filter(Boolean).join(" / ")
      || "待补充岗位方向与面试角色";
    const company = template.companyName || "未填写公司信息";
    const updatedAt = formatDateTime(template.updatedAt);
    const recentUsedAt = formatDateTime(template.recentUsedAt);
    const readiness = buildTemplateSectionStatus(template);

    return `
      <button
        type="button"
        class="template-list-item${isActive ? " is-active" : ""}${isEditing ? " is-editing" : ""}"
        data-template-id="${escapeHtml(template.id)}"
      >
        <span class="template-list-item-top">
          <span class="template-list-title">${escapeHtml(template.name || deriveTemplateName(template))}</span>
          ${isEditing ? '<span class="template-list-badge">编辑中</span>' : ""}
        </span>
        <span class="template-list-summary">${escapeHtml(summary)}</span>
        <span class="template-list-company">${escapeHtml(company)}</span>
        <span class="template-list-progress">完成度 ${escapeHtml(`${readiness.completedCount}/${readiness.totalCount}`)}</span>
        <span class="template-list-meta-row">
          <span>更新 ${escapeHtml(updatedAt)}</span>
          <span>使用 ${escapeHtml(recentUsedAt)}</span>
        </span>
      </button>
    `;
  }).join("");
}

export function updateTemplateChrome() {
  renderTemplateStatus();
  renderCurrentTemplateMeta();
  renderTemplateList();
  renderTemplateLibraryDetail();
  renderTemplateWorkbenchSummary();
  if (elements.templateCount) {
    elements.templateCount.textContent = String(state.bootstrap?.templates?.length || 0);
  }
}

export function fillTemplateForm(template, { keepSelection = false } = {}) {
  const nextTemplate = template || createBlankTemplate();
  state.currentTemplateId = nextTemplate.id || "";
  if (!keepSelection || nextTemplate.id) {
    setTemplateSelection(nextTemplate.id || "");
  }
  elements.templateNameInput.value = nextTemplate.name || "";
  elements.companyNameInput.value = nextTemplate.companyName || "";
  elements.companyIntroInput.value = nextTemplate.companyIntro || "";
  elements.jobDirectionInput.value = nextTemplate.jobDirection || "";
  elements.jobDescriptionInput.value = nextTemplate.jobDescription || "";
  elements.additionalContextInput.value = nextTemplate.additionalContext || "";
  elements.interviewerRoleNameInput.value = nextTemplate.interviewerRoleName || "";
  elements.roleSelect.value = nextTemplate.roleId || getDefaultRole()?.id || "";
  elements.jobSelect.value = nextTemplate.jobId || getDefaultJob()?.id || "";
  elements.templateSelect.value = state.templateSelectionId || nextTemplate.id || "";
  state.loadedTemplateSnapshot = nextTemplate.id ? serializeTemplateDraft(nextTemplate) : "";
  updateTemplateChrome();
}

export function renderTemplatePicker() {
  const templates = sortTemplates(state.bootstrap?.templates || []);
  const currentSelectionId = getActiveTemplateSelectionId();
  const normalizedSelectionId = findTemplateById(currentSelectionId)
    ? currentSelectionId
    : (findTemplateById(state.currentTemplateId) ? state.currentTemplateId : "");

  state.templateSelectionId = normalizedSelectionId;
  if (elements.templateSearchInput && elements.templateSearchInput.value !== state.templateSearchQuery) {
    elements.templateSearchInput.value = state.templateSearchQuery;
  }
  elements.templateSelect.innerHTML = [
    '<option value="">当前编辑内容（未绑定模板）</option>',
    ...templates.map((template) => {
      const isRecent = Boolean(template.recentUsedAt);
      const label = `${isRecent ? "最近 · " : ""}${template.name}`;
      return `<option value="${escapeHtml(template.id)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
  elements.templateSelect.value = normalizedSelectionId;
  if (elements.templateCount) {
    elements.templateCount.textContent = String(templates.length);
  }
  renderCurrentTemplateMeta();
  renderTemplateList();
  renderTemplateLibraryDetail();
  renderTemplateWorkbenchSummary();
}
