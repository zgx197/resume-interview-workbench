import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { config } from "../config.js";
import { scriptLog } from "./script-helpers.js";

const scope = "desktop:node:vendor";
const NODE_RUNTIME_DIR = path.join(config.repoRoot, "src-tauri", "resources", "node", "windows-x64");

async function main() {
  const sourceNode = path.resolve(process.execPath);
  const targetNode = path.join(NODE_RUNTIME_DIR, process.platform === "win32" ? "node.exe" : "node");

  scriptLog(scope, `sourceNode=${sourceNode}`);
  scriptLog(scope, `targetNode=${targetNode}`);

  await fsp.mkdir(NODE_RUNTIME_DIR, { recursive: true });
  await fsp.copyFile(sourceNode, targetNode);

  scriptLog(scope, "desktop node runtime is ready");
}

await main();
