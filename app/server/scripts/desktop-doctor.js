import { spawnSync } from "node:child_process";
import process from "node:process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { loadEnvFile } from "../env.js";
import { getDatabaseStatus, scriptWarn } from "./script-helpers.js";
import {
  detectManagedPostgresRuntime,
  getDesktopRuntimePaths
} from "./desktop-runtime.js";

const envPath = process.env.PATH || process.env.Path || "";

function resolveCargoBinDir() {
  const candidates = [
    process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME, "bin") : "",
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".cargo", "bin") : "",
    process.env.HOME ? path.join(process.env.HOME, ".cargo", "bin") : "",
    path.join(os.homedir(), ".cargo", "bin")
  ].filter(Boolean);

  if (process.platform === "win32") {
    const usersRoot = path.join(path.parse(os.homedir()).root, "Users");
    if (existsSync(usersRoot)) {
      for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        candidates.push(path.join(usersRoot, entry.name, ".cargo", "bin"));
      }
    }
  }

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

const userCargoBin = resolveCargoBinDir();

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
  const result = spawnSync(resolvedCommand, args, {
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
    const bundledNodeRuntimePath = path.resolve(
      process.cwd(),
      "src-tauri",
      "resources",
      "node",
      "windows-x64",
      process.platform === "win32" ? "node.exe" : "node"
    );
    const bundledAppRuntimePath = path.resolve(
      process.cwd(),
      "src-tauri",
      "resources",
      "app-runtime",
      "app",
      "server",
      "server.js"
    );

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
    printLine(`bundledNodeRuntime: ${fs.existsSync(bundledNodeRuntimePath) ? bundledNodeRuntimePath : "not staged"}`);
    printLine(`bundledAppRuntime: ${fs.existsSync(bundledAppRuntimePath) ? bundledAppRuntimePath : "not staged"}`);
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
      printLine("desktop MVP 3 prerequisites look ready.");
      return;
    }

    printLine("desktop MVP 3 prerequisites are incomplete.");
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
    if (!fs.existsSync(bundledNodeRuntimePath)) {
      printLine("- Run npm run desktop:node:vendor to stage node.exe for packaged portable builds");
    }
    if (!fs.existsSync(bundledAppRuntimePath)) {
      printLine("- Run npm run desktop:app-runtime:vendor to stage the packaged Node app runtime");
    }
    printLine("- Run npm run desktop:dev");
    process.exitCode = 1;
  });
}

main().catch((error) => {
  printLine(error.message || String(error));
  process.exitCode = 1;
});
