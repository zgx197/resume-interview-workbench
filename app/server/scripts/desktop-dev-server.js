import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvFile } from "../env.js";
import {
  prepareDesktopRuntime,
  stopManagedDesktopDatabase
} from "./desktop-runtime.js";

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
const healthPath = process.env.DEV_HEALTH_PATH || "/api/bootstrap";
const healthUrl = new URL(healthPath, browserUrl).toString();
const watchMode = hasFlag("--no-watch")
  ? false
  : readBooleanEnv("DEV_WATCH", true);
const healthTimeoutMs = readPositiveInt(process.env.DEV_HEALTH_TIMEOUT_MS, 30000);
const healthIntervalMs = readPositiveInt(process.env.DEV_HEALTH_INTERVAL_MS, 500);
const healthRequestTimeoutMs = readPositiveInt(process.env.DEV_HEALTH_REQUEST_TIMEOUT_MS, 5000);
const shutdownOnStdinEnd = readBooleanEnv(
  "DEV_SHUTDOWN_ON_STDIN_END",
  true
);

function log(message) {
  console.log(`[desktop:dev:server] ${message}`);
}

function isPortOpen(host, portNumber) {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host,
      port: portNumber
    });

    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1500, () => finish(false));
  });
}

async function isHealthy(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(healthRequestTimeoutMs)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const target = new URL(url);
  const targetPort = Number(target.port || (target.protocol === "https:" ? 443 : 80));

  while (Date.now() < deadline) {
    const portReady = await isPortOpen(target.hostname, targetPort);
    if (portReady && await isHealthy(url)) {
      return true;
    }

    await delay(healthIntervalMs);
  }

  return false;
}

async function main() {
  await loadEnvFile();
  const bootstrap = await prepareDesktopRuntime({
    scope: "desktop:runtime"
  });

  log(`database mode=${bootstrap.databaseMode}`);
  log(`desktop data dir=${bootstrap.paths.baseDir}`);

  const serverArgs = [
    ...(watchMode ? ["--watch"] : []),
    "app/server/server.js"
  ];

  const child = spawn(process.execPath, serverArgs, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...bootstrap.envOverrides,
      PORT: String(port)
    }
  });
  log(`spawning app server pid=${child.pid || "unknown"} cwd=${process.cwd()} healthUrl=${healthUrl}`);

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  let shuttingDown = false;

  const stopAll = async (signal, reason = "unspecified") => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    log(`stopping app server signal=${signal} reason=${reason}`);
    if (!child.killed) {
      child.kill(signal);
    }

    if (bootstrap.databaseMode === "managed" && bootstrap.startedManagedProcess) {
      await stopManagedDesktopDatabase(
        bootstrap.runtime,
        bootstrap.paths,
        "desktop:runtime"
      );
    }
  };

  process.on("SIGINT", () => {
    void stopAll("SIGINT", "desktop-dev-server received SIGINT");
  });
  process.on("SIGTERM", () => {
    void stopAll("SIGTERM", "desktop-dev-server received SIGTERM");
  });

  if (shutdownOnStdinEnd && process.stdin) {
    process.stdin.resume();
    process.stdin.on("end", () => {
      void stopAll("SIGTERM", "stdin ended");
    });
  }

  child.on("error", (error) => {
    console.error("[desktop:dev:server] Failed to start dev server:", error);
    process.exit(1);
  });

  child.on("exit", async (code, signal) => {
    log(`app server exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (bootstrap.databaseMode === "managed" && bootstrap.startedManagedProcess) {
      await stopManagedDesktopDatabase(
        bootstrap.runtime,
        bootstrap.paths,
        "desktop:runtime"
      );
    }

    if (signal) {
      log(`desktop dev server exited with signal=${signal}`);
      process.exit(1);
      return;
    }

    process.exit(code ?? 0);
  });

  const healthy = await waitForHealthy(healthUrl, healthTimeoutMs);
  if (!healthy) {
    await stopAll("SIGTERM", `health check timed out after ${healthTimeoutMs}ms`);
    throw new Error(`Desktop server health check did not pass within ${healthTimeoutMs}ms`);
  }

  log(`desktop server ready at ${browserUrl}`);
}

await main();
