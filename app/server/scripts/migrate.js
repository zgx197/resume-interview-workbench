import { loadEnvFile } from "../env.js";
import { config } from "../config.js";
import { runPendingMigrations } from "../db/migration-runner.js";

async function main() {
  await loadEnvFile();

  console.log(`[db:migrate] databaseUrl=${config.databaseUrl}`);
  console.log(`[db:migrate] migrationsDir=${config.dbMigrationsDir}`);

  const result = await runPendingMigrations({
    onLog: (message) => {
      console.log(`[db:migrate] ${message}`);
    }
  });

  if (!result.appliedCount) {
    console.log("[db:migrate] no pending migrations");
    return;
  }

  console.log(`[db:migrate] applied ${result.appliedCount} migration(s)`);
}

main().catch((error) => {
  console.error("[db:migrate] failed");
  console.error(error);
  process.exitCode = 1;
});
