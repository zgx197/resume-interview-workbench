import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { config } from "../config.js";

const MIGRATION_TABLE = "schema_migrations";

function createClient(databaseUrl = config.databaseUrl) {
  return new Client({
    connectionString: databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
  });
}

export async function listMigrationFiles(migrationsDir = config.dbMigrationsDir) {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function ensureMigrationTable(client) {
  await client.query(`
create table if not exists ${MIGRATION_TABLE} (
  filename text primary key,
  applied_at timestamptz not null default now()
);
`);
}

async function readAppliedMigrations(client) {
  const result = await client.query(`select filename from ${MIGRATION_TABLE} order by filename;`);
  return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(client, filePath, filename) {
  const sql = await fs.readFile(filePath, "utf8");
  await client.query(sql);
  await client.query(
    `
insert into ${MIGRATION_TABLE} (filename)
values ($1)
on conflict (filename) do nothing;
`,
    [filename]
  );
}

export async function runPendingMigrations({
  databaseUrl = config.databaseUrl,
  migrationsDir = config.dbMigrationsDir,
  onLog = null
} = {}) {
  const client = createClient(databaseUrl);
  const log = typeof onLog === "function" ? onLog : () => {};

  await client.connect();
  try {
    await ensureMigrationTable(client);
    const applied = await readAppliedMigrations(client);
    const files = await listMigrationFiles(migrationsDir);
    const pending = files.filter((filename) => !applied.has(filename));

    if (!pending.length) {
      return {
        appliedCount: 0,
        pendingCount: 0,
        pending: []
      };
    }

    for (const filename of pending) {
      log(`applying ${filename}`);
      await applyMigration(client, path.join(migrationsDir, filename), filename);
    }

    return {
      appliedCount: pending.length,
      pendingCount: pending.length,
      pending
    };
  } finally {
    await client.end();
  }
}
