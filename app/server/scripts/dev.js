import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readBooleanEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return defaultValue;
  }

  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const port = readPositiveInt(process.env.PORT, 3000);
const browserUrl = process.env.DEV_BROWSER_URL || `http://127.0.0.1:${port}`;
const healthPath = process.env.DEV_HEALTH_PATH || "/api/debug/logs/summary?limit=1";
const healthUrl = new URL(healthPath, browserUrl).toString();
const openBrowser = hasFlag("--no-open")
  ? false
  : readBooleanEnv("DEV_OPEN_BROWSER", !process.env.CI);
const watchMode = hasFlag("--no-watch")
  ? false
  : readBooleanEnv("DEV_WATCH", true);
const reuseRunning = readBooleanEnv("DEV_REUSE_RUNNING", true);
const healthTimeoutMs = readPositiveInt(process.env.DEV_HEALTH_TIMEOUT_MS, 30000);
const healthIntervalMs = readPositiveInt(process.env.DEV_HEALTH_INTERVAL_MS, 500);

function log(message) {
  console.log(`[dev] ${message}`);
}

async function isHealthy(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isHealthy(url)) {
      return true;
    }

    await delay(healthIntervalMs);
  }

  return false;
}

function openBrowserWindow(url) {
  if (!openBrowser) {
    return;
  }

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  if (process.platform === "darwin") {
    spawn("open", [url], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  spawn("xdg-open", [url], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

async function main() {
  // Reuse an existing local instance before spawning a new one.
  if (reuseRunning && await isHealthy(healthUrl)) {
    log(`Reusing existing dev server at ${browserUrl}`);
    openBrowserWindow(browserUrl);
    return;
  }

  const serverArgs = [
    ...(watchMode ? ["--watch"] : []),
    "app/server/server.js"
  ];

  log(`Starting dev server: node ${serverArgs.join(" ")}`);
  if (watchMode) {
    log("Watch mode enabled");
  }

  const child = spawn(process.execPath, serverArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port)
    }
  });

  let shuttingDown = false;

  const stopChild = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", () => stopChild("SIGINT"));
  process.on("SIGTERM", () => stopChild("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) {
      log(`Dev server exited with signal=${signal}`);
      process.exit(1);
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error("[dev] Failed to start dev server:", error);
    process.exit(1);
  });

  const healthy = await waitForHealthy(healthUrl, healthTimeoutMs);
  if (healthy) {
    log(`Server ready at ${browserUrl}`);
    openBrowserWindow(browserUrl);
    return;
  }

  log(`Health check did not pass within ${healthTimeoutMs}ms`);
}

await main();
