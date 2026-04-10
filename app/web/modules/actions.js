import {
  cleanupDesktopRuntime,
  fetchDesktopRuntime,
  fetchBootstrap,
  fetchObservabilityOverview,
  importDesktopResumePackage,
  fetchSessionObservability,
  resetDesktopRuntime,
  request
} from "./api.js";
import { elements } from "./dom.js";
import { renderBootstrap, renderSession, syncAnswerControls } from "./renderers.js";
import { state } from "./state.js";
import {
  buildPersistedTemplatePayload,
  createBlankTemplate,
  fillTemplateForm,
  findTemplateById,
  isCurrentTemplateSaved,
  removeTemplate,
  renderTemplatePicker,
  updateTemplateChrome,
  upsertTemplate
} from "./templates.js";

const OBSERVABILITY_POLL_INTERVAL_MS = 15_000;

// 所有副作用都收口在 actions，包括请求、SSE 生命周期和本地状态同步。
function stopSessionStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
    state.streamSessionId = null;
  }
}

// 每场面试只保留一个活跃 EventSource，避免旧 session 的事件串进当前界面。
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

function stopObservabilityPolling() {
  if (state.observabilityPollingTimer) {
    clearInterval(state.observabilityPollingTimer);
    state.observabilityPollingTimer = null;
  }
}

export async function refreshObservability() {
  // 日志聚合视图走独立只读接口，避免把调试刷新绑进面试热路径。
  const requestToken = ++state.observabilityRequestToken;
  const sessionId = state.session?.id || "";

  try {
    const [overview, sessionSummary] = await Promise.all([
      fetchObservabilityOverview({
        limit: 6,
        fileLimit: 3,
        lineLimitPerFile: 4000
      }),
      sessionId
        ? fetchSessionObservability(sessionId, {
          timelineLimit: 8,
          providerLimit: 6,
          slowLimit: 6,
          jobLimit: 6,
          fileLimit: 3,
          lineLimitPerFile: 4000
        })
        : Promise.resolve(null)
    ]);

    if (requestToken !== state.observabilityRequestToken) {
      return;
    }

    if (sessionId && state.session?.id !== sessionId) {
      return;
    }

    state.observabilityOverview = overview;
    state.observabilitySession = sessionSummary;
    if (!sessionSummary) {
      state.observabilityScope = "global";
    }
    state.observabilityError = "";
  } catch (error) {
    if (requestToken !== state.observabilityRequestToken) {
      return;
    }

    state.observabilityError = error.message || "日志聚合视图加载失败";
    if (!sessionId) {
      state.observabilitySession = null;
      state.observabilityScope = "global";
    }
  } finally {
    if (requestToken === state.observabilityRequestToken) {
      renderSession();
    }
  }
}

export async function refreshDesktopRuntime() {
  try {
    state.desktopRuntime = await fetchDesktopRuntime();
    state.desktopRuntimeError = "";
  } catch (error) {
    state.desktopRuntimeError = error.message || "desktop runtime 加载失败";
  } finally {
    renderSession();
  }
}

export async function refreshBootstrap() {
  state.bootstrap = await fetchBootstrap();
  renderBootstrap();
  renderSession();
}

export function startObservabilityPolling() {
  if (state.observabilityPollingTimer) {
    return;
  }

  // 调试视图用低频轮询就够了，重点是可读性，不追求逐事件实时。
  state.observabilityPollingTimer = setInterval(() => {
    refreshObservability();
  }, OBSERVABILITY_POLL_INTERVAL_MS);
}

async function runDesktopCleanup(target) {
  const runtime = state.desktopRuntime;
  const cleanupTarget = runtime?.cleanupTargets?.find((item) => item.target === target);
  if (!cleanupTarget) {
    return;
  }

  const confirmed = window.confirm(`确认清理${cleanupTarget.label}吗？\n\n目录：${cleanupTarget.path}`);
  if (!confirmed) {
    return;
  }

  state.desktopActionTarget = target;
  renderSession();

  try {
    await cleanupDesktopRuntime(target);
    await refreshDesktopRuntime();
  } finally {
    state.desktopActionTarget = "";
    renderSession();
  }
}

async function runDesktopFullReset() {
  const runtime = state.desktopRuntime;
  if (!runtime?.enabled || runtime?.fullReset?.pending) {
    return;
  }

  const confirmationText = runtime.fullReset?.confirmationText || "DELETE LOCAL DATA";
  const input = window.prompt(
    [
      "这是危险操作，将在下次启动时删除全部本地数据。",
      "包括本地 PostgreSQL 数据、题库资产、复习记录、日志、导出与配置。",
      "",
      `请输入 ${confirmationText} 以确认：`
    ].join("\n"),
    ""
  );

  if (input == null) {
    return;
  }

  state.desktopActionTarget = "full-reset";
  renderSession();

  try {
    await resetDesktopRuntime(input.trim());
    await refreshDesktopRuntime();
    window.alert("已计划在下次启动时删除全部本地数据。请关闭桌面应用后重新打开。");
  } finally {
    state.desktopActionTarget = "";
    renderSession();
  }
}

function readResumePackageFiles(fileList) {
  return Promise.all(
    [...(fileList || [])].map(async (file) => ({
      name: file.name,
      content: await file.text()
    }))
  );
}

async function importResumePackageFromInput() {
  const input = elements.resumePackageInput;
  if (!input?.files?.length) {
    return;
  }

  state.resumeImporting = true;
  renderBootstrap();
  renderSession();

  try {
    const files = await readResumePackageFiles(input.files);
    const result = await importDesktopResumePackage(files);
    await refreshBootstrap();
    await refreshDesktopRuntime();
    const missingNote = result.missingFiles?.length
      ? `\n当前仍缺少：${result.missingFiles.join("、")}`
      : "";
    window.alert(`简历导入完成，已写入本地工作区：\n${result.workspacePath}${missingNote}`);
  } catch (error) {
    window.alert(error.message || "简历导入失败");
  } finally {
    state.resumeImporting = false;
    input.value = "";
    renderBootstrap();
    renderSession();
  }
}

function switchObservabilityScope(scope) {
  const normalizedScope = scope === "global" ? "global" : "session";
  if (normalizedScope === "session" && !state.observabilitySession) {
    return;
  }

  state.observabilityScope = normalizedScope;
  renderSession();
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
    renderBootstrap();
    renderSession();
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
    renderSession();
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
    renderSession();
  } finally {
    elements.deleteTemplateButton.disabled = false;
  }
}

async function startInterview() {
  if (!state.bootstrap?.candidate?.ready) {
    window.alert("当前工作区还没有导入简历，暂时不能开始面试。");
    return;
  }

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

    state.observabilityScope = "session";
    elements.answerInput.value = "";
    renderSession();
    refreshObservability();
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
    refreshObservability();
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

function bindObservabilityInteractions() {
  elements.observabilityPanel?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-observability-scope]");
    if (!toggle) {
      return;
    }

    switchObservabilityScope(toggle.dataset.observabilityScope);
  });
}

function bindDesktopInteractions() {
  elements.desktopRuntimePanel?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-desktop-cleanup-target]");
    if (action) {
      void runDesktopCleanup(action.dataset.desktopCleanupTarget);
      return;
    }

    const resetAction = event.target.closest("[data-desktop-full-reset]");
    if (resetAction) {
      void runDesktopFullReset();
    }
  });
}

function bindResumeImportInteractions() {
  elements.importResumeButton?.addEventListener("click", () => {
    elements.resumePackageInput?.click();
  });

  elements.resumePackageInput?.addEventListener("change", () => {
    void importResumePackageFromInput();
  });
}

export function bindUiEvents() {
  elements.loadTemplateButton.addEventListener("click", loadSelectedTemplate);
  elements.newTemplateButton.addEventListener("click", () => fillTemplateForm(createBlankTemplate()));
  elements.copyTemplateButton.addEventListener("click", copyTemplate);
  elements.deleteTemplateButton.addEventListener("click", deleteCurrentTemplate);
  elements.saveTemplateButton.addEventListener("click", saveTemplate);
  elements.startButton.addEventListener("click", startInterview);
  elements.answerButton.addEventListener("click", submitAnswer);
  elements.answerInput.addEventListener("input", syncAnswerControls);
  bindTemplateFormDirtyTracking();
  bindObservabilityInteractions();
  bindDesktopInteractions();
  bindResumeImportInteractions();
  window.addEventListener("beforeunload", stopObservabilityPolling);
}
