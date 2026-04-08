import { closeDbPool } from "../db/client.js";
import { loadEnvFile } from "../env.js";
import { config } from "../config.js";
import { dockerComposeUp, scriptError, scriptLog, waitForDatabaseReady } from "./script-helpers.js";

async function main() {
  await loadEnvFile();
  scriptLog("db:up", `databaseUrl=${config.databaseUrl}`);
  scriptLog("db:up", `dockerService=${config.databaseDockerService}`);
  await dockerComposeUp({
    service: config.databaseDockerService,
    scope: "db:up"
  });
  await waitForDatabaseReady({
    scope: "db:up"
  });
  scriptLog("db:up", "database is ready");
}

main()
  .catch((error) => {
    scriptError("db:up", error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
