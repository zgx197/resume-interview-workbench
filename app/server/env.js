import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

function resolveEnvCandidates() {
  return [
    process.env.ENV_FILE,
    process.env.DESKTOP_ENV_FILE,
    path.join(config.repoRoot, ".env")
  ].filter(Boolean);
}

// Only backfill missing variables from the first available env file so
// host-provided environment values still take precedence.
export async function loadEnvFile() {
  for (const envPath of resolveEnvCandidates()) {
    try {
      const raw = await fs.readFile(envPath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }

        const separator = trimmed.indexOf("=");
        if (separator === -1) {
          continue;
        }

        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        if (key && !(key in process.env)) {
          process.env[key] = value;
        }
      }
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
