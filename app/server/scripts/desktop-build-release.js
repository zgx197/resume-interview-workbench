import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { config } from "../config.js";

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function runNodeScript(scriptRelativePath, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptRelativePath], {
      cwd: config.repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptRelativePath} failed with exit code ${code}`));
    });
  });
}

async function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], {
      cwd: config.repoRoot,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`PowerShell command failed with exit code ${code}`));
    });
  });
}

async function ensureCleanPortableBundle(portableDir) {
  const runtimeDir = path.join(portableDir, "resources", "app-runtime");
  const forbiddenResumeDir = path.join(runtimeDir, "resume-package");
  const forbiddenTemplateDir = path.join(runtimeDir, "interview-kit", "templates");

  try {
    await fs.access(forbiddenResumeDir);
    throw new Error(`Release bundle still contains forbidden resume-package directory: ${forbiddenResumeDir}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await fs.access(forbiddenTemplateDir);
    throw new Error(`Release bundle still contains forbidden template directory: ${forbiddenTemplateDir}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const seedReadme = path.join(runtimeDir, "desktop-seed", "resume-package", "README.md");
  await fs.access(seedReadme);
}

async function zipPortableBundle(portableDir) {
  const zipPath = `${portableDir}.zip`;
  const escapedPortableDir = portableDir.replace(/'/g, "''");
  const escapedZipPath = zipPath.replace(/'/g, "''");

  await runPowerShell(
    [
      `$source = '${escapedPortableDir}'`,
      `$zip = '${escapedZipPath}'`,
      "if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }",
      "Compress-Archive -Path $source -DestinationPath $zip -CompressionLevel Optimal"
    ].join("; ")
  );

  return zipPath;
}

async function main() {
  const stamp = timestamp();
  const portableDir = path.join(
    config.repoRoot,
    ".desktop-dist",
    `ResumeInterviewWorkbench-portable-win-x64-${stamp}`
  );

  await runNodeScript("app/server/scripts/desktop-build-portable.js", {
    DESKTOP_PORTABLE_OUTPUT_DIR: path.relative(config.repoRoot, portableDir)
  });

  await ensureCleanPortableBundle(portableDir);
  const zipPath = await zipPortableBundle(portableDir);

  console.log(`[desktop:build:release] portableDir=${portableDir}`);
  console.log(`[desktop:build:release] zipPath=${zipPath}`);
}

await main();
