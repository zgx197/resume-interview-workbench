import { closeDbPool, query } from "../db/client.js";
import { config } from "../config.js";
import { loadEnvFile } from "../env.js";
import {
  DOCKER_COMMAND,
  ensureDockerDaemon,
  getDatabaseStatus,
  runCommand,
  scriptError,
  scriptLog,
  scriptWarn
} from "./script-helpers.js";
import { listMigrationFiles } from "../db/migration-runner.js";

async function listAppliedMigrations() {
  try {
    const result = await query("select filename from schema_migrations order by filename;");
    return result.rows.map((row) => row.filename);
  } catch (error) {
    if (error?.code === "42P01") {
      return null;
    }
    throw error;
  }
}

async function main() {
  await loadEnvFile();

  scriptLog("db:doctor", `databaseUrl=${config.databaseUrl}`);
  scriptLog("db:doctor", `dockerService=${config.databaseDockerService}`);
  let dockerAvailable = false;

  try {
    await ensureDockerDaemon("db:doctor");
    dockerAvailable = true;
    scriptLog("db:doctor", "docker daemon reachable");
    try {
      const { stdout } = await runCommand(DOCKER_COMMAND, ["compose", "ps"]);
      scriptLog("db:doctor", "docker compose ps");
      console.log(stdout.trim() || "(no containers)");
    } catch (error) {
      scriptWarn("db:doctor", `docker compose ps failed\n${error.message}`);
    }
  } catch (error) {
    scriptLog("db:doctor", `docker unavailable, continuing with direct database checks`);
    if (config.logLevel === "debug") {
      scriptWarn("db:doctor", error.message || String(error));
    }
  }

  const dbStatus = await getDatabaseStatus();
  if (!dbStatus.ok) {
    scriptWarn(
      "db:doctor",
      `database unreachable (${dbStatus.errorCode || "unknown"}): ${dbStatus.errorMessage}`
    );
    process.exitCode = 1;
    return;
  }

  scriptLog("db:doctor", "database connection ok");

  const migrationFiles = await listMigrationFiles();
  const appliedMigrations = await listAppliedMigrations();
  if (appliedMigrations == null) {
    scriptWarn("db:doctor", "schema_migrations table not found; run npm run db:migrate");
    process.exitCode = 1;
    return;
  }

  const pending = migrationFiles.filter((filename) => !appliedMigrations.includes(filename));
  scriptLog(
    "db:doctor",
    `migrations applied=${appliedMigrations.length} pending=${pending.length}`
  );

  if (pending.length) {
    console.log(`Pending migrations: ${pending.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const healthResult = await query(
    `
select
  (select count(*)::int from interview_sessions) as session_count,
  (select count(*)::int from background_jobs) as background_job_count,
  (select count(*)::int from knowledge_documents) as knowledge_document_count,
  (select count(*)::int from review_items) as review_item_count;
`
  );
  const health = healthResult.rows[0] || {};
  scriptLog(
    "db:doctor",
    [
      `sessions=${health.session_count ?? 0}`,
      `backgroundJobs=${health.background_job_count ?? 0}`,
      `knowledgeDocuments=${health.knowledge_document_count ?? 0}`,
      `reviewItems=${health.review_item_count ?? 0}`
    ].join(" ")
  );

  scriptLog("db:doctor", "database environment looks healthy");
  if (!dockerAvailable) {
    scriptLog("db:doctor", "docker is optional for the current reachable database setup");
  }
}

main()
  .catch((error) => {
    scriptError("db:doctor", error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
