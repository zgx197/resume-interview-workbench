import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";
import { vendorPostgresRuntime } from "./desktop-postgres-vendor.js";
import { getDesktopRuntimePaths } from "./desktop-runtime.js";

const DEFAULT_POSTGRES_VERSION = process.env.DESKTOP_POSTGRES_VERSION || "17.9-2";
const DEFAULT_PGVECTOR_TAG = process.env.DESKTOP_PGVECTOR_VERSION || "v0.8.1";
const CACHE_DIR = path.join(config.repoRoot, ".desktop-cache");
const INSTALLER_NAME = `postgresql-${DEFAULT_POSTGRES_VERSION}-windows-x64.exe`;
const INSTALLER_URL = `https://get.enterprisedb.com/postgresql/${INSTALLER_NAME}`;
const INSTALLER_PATH = path.join(CACHE_DIR, INSTALLER_NAME);
const EXTRACT_DIR = path.join(CACHE_DIR, "postgres-runtime-src");
const PGVECTOR_DIR = path.join(CACHE_DIR, "pgvector-src");
const VCVARS64_PATH = process.env.DESKTOP_VCVARS64_PATH
  || "D:\\VS2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat";

function log(message) {
  console.log(`[desktop:postgres:prepare] ${message}`);
}

function fail(message) {
  console.error(`[desktop:postgres:prepare] ${message}`);
  process.exit(1);
}

function readBooleanArg(flag) {
  return process.argv.includes(flag);
}

async function ensureCacheDir() {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
}

async function downloadInstaller() {
  if (fs.existsSync(INSTALLER_PATH)) {
    log(`installer already cached: ${INSTALLER_PATH}`);
    return;
  }

  log(`downloading PostgreSQL installer ${INSTALLER_URL}`);
  const response = await fetch(INSTALLER_URL);
  if (!response.ok || !response.body) {
    throw new Error(`failed to download installer: ${response.status} ${response.statusText}`);
  }

  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(INSTALLER_PATH)
  );
}

function runStreaming(command, args, { cwd = config.repoRoot, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`command failed (${code}): ${command} ${args.join(" ")}`));
    });
  });
}

async function extractInstaller(force = false) {
  if (force) {
    await fsp.rm(EXTRACT_DIR, { recursive: true, force: true });
  }

  if (fs.existsSync(path.join(EXTRACT_DIR, "bin", "initdb.exe"))) {
    log(`runtime already extracted: ${EXTRACT_DIR}`);
    return;
  }

  log(`extracting PostgreSQL installer to ${EXTRACT_DIR}`);
  await runStreaming(INSTALLER_PATH, [
    "--mode", "unattended",
    "--unattendedmodeui", "none",
    "--extract-only", "yes",
    "--install_runtimes", "no",
    "--prefix", EXTRACT_DIR
  ]);
}

async function ensurePgvectorSource(force = false) {
  if (force) {
    await fsp.rm(PGVECTOR_DIR, { recursive: true, force: true });
  }

  if (fs.existsSync(path.join(PGVECTOR_DIR, "Makefile.win"))) {
    log(`pgvector source already present: ${PGVECTOR_DIR}`);
    return;
  }

  log(`cloning pgvector ${DEFAULT_PGVECTOR_TAG}`);
  await runStreaming("git", [
    "clone",
    "--depth", "1",
    "--branch", DEFAULT_PGVECTOR_TAG,
    "https://github.com/pgvector/pgvector",
    PGVECTOR_DIR
  ]);
}

async function buildPgvector(force = false) {
  const vectorDll = path.join(EXTRACT_DIR, "lib", "vector.dll");
  if (!force && fs.existsSync(vectorDll)) {
    log(`pgvector already built into runtime: ${vectorDll}`);
    return;
  }

  if (!fs.existsSync(VCVARS64_PATH)) {
    throw new Error(`vcvars64.bat not found: ${VCVARS64_PATH}`);
  }

  log(`building pgvector into ${EXTRACT_DIR}`);
  const command = [
    `call "${VCVARS64_PATH}"`,
    `set "PGROOT=${EXTRACT_DIR}"`,
    `cd /d "${PGVECTOR_DIR}"`,
    "nmake /F Makefile.win clean",
    "nmake /F Makefile.win",
    "nmake /F Makefile.win install"
  ].join(" && ");

  await runStreaming("cmd.exe", ["/c", command], {
    env: {
      ...process.env,
      PGROOT: EXTRACT_DIR
    }
  });
}

async function stopManagedPostgresIfRunning() {
  const pgCtlPath = path.join(
    config.repoRoot,
    "src-tauri",
    "resources",
    "postgres",
    "windows-x64",
    "bin",
    "pg_ctl.exe"
  );
  const runtimePaths = getDesktopRuntimePaths();

  if (!fs.existsSync(pgCtlPath) || !fs.existsSync(runtimePaths.postgresDataDir)) {
    return;
  }

  log("attempting to stop existing managed PostgreSQL before replacing runtime files");
  try {
    await runStreaming(pgCtlPath, [
      "-D",
      runtimePaths.postgresDataDir,
      "stop",
      "-m",
      "fast"
    ]);
  } catch {
    // It's fine if the managed instance isn't running.
  }
}

async function main() {
  if (process.platform !== "win32") {
    fail("desktop-postgres-prepare is currently only implemented for Windows.");
  }

  const force = readBooleanArg("--force");
  await ensureCacheDir();
  await downloadInstaller();
  await extractInstaller(force);
  await ensurePgvectorSource(force);
  await buildPgvector(force);
  await stopManagedPostgresIfRunning();
  await vendorPostgresRuntime(EXTRACT_DIR);
  log("portable PostgreSQL runtime is ready for the desktop build");
}

main().catch((error) => {
  fail(error.message || String(error));
});
