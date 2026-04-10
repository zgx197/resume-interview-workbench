import { spawnSync } from "node:child_process";
import process from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
import fs from "node:fs";
import { loadEnvFile } from "../env.js";
import { getDatabaseStatus, scriptWarn } from "./script-helpers.js";
import {
  detectManagedPostgresRuntime,
  getDesktopRuntimePaths
} from "./desktop-runtime.js";

const userCargoBin = path.join(process.env.USERPROFILE || "", ".cargo", "bin");
const envPath = process.env.PATH || process.env.Path || "";

function resolveBinary(name) {
  const exeName = process.platform === "win32" ? `${name}.exe` : name;
  const candidate = path.join(userCargoBin, exeName);
  return existsSync(candidate) ? candidate : name;
}

function withRustEnv() {
  const nextPath = envPath.includes(userCargoBin) ? envPath : `${userCargoBin}${path.delimiter}${envPath}`;
  return {
    ...process.env,
    CARGO_HOME: process.env.CARGO_HOME || path.join(process.env.USERPROFILE || "", ".cargo"),
    RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(process.env.USERPROFILE || "", ".rustup"),
    PATH: nextPath,
    Path: nextPath
  };
}

function runCommand(command, args) {
  const resolvedCommand = resolveBinary(command);
  const [exec, execArgs] = process.platform === "win32"
    ? ["cmd.exe", ["/c", resolvedCommand, ...args]]
    : [resolvedCommand, args];

  const result = spawnSync(exec, execArgs, {
    encoding: "utf8",
    env: withRustEnv()
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return (result.stdout || result.stderr || "").trim();
}

function printLine(message) {
  console.log(`[desktop:doctor] ${message}`);
}

function checkBinary(name, args = ["--version"]) {
  const output = runCommand(name, args);
  if (!output) {
    printLine(`${name}: missing`);
    return false;
  }

  printLine(`${name}: ${output}`);
  return true;
}

function checkNodeModule(modulePath) {
  const resolved = path.resolve(process.cwd(), modulePath);
  const present = existsSync(resolved);
  printLine(`${modulePath}: ${present ? "present" : "missing"}`);
  return present;
}

function main() {
  return loadEnvFile().then(async () => {
    const runtimePaths = getDesktopRuntimePaths();
    const managedRuntime = detectManagedPostgresRuntime();
    const configuredDbUrl = process.env.DATABASE_URL || "";
    const dbStatus = configuredDbUrl
      ? await getDatabaseStatus({ databaseUrl: configuredDbUrl })
      : { ok: false };

    const cargoReady = checkBinary("cargo");
    const rustcReady = checkBinary("rustc");
    const tauriCliReady = checkNodeModule("node_modules/@tauri-apps/cli");
    const tauriConfigReady = checkNodeModule("src-tauri/tauri.conf.json");

    printLine(`desktopDataDir: ${runtimePaths.baseDir}`);
    printLine(`managedPostgres: ${managedRuntime.available ? `ready (${managedRuntime.binDir})` : "missing"}`);
    const bundledManifestPath = path.resolve(
      process.cwd(),
      "src-tauri",
      "resources",
      "postgres",
      "windows-x64",
      "manifest.json"
    );
    printLine(`bundledPostgresRuntime: ${fs.existsSync(bundledManifestPath) ? bundledManifestPath : "not staged"}`);
    if (!managedRuntime.available) {
      scriptWarn(
        "desktop:doctor",
        "managed PostgreSQL binaries not found; desktop dev will reuse an existing DATABASE_URL or fall back to Docker."
      );
    }

    if (configuredDbUrl) {
      printLine(`databaseUrl: ${configuredDbUrl}`);
      printLine(`databaseReachable: ${dbStatus.ok ? "yes" : "no"}`);
    }

    if (cargoReady && rustcReady && tauriCliReady && tauriConfigReady) {
      printLine("desktop MVP 2 prerequisites look ready.");
      return;
    }

    printLine("desktop MVP 2 prerequisites are incomplete.");
    printLine("Next steps:");
    if (!cargoReady || !rustcReady) {
      printLine("- Install Rust toolchain (cargo + rustc)");
    }
    if (!tauriCliReady) {
      printLine("- Run npm install to install @tauri-apps/cli");
    }
    if (!tauriConfigReady) {
      printLine("- Ensure src-tauri/tauri.conf.json exists");
    }
    if (!managedRuntime.available) {
      printLine("- Add a PostgreSQL runtime via DESKTOP_POSTGRES_BIN_DIR, or keep a reachable DATABASE_URL / Docker fallback for development");
    }
    printLine("- Run npm run desktop:dev");
    process.exitCode = 1;
  });
}

main().catch((error) => {
  printLine(error.message || String(error));
  process.exitCode = 1;
});
