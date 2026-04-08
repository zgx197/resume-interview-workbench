import { spawn } from "node:child_process";
import { config } from "../config.js";
import { loadEnvFile } from "../env.js";
import { scriptError, scriptLog } from "./script-helpers.js";

function runNodeScript(scriptRelativePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptRelativePath], {
      cwd: config.repoRoot,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Script failed with exit code ${code}: ${scriptRelativePath}`));
    });
  });
}

async function main() {
  await loadEnvFile();
  scriptLog("setup:local", "step 1/3 starting database");
  await runNodeScript("app/server/scripts/db-up.js");
  scriptLog("setup:local", "step 2/3 running migrations");
  await runNodeScript("app/server/scripts/migrate.js");
  scriptLog("setup:local", "step 3/3 running check");
  await runNodeScript("app/server/scripts/check.js");
  scriptLog("setup:local", "local environment is ready");
}

main().catch((error) => {
  scriptError("setup:local", error.message || String(error));
  process.exitCode = 1;
});
