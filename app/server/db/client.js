import { Pool } from "pg";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const dbLogger = createLogger({ component: "db-client" });

let pool = null;

function buildPool() {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
  });
}

export function getDbPool() {
  if (!pool) {
    pool = buildPool();
    pool.on("error", (error) => {
      dbLogger.error("db.pool.error", error);
    });
  }

  return pool;
}

export async function query(text, params = []) {
  return getDbPool().query(text, params);
}

export async function withTransaction(callback) {
  const client = await getDbPool().connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      dbLogger.warn("db.transaction.rollback_failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDbPool() {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;
  await activePool.end();
}
