import { fetchBootstrap } from "./modules/api.js";
import {
  bindUiEvents,
  refreshAppSettings,
  refreshDesktopRuntime,
  refreshObservability,
  syncViewFromLocation,
  startObservabilityPolling
} from "./modules/actions.js";
import { renderBootstrap, renderSession } from "./modules/renderers.js";
import { state } from "./modules/state.js";
import { elements } from "./modules/dom.js";

// 前端入口故意保持很薄：
// 先拉 bootstrap，再由本地 state + SSE 驱动后续刷新。
bindUiEvents();
syncViewFromLocation();

fetchBootstrap()
  .then((bootstrap) => {
    state.bootstrap = bootstrap;
    renderBootstrap();
    renderSession();
    refreshAppSettings();
    refreshDesktopRuntime();
    refreshObservability();
    startObservabilityPolling();
  })
  .catch((error) => {
    elements.providerBadge.textContent = error.message;
  });
