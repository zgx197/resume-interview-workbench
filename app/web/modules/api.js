// 轻量 fetch 封装，把后端错误响应统一转成可抛出的异常对象。
export function request(url, options = {}) {
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

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export function fetchBootstrap() {
  return request("/api/bootstrap");
}

export function fetchDesktopRuntime() {
  return request("/api/desktop/runtime");
}

export function fetchAppSettings() {
  return request("/api/settings");
}

export function saveAppSettings(payload) {
  return request("/api/settings", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function cleanupDesktopRuntime(target) {
  return request("/api/desktop/runtime/cleanup", {
    method: "POST",
    body: JSON.stringify({ target })
  });
}

export function resetDesktopRuntime(confirmationText) {
  return request("/api/desktop/runtime/reset", {
    method: "POST",
    body: JSON.stringify({ confirmationText })
  });
}

export function importDesktopResumePackage(files) {
  return request("/api/desktop/resume-package/import", {
    method: "POST",
    body: JSON.stringify({ files })
  });
}

export function fetchObservabilityOverview(params = {}) {
  return request(`/api/debug/logs/summary${buildQueryString(params)}`);
}

export function fetchSessionObservability(sessionId, params = {}) {
  if (!sessionId) {
    return Promise.resolve(null);
  }

  return request(`/api/debug/logs/sessions/${encodeURIComponent(sessionId)}${buildQueryString(params)}`);
}
