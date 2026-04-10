import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { config } from "../config.js";
import { scriptLog } from "./script-helpers.js";

const scope = "desktop:build:portable";
const envPath = process.env.PATH || process.env.Path || "";
const tauriCli = process.platform === "win32"
  ? path.resolve(config.repoRoot, "node_modules", ".bin", "tauri.cmd")
  : path.resolve(config.repoRoot, "node_modules", ".bin", "tauri");
const defaultPortableDir = path.join(
  config.repoRoot,
  ".desktop-dist",
  "ResumeInterviewWorkbench-portable-win-x64"
);
const releaseExe = path.join(config.repoRoot, "src-tauri", "target", "release", "resume-interview-workbench-desktop.exe");
const customPortableDir = process.env.DESKTOP_PORTABLE_OUTPUT_DIR
  ? path.resolve(config.repoRoot, process.env.DESKTOP_PORTABLE_OUTPUT_DIR)
  : "";
const forceTimestampOutput = String(process.env.DESKTOP_PORTABLE_FORCE_TIMESTAMP || "false").toLowerCase() === "true";

function withRustEnv() {
  const candidates = [
    process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME, "bin") : "",
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".cargo", "bin") : "",
    process.env.HOME ? path.join(process.env.HOME, ".cargo", "bin") : "",
    path.join(os.homedir(), ".cargo", "bin")
  ].filter(Boolean);
  if (process.platform === "win32") {
    const usersRoot = path.join(path.parse(os.homedir()).root, "Users");
    if (fs.existsSync(usersRoot)) {
      for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        candidates.push(path.join(usersRoot, entry.name, ".cargo", "bin"));
      }
    }
  }
  const userCargoBin = candidates.find((candidate) => fs.existsSync(path.join(candidate, process.platform === "win32" ? "cargo.exe" : "cargo"))) || "";
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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: config.repoRoot,
      stdio: "inherit",
      env: withRustEnv()
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function buildPortableOutputDir() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");

  return path.join(
    config.repoRoot,
    ".desktop-dist",
    `ResumeInterviewWorkbench-portable-win-x64-${stamp}`
  );
}

async function resolvePortableOutputDir() {
  if (customPortableDir) {
    return customPortableDir;
  }

  if (forceTimestampOutput) {
    return buildPortableOutputDir();
  }

  try {
    await fsp.access(defaultPortableDir);
    return buildPortableOutputDir();
  } catch {
    return defaultPortableDir;
  }
}

async function stagePortableOutput(portableDir) {
  const resourceTargetDir = path.join(portableDir, "resources");

  await fsp.mkdir(portableDir, { recursive: true });
  await fsp.copyFile(releaseExe, path.join(portableDir, "resume-interview-workbench-desktop.exe"));
  await fsp.cp(path.join(config.repoRoot, "src-tauri", "resources"), resourceTargetDir, {
    recursive: true,
    force: true
  });
}

async function main() {
  scriptLog(scope, "preparing portable desktop resources");
  await runCommand(process.execPath, ["app/server/scripts/desktop-node-vendor.js"]);
  await runCommand(process.execPath, ["app/server/scripts/desktop-app-runtime-vendor.js"]);

  scriptLog(scope, "building tauri desktop binary");
  if (process.platform === "win32") {
    await runCommand("cmd.exe", ["/c", tauriCli, "build", "--no-bundle"]);
  } else {
    await runCommand(tauriCli, ["build", "--no-bundle"]);
  }

  scriptLog(scope, "staging portable output");
  const portableDir = await resolvePortableOutputDir();
  await stagePortableOutput(portableDir);
  scriptLog(scope, `portableDir=${portableDir}`);
}

await main();
