import { request } from "./api.js";
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

function stopSessionStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
    state.streamSessionId = null;
  }
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
}
