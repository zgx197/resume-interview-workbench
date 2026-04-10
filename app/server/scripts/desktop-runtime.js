import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { config } from "../config.js";
import { runPendingMigrations } from "../db/migration-runner.js";
import {
  dockerComposeUp,
  getDatabaseStatus,
  runCommand,
  runSql,
  scriptLog,
  scriptWarn,
  waitForDatabaseReady
} from "./script-helpers.js";

const DESKTOP_APP_DIR_NAME = "ResumeInterviewWorkbench";
const DEFAULT_MANAGED_POSTGRES_PORT = Number(process.env.DESKTOP_POSTGRES_PORT || 55432);
const RESET_MARKER_FILE = ".reset-runtime.json";
export const DESKTOP_RESET_CONFIRMATION_TEXT = "DELETE LOCAL DATA";

function binaryName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function readBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
}

function getLocalAppDataDir() {
  if (process.env.LOCALAPPDATA) {
    return process.env.LOCALAPPDATA;
  }

  return path.join(os.homedir(), "AppData", "Local");
}

export function getDesktopRuntimePaths() {
  const baseDir = path.resolve(
    process.env.DESKTOP_DATA_DIR || path.join(getLocalAppDataDir(), DESKTOP_APP_DIR_NAME)
  );

  return {
    baseDir,
    cacheDir: path.join(baseDir, "cache"),
    configDir: path.join(baseDir, "config"),
    exportsDir: path.join(baseDir, "exports"),
    logsDir: path.join(baseDir, "logs"),
    runDir: path.join(baseDir, "run"),
    tmpDir: path.join(baseDir, "tmp"),
    workspaceDir: path.join(baseDir, "workspace"),
    workspaceResumePackageDir: path.join(baseDir, "workspace", "resume-package"),
    postgresDataDir: path.join(baseDir, "data", "postgres"),
    postgresLogFile: path.join(baseDir, "logs", "postgres.log"),
    serverLogDir: path.join(baseDir, "logs", "server"),
    sessionDir: path.join(baseDir, "exports", "sessions")
  };
}

function getDesktopResetMarkerPath(paths) {
  return path.join(paths.baseDir, RESET_MARKER_FILE);
}

async function ensureDesktopRuntimeDirs(paths) {
  await Promise.all([
    paths.baseDir,
    paths.cacheDir,
    paths.configDir,
    paths.exportsDir,
    paths.logsDir,
    paths.runDir,
    paths.tmpDir,
    paths.workspaceDir,
    paths.workspaceResumePackageDir,
    paths.serverLogDir,
    paths.sessionDir
  ].map((dirPath) => fsp.mkdir(dirPath, { recursive: true })));
}

async function seedDesktopWorkspace(paths, scope) {
  const seedResumeDir = path.join(config.desktopSeedDir, "resume-package");
  const targetResumeDir = paths.workspaceResumePackageDir;

  await fsp.mkdir(targetResumeDir, { recursive: true });

  try {
    const seedEntries = await fsp.readdir(seedResumeDir, { withFileTypes: true });
    for (const entry of seedEntries) {
      const sourcePath = path.join(seedResumeDir, entry.name);
      const targetPath = path.join(targetResumeDir, entry.name);

      try {
        await fsp.access(targetPath);
        continue;
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      if (entry.isDirectory()) {
        await fsp.cp(sourcePath, targetPath, {
          recursive: true,
          force: false
        });
      } else {
        await fsp.copyFile(sourcePath, targetPath);
      }
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      scriptWarn(scope, `desktop seed directory is missing: ${seedResumeDir}`);
      return;
    }

    throw error;
  }
}

function assertSafeDesktopBaseDir(baseDir) {
  const resolved = path.resolve(baseDir);
  const root = path.parse(resolved).root;
  if (resolved === root) {
    throw new Error(`Refusing to reset desktop runtime root directory: ${resolved}`);
  }

  if (path.basename(resolved).toLowerCase() !== DESKTOP_APP_DIR_NAME.toLowerCase()) {
    throw new Error(`Refusing to reset unexpected desktop data directory: ${resolved}`);
  }

  return resolved;
}

async function applyPendingDesktopReset(paths, scope) {
  const markerPath = getDesktopResetMarkerPath(paths);
  let marker = null;

  try {
    marker = JSON.parse(await fsp.readFile(markerPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        applied: false,
        markerPath
      };
    }

    throw error;
  }

  const safeBaseDir = assertSafeDesktopBaseDir(paths.baseDir);
  scriptWarn(scope, `applying scheduled desktop data reset at ${safeBaseDir}`);
  if (marker?.requestedAt) {
    scriptWarn(scope, `reset requestedAt=${marker.requestedAt}`);
  }

  await fsp.rm(safeBaseDir, {
    recursive: true,
    force: true
  });

  return {
    applied: true,
    markerPath
  };
}

function buildManagedDatabaseUrl(port = DEFAULT_MANAGED_POSTGRES_PORT) {
  return `postgresql://${config.postgresUser}:${config.postgresPassword}@127.0.0.1:${port}/${config.postgresDb}`;
}

function buildManagedAdminDatabaseUrl(port = DEFAULT_MANAGED_POSTGRES_PORT) {
  return `postgresql://${config.postgresUser}:${config.postgresPassword}@127.0.0.1:${port}/postgres`;
}

function buildManagedDesktopEnv(paths, port) {
  return {
    DESKTOP_RUNTIME_MODE: "managed_postgres",
    DESKTOP_DATA_DIR: paths.baseDir,
    DATABASE_URL: buildManagedDatabaseUrl(port),
    POSTGRES_PORT: String(port),
    LOG_DIR: paths.serverLogDir,
    SESSION_DIR: paths.sessionDir,
    RESUME_PACKAGE_DIR: paths.workspaceResumePackageDir
  };
}

function buildDesktopEnv(paths, extra = {}) {
  return {
    DESKTOP_DATA_DIR: paths.baseDir,
    LOG_DIR: paths.serverLogDir,
    SESSION_DIR: paths.sessionDir,
    RESUME_PACKAGE_DIR: paths.workspaceResumePackageDir,
    ...extra
  };
}

function resolveCandidatePostgresBinDirs() {
  const candidates = [
    process.env.DESKTOP_POSTGRES_BIN_DIR,
    path.join(config.repoRoot, "src-tauri", "resources", "postgres", "windows-x64", "bin"),
    path.join(config.repoRoot, "src-tauri", "bin", "postgres", "win-x64", "bin"),
    path.join(config.repoRoot, "src-tauri", "bin", "postgres", "bin"),
    path.join(config.repoRoot, "tools", "postgres", "bin")
  ].filter(Boolean);

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

export function detectManagedPostgresRuntime() {
  for (const binDir of resolveCandidatePostgresBinDirs()) {
    const initdbPath = path.join(binDir, binaryName("initdb"));
    const pgCtlPath = path.join(binDir, binaryName("pg_ctl"));
    const pgIsReadyPath = path.join(binDir, binaryName("pg_isready"));

    if ([initdbPath, pgCtlPath, pgIsReadyPath].every((filePath) => fs.existsSync(filePath))) {
      return {
        available: true,
        binDir,
        initdbPath,
        pgCtlPath,
        pgIsReadyPath
      };
    }
  }

  return {
    available: false,
    searchedBinDirs: resolveCandidatePostgresBinDirs()
  };
}

async function ensureManagedClusterInitialized(runtime, paths, scope) {
  const versionMarker = path.join(paths.postgresDataDir, "PG_VERSION");
  if (fs.existsSync(versionMarker)) {
    scriptLog(scope, `managed postgres cluster already initialized at ${paths.postgresDataDir}`);
    return;
  }

  await fsp.mkdir(paths.postgresDataDir, { recursive: true });
  const passwordFile = path.join(paths.runDir, "postgres-password.txt");
  await fsp.writeFile(passwordFile, `${config.postgresPassword}\n`, "utf8");

  try {
    scriptLog(scope, `initializing managed postgres cluster at ${paths.postgresDataDir}`);
    await runCommand(runtime.initdbPath, [
      "-D",
      paths.postgresDataDir,
      "-U",
      config.postgresUser,
      "-A",
      "scram-sha-256",
      "--pwfile",
      passwordFile,
      "--encoding=UTF8"
    ], {
      completionEvent: "exit"
    });
  } finally {
    await fsp.rm(passwordFile, { force: true });
  }
}

async function readManagedPostmasterState(paths) {
  const pidFile = path.join(paths.postgresDataDir, "postmaster.pid");
  let content = "";

  try {
    content = await fsp.readFile(pidFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 4) {
    return null;
  }

  const pid = Number(lines[0]);
  const port = Number(lines[3]);
  if (!Number.isFinite(pid) || !Number.isFinite(port)) {
    return null;
  }

  return {
    pid,
    port,
    dataDir: lines[1] || "",
    status: lines[5] || ""
  };
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function resolveRunningManagedPostgresPort(paths, scope) {
  const state = await readManagedPostmasterState(paths);
  if (!state) {
    return null;
  }

  if (!isProcessAlive(state.pid)) {
    scriptWarn(scope, `managed postgres pid file is stale: pid=${state.pid} port=${state.port}`);
    return null;
  }

  const adminDatabaseUrl = buildManagedAdminDatabaseUrl(state.port);
  const ready = await getDatabaseStatus({ databaseUrl: adminDatabaseUrl });
  if (!ready.ok) {
    scriptWarn(
      scope,
      `managed postgres pid file points to port ${state.port}, but readiness check failed: ${ready.errorCode || ready.errorMessage}`
    );
    return null;
  }

  scriptLog(scope, `reusing managed postgres already running at ${adminDatabaseUrl}`);
  return state.port;
}

async function isTcpPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function resolveManagedPostgresPort(scope) {
  const preferredPort = DEFAULT_MANAGED_POSTGRES_PORT;
  if (await isTcpPortAvailable(preferredPort)) {
    scriptLog(scope, `managed postgres will use preferred port ${preferredPort}`);
    return preferredPort;
  }

  const allocatedPort = await allocateLoopbackPort();
  scriptWarn(
    scope,
    `managed postgres preferred port ${preferredPort} is busy, falling back to ${allocatedPort}`
  );
  return allocatedPort;
}

async function ensureManagedServerStarted(runtime, paths, scope, port) {
  const adminDatabaseUrl = buildManagedAdminDatabaseUrl(port);
  scriptLog(scope, `checking managed postgres readiness at ${adminDatabaseUrl}`);
  const ready = await getDatabaseStatus({ databaseUrl: adminDatabaseUrl });
  if (ready.ok) {
    scriptLog(scope, `managed postgres already running at ${adminDatabaseUrl}`);
    return false;
  }

  scriptLog(scope, `starting managed postgres on port ${port}`);
  await runCommand(runtime.pgCtlPath, [
    "-D",
    paths.postgresDataDir,
    "-l",
    paths.postgresLogFile,
    "-o",
    `-p ${port} -h 127.0.0.1`,
    "start"
  ], {
    completionEvent: "exit"
  });

  await waitForDatabaseReady({
    databaseUrl: adminDatabaseUrl,
    scope,
    timeoutMs: 90000,
    intervalMs: 1500
  });
  scriptLog(scope, "managed postgres admin database is ready");

  return true;
}

async function ensureManagedDatabaseExists(scope, port) {
  const adminUrl = buildManagedAdminDatabaseUrl(port);
  scriptLog(scope, `ensuring managed application database ${config.postgresDb}`);
  const existing = await runSql(
    adminUrl,
    "select 1 from pg_database where datname = $1;",
    [config.postgresDb]
  );

  if (existing.rowCount) {
    scriptLog(scope, `managed database ${config.postgresDb} already exists`);
    return;
  }

  scriptLog(scope, `creating managed database ${config.postgresDb}`);
  await runSql(adminUrl, `create database "${config.postgresDb.replace(/"/g, "\"\"")}"`);
  scriptLog(scope, `managed database ${config.postgresDb} created`);
}

function buildMissingRuntimeError(runtime) {
  const lines = [
    "Desktop managed PostgreSQL runtime is not available.",
    "Expected PostgreSQL binaries: initdb, pg_ctl, pg_isready.",
    "Searched locations:"
  ];

  for (const binDir of runtime.searchedBinDirs || []) {
    lines.push(`- ${binDir}`);
  }

  lines.push("You can provide a runtime by setting DESKTOP_POSTGRES_BIN_DIR.");
  return new Error(lines.join("\n"));
}

async function prepareManagedDatabase(paths, scope) {
  const runtime = detectManagedPostgresRuntime();
  if (!runtime.available) {
    throw buildMissingRuntimeError(runtime);
  }

  await ensureManagedClusterInitialized(runtime, paths, scope);
  const runningPort = await resolveRunningManagedPostgresPort(paths, scope);
  const managedPort = runningPort || await resolveManagedPostgresPort(scope);
  const startedManagedProcess = await ensureManagedServerStarted(
    runtime,
    paths,
    scope,
    managedPort
  );
  await ensureManagedDatabaseExists(scope, managedPort);

  const env = buildManagedDesktopEnv(paths, managedPort);
  scriptLog(scope, `running managed database migrations against ${env.DATABASE_URL}`);
  await runPendingMigrations({
    databaseUrl: env.DATABASE_URL,
    onLog: (message) => scriptLog(scope, `migration ${message}`)
  });
  scriptLog(scope, "managed database migrations completed");

  return {
    envOverrides: env,
    databaseMode: "managed",
    runtime,
    startedManagedProcess
  };
}

async function prepareExistingDatabase(paths, scope) {
  const databaseUrl = process.env.DATABASE_URL || config.databaseUrl;
  const status = await getDatabaseStatus({ databaseUrl });
  if (!status.ok) {
    return null;
  }

  scriptLog(scope, `reusing existing database at ${databaseUrl}`);
  await runPendingMigrations({
    databaseUrl,
    onLog: (message) => scriptLog(scope, `migration ${message}`)
  });

  return {
    envOverrides: buildDesktopEnv(paths, {
      DATABASE_URL: databaseUrl
    }),
    databaseMode: "existing"
  };
}

async function prepareDockerDatabase(paths, scope) {
  scriptWarn(scope, "falling back to Docker-managed PostgreSQL for desktop development");
  await dockerComposeUp({
    service: config.databaseDockerService,
    scope
  });
  await waitForDatabaseReady({
    databaseUrl: process.env.DATABASE_URL || config.databaseUrl,
    scope
  });
  await runPendingMigrations({
    databaseUrl: process.env.DATABASE_URL || config.databaseUrl,
    onLog: (message) => scriptLog(scope, `migration ${message}`)
  });

  return {
    envOverrides: buildDesktopEnv(paths, {
      DATABASE_URL: process.env.DATABASE_URL || config.databaseUrl
    }),
    databaseMode: "docker"
  };
}

export async function prepareDesktopRuntime({
  scope = "desktop:runtime"
} = {}) {
  const paths = getDesktopRuntimePaths();
  const managedMode = String(process.env.DESKTOP_DATABASE_MODE || "auto").toLowerCase();
  const allowDockerFallback = readBooleanEnv("DESKTOP_ALLOW_DOCKER_FALLBACK", true);

  await applyPendingDesktopReset(paths, scope);
  await ensureDesktopRuntimeDirs(paths);
  await seedDesktopWorkspace(paths, scope);
  scriptLog(scope, `desktop data dir: ${paths.baseDir}`);

  if (managedMode !== "managed") {
    const existing = await prepareExistingDatabase(paths, scope);
    if (existing) {
      return {
        paths,
        ...existing
      };
    }
  }

  if (managedMode !== "external") {
    try {
      const managed = await prepareManagedDatabase(paths, scope);
      return {
        paths,
        ...managed
      };
    } catch (error) {
      if (managedMode === "managed") {
        throw error;
      }

      scriptWarn(scope, error.message || String(error));
    }
  }

  if (allowDockerFallback) {
    const docker = await prepareDockerDatabase(paths, scope);
    return {
      paths,
      ...docker
    };
  }

  throw new Error(
    [
      "Desktop runtime could not find a usable PostgreSQL environment.",
      "Tried in order: existing DATABASE_URL, managed postgres binaries, Docker fallback.",
      "Set DESKTOP_DATABASE_MODE=managed with DESKTOP_POSTGRES_BIN_DIR to force local managed mode."
    ].join("\n")
  );
}

export async function stopManagedDesktopDatabase(runtime, paths, scope = "desktop:runtime") {
  if (!runtime?.pgCtlPath || !paths?.postgresDataDir) {
    return;
  }

  try {
    await runCommand(runtime.pgCtlPath, [
      "-D",
      paths.postgresDataDir,
      "stop",
      "-m",
      "fast"
    ], {
      completionEvent: "exit"
    });
    scriptLog(scope, "managed postgres stopped");
  } catch (error) {
    scriptWarn(scope, `failed to stop managed postgres\n${error.message || String(error)}`);
  }
}

export async function scheduleDesktopRuntimeReset(scope = "desktop:runtime") {
  const paths = getDesktopRuntimePaths();
  await ensureDesktopRuntimeDirs(paths);

  const markerPath = getDesktopResetMarkerPath(paths);
  const payload = {
    requestedAt: new Date().toISOString(),
    type: "full_reset"
  };

  await fsp.writeFile(markerPath, JSON.stringify(payload, null, 2), "utf8");
  scriptWarn(scope, `scheduled desktop runtime reset on next start: ${markerPath}`);

  return {
    ok: true,
    markerPath,
    requestedAt: payload.requestedAt,
    restartRequired: true,
    confirmationText: DESKTOP_RESET_CONFIRMATION_TEXT
  };
}
