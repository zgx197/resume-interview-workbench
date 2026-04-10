import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { scriptLog } from "./script-helpers.js";

const scope = "desktop:app-runtime:vendor";
const TARGET_DIR = path.join(config.repoRoot, "src-tauri", "resources", "app-runtime");
const COPY_ITEMS = [
  "app",
  path.join("interview-kit", "jobs"),
  path.join("interview-kit", "roles"),
  "desktop-seed",
  "node_modules",
  "package.json"
];

async function copyRuntimeItem(relativePath) {
  const sourcePath = path.join(config.repoRoot, relativePath);
  const targetPath = path.join(TARGET_DIR, relativePath);

  scriptLog(scope, `copying ${relativePath}`);
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.cp(sourcePath, targetPath, {
    recursive: true,
    force: true
  });
}

async function main() {
  scriptLog(scope, `targetDir=${TARGET_DIR}`);
  await fsp.rm(TARGET_DIR, {
    recursive: true,
    force: true
  });
  await fsp.mkdir(TARGET_DIR, { recursive: true });

  for (const item of COPY_ITEMS) {
    await copyRuntimeItem(item);
  }

  scriptLog(scope, "desktop app runtime is ready");
}

await main();
