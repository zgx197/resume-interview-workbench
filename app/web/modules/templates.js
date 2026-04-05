import { elements } from "./dom.js";
import { buildTemplateMeta } from "./presenters.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

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
  return pieces.join(" · ") || "未命名模板";
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
}

export function renderTemplateStatus() {
  const saved = isCurrentTemplateSaved();
  elements.templateStatus.textContent = saved ? "已保存" : "未保存";
  elements.templateStatus.className = `status-badge ${saved ? "saved" : "neutral"}`;
}

export function renderCurrentTemplateMeta() {
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
  elements.templateMeta.innerHTML = buildTemplateMeta(savedTemplate);
}

export function updateTemplateChrome() {
  renderTemplateStatus();
  renderCurrentTemplateMeta();
  if (elements.templateCount) {
    elements.templateCount.textContent = String(state.bootstrap?.templates?.length || 0);
  }
}

export function fillTemplateForm(template) {
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

export function renderTemplatePicker() {
  const templates = sortTemplates(state.bootstrap?.templates || []);
  elements.templateSelect.innerHTML = [
    '<option value="">当前编辑内容（未绑定模板）</option>',
    ...templates.map((template) => {
      const isRecent = Boolean(template.recentUsedAt);
      const label = `${isRecent ? "最近 · " : ""}${template.name}`;
      return `<option value="${escapeHtml(template.id)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
  elements.templateSelect.value = state.currentTemplateId || "";
  if (elements.templateCount) {
    elements.templateCount.textContent = String(templates.length);
  }
  renderCurrentTemplateMeta();
}
