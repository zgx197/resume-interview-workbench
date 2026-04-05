import { request } from "./modules/api.js";
import { bindUiEvents } from "./modules/actions.js";
import { renderBootstrap, renderSession } from "./modules/renderers.js";
import { state } from "./modules/state.js";
import { elements } from "./modules/dom.js";

bindUiEvents();

request("/api/bootstrap")
  .then((bootstrap) => {
    state.bootstrap = bootstrap;
    renderBootstrap();
    renderSession();
  })
  .catch((error) => {
    elements.providerBadge.textContent = error.message;
  });
