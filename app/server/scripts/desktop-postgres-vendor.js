import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const REQUIRED_SUBDIRS = ["bin", "lib", "share"];
const REQUIRED_BINARIES = ["initdb", "pg_ctl", "postgres", "pg_isready"];
export const RUNTIME_TARGET_DIR = path.join(
  config.repoRoot,
  "src-tauri",
  "resources",
  "postgres",
  "windows-x64"
);

function binaryName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] || null;
}

function log(message) {
  console.log(`[desktop:postgres:vendor] ${message}`);
}

function fail(message) {
  console.error(`[desktop:postgres:vendor] ${message}`);
  process.exit(1);
}

export function resolveSourceRoot(rawSource) {
  if (!rawSource) {
    return null;
  }

  const resolved = path.resolve(rawSource);
  if (!fs.existsSync(resolved)) {
    throw new Error(`source path does not exist: ${resolved}`);
  }

  if (fs.existsSync(path.join(resolved, "bin")) && fs.existsSync(path.join(resolved, "share"))) {
    return resolved;
  }

  if (path.basename(resolved).toLowerCase() === "bin") {
    const parent = path.dirname(resolved);
    if (fs.existsSync(path.join(parent, "share"))) {
      return parent;
    }
  }

  throw new Error(
    `source path must point to a PostgreSQL runtime root (with bin/lib/share), or its bin directory: ${resolved}`
  );
}

export async function ensureSourceLooksValid(sourceRoot) {
  for (const subdir of REQUIRED_SUBDIRS) {
    const dirPath = path.join(sourceRoot, subdir);
    const stat = await fsp.stat(dirPath).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new Error(`missing required directory: ${dirPath}`);
    }
  }

  for (const binary of REQUIRED_BINARIES) {
    const filePath = path.join(sourceRoot, "bin", binaryName(binary));
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error(`missing required executable: ${filePath}`);
    }
  }
}

async function copyDir(source, target) {
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.cp(source, target, {
    recursive: true,
    force: true
  });
}

async function writeManifest(sourceRoot) {
  const manifestPath = path.join(RUNTIME_TARGET_DIR, "manifest.json");
  const payload = {
    sourceRoot,
    stagedAt: new Date().toISOString(),
    platform: "windows-x64",
    requiredBinaries: REQUIRED_BINARIES.map((name) => binaryName(name))
  };

  await fsp.writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function vendorPostgresRuntime(sourceRoot) {
  await ensureSourceLooksValid(sourceRoot);
  log(`staging PostgreSQL runtime from ${sourceRoot}`);

  for (const subdir of REQUIRED_SUBDIRS) {
    await copyDir(
      path.join(sourceRoot, subdir),
      path.join(RUNTIME_TARGET_DIR, subdir)
    );
  }

  const rootFiles = ["LICENSE", "README.txt", "version.txt"];
  for (const fileName of rootFiles) {
    const sourceFile = path.join(sourceRoot, fileName);
    if (fs.existsSync(sourceFile)) {
      await fsp.copyFile(sourceFile, path.join(RUNTIME_TARGET_DIR, fileName));
    }
  }

  await writeManifest(sourceRoot);
  log(`runtime staged at ${RUNTIME_TARGET_DIR}`);
}

async function main() {
  const sourceArg = readArg("--source");
  const sourceRoot = resolveSourceRoot(
    sourceArg
    || process.env.DESKTOP_POSTGRES_SOURCE_DIR
    || process.env.DESKTOP_POSTGRES_BIN_DIR
  );

  if (!sourceRoot) {
    fail(
      [
        "missing PostgreSQL source directory.",
        "Usage:",
        "  npm run desktop:postgres:vendor -- --source C:\\path\\to\\PostgreSQL\\17",
        "or set DESKTOP_POSTGRES_SOURCE_DIR."
      ].join("\n")
    );
  }

  await vendorPostgresRuntime(sourceRoot);
}

const entryFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entryFilePath) {
  main().catch((error) => {
    fail(error.message || String(error));
  });
}
