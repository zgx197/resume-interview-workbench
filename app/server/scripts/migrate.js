import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "../config.js";
import { loadEnvFile } from "../env.js";

const MIGRATION_TABLE = "schema_migrations";
const DOCKER_COMMAND = process.platform === "win32" ? "docker.exe" : "docker";

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runCommand(command, args, { input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: config.repoRoot,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(
        `Command failed with exit code ${code}: ${command} ${args.join(" ")}${stderr ? `\n${stderr.trim()}` : ""}`
      );
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    if (input != null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function buildPsqlArgs(extraArgs = []) {
  return [
    "compose",
    "exec",
    "-T",
    config.databaseDockerService,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    config.postgresUser,
    "-d",
    config.postgresDb,
    ...extraArgs
  ];
}

async function ensureMigrationTable() {
  const sql = `
create table if not exists ${MIGRATION_TABLE} (
  filename text primary key,
  applied_at timestamptz not null default now()
);
`;

  await runCommand(DOCKER_COMMAND, buildPsqlArgs(), { input: sql });
}

async function readAppliedMigrations() {
  const query = `select filename from ${MIGRATION_TABLE} order by filename;`;
  const { stdout } = await runCommand(DOCKER_COMMAND, buildPsqlArgs(["-At", "-c", query]));
  return new Set(
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

async function listMigrationFiles() {
  const entries = await fs.readdir(config.dbMigrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function applyMigration(filename) {
  const filePath = path.join(config.dbMigrationsDir, filename);
  const sql = await fs.readFile(filePath, "utf8");

  console.log(`[db:migrate] applying ${filename}`);
  await runCommand(DOCKER_COMMAND, buildPsqlArgs(), { input: sql });

  const insertSql = `
insert into ${MIGRATION_TABLE} (filename)
values (${quoteSqlString(filename)})
on conflict (filename) do nothing;
`;
  await runCommand(DOCKER_COMMAND, buildPsqlArgs(), { input: insertSql });
}

async function main() {
  await loadEnvFile();

  console.log(`[db:migrate] databaseUrl=${config.databaseUrl}`);
  console.log(`[db:migrate] dockerService=${config.databaseDockerService}`);
  console.log(`[db:migrate] migrationsDir=${config.dbMigrationsDir}`);

  await ensureMigrationTable();
  const applied = await readAppliedMigrations();
  const files = await listMigrationFiles();
  const pending = files.filter((filename) => !applied.has(filename));

  if (!pending.length) {
    console.log("[db:migrate] no pending migrations");
    return;
  }

  for (const filename of pending) {
    await applyMigration(filename);
  }

  console.log(`[db:migrate] applied ${pending.length} migration(s)`);
}

main().catch((error) => {
  console.error("[db:migrate] failed");
  console.error(error);
  process.exitCode = 1;
});
