import { spawn } from "node:child_process";
import { Client } from "pg";
import { config } from "../config.js";

export const DOCKER_COMMAND = process.platform === "win32" ? "docker.exe" : "docker";

export function scriptLog(scope, message) {
  console.log(`[${scope}] ${message}`);
}

export function scriptWarn(scope, message) {
  console.warn(`[${scope}] ${message}`);
}

export function scriptError(scope, message) {
  console.error(`[${scope}] ${message}`);
}

export function runCommand(command, args, {
  cwd = config.repoRoot,
  env = process.env,
  input = null
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"]
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
        resolve({ stdout, stderr, code });
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

    if (input != null && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

export async function ensureDockerDaemon(scope = "docker") {
  try {
    await runCommand(DOCKER_COMMAND, ["version"]);
    return true;
  } catch (error) {
    const details = String(error.stderr || error.message || "").trim();
    throw new Error(
      [
        "Docker daemon is not reachable.",
        "Please start Docker Desktop (or another Docker daemon) first.",
        details || "docker version failed."
      ].join("\n")
    );
  }
}

export async function dockerComposeUp({
  service = config.databaseDockerService,
  scope = "db:up"
} = {}) {
  scriptLog(scope, `starting docker service ${service}`);
  await ensureDockerDaemon(scope);
  await runCommand(DOCKER_COMMAND, ["compose", "up", "-d", service]);
}

export async function waitForDatabaseReady({
  databaseUrl = config.databaseUrl,
  timeoutMs = 90000,
  intervalMs = 1500,
  scope = "db:up"
} = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await runSql(databaseUrl, "select 1 as ok;");
      scriptLog(scope, `database ready at ${databaseUrl}`);
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(
    [
      `Database did not become ready within ${timeoutMs}ms.`,
      `Expected url: ${databaseUrl}`,
      `Last error: ${lastError?.code || lastError?.message || "unknown"}`
    ].join("\n")
  );
}

export async function getDatabaseStatus({
  databaseUrl = config.databaseUrl
} = {}) {
  try {
    await runSql(databaseUrl, "select 1 as ok;");
    return {
      ok: true,
      databaseUrl
    };
  } catch (error) {
    return {
      ok: false,
      databaseUrl,
      errorCode: error?.code || null,
      errorMessage: error?.message || "unknown error"
    };
  }
}

export async function runSql(databaseUrl, sql, params = []) {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
  });

  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}
