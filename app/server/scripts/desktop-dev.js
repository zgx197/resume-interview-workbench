import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const envPath = process.env.PATH || process.env.Path || "";

function resolveCargoBinDir() {
  const candidates = [
    process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME, "bin") : "",
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".cargo", "bin") : "",
    process.env.HOME ? path.join(process.env.HOME, ".cargo", "bin") : "",
    path.join(os.homedir(), ".cargo", "bin")
  ].filter(Boolean);

  if (process.platform === "win32") {
    const usersRoot = path.join(path.parse(os.homedir()).root, "Users");
    if (fs.existsSync(usersRoot)) {
      for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        candidates.push(path.join(usersRoot, entry.name, ".cargo", "bin"));
      }
    }
  }

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, process.platform === "win32" ? "cargo.exe" : "cargo"))) || "";
}

const userCargoBin = resolveCargoBinDir();

function resolveBinary(name) {
  const exeName = process.platform === "win32" ? `${name}.exe` : name;
  const candidate = path.join(userCargoBin, exeName);
  return candidate;
}

function withRustEnv() {
  const nextPath = envPath.includes(userCargoBin) ? envPath : `${userCargoBin}${path.delimiter}${envPath}`;
  return {
    ...process.env,
    CARGO_HOME: process.env.CARGO_HOME || path.join(process.env.USERPROFILE || "", ".cargo"),
    RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(process.env.USERPROFILE || "", ".rustup"),
    PATH: nextPath,
    Path: nextPath
  };
}

function hasBinary(name, args = ["--version"]) {
  const resolvedCommand = path.resolve(resolveBinary(name));
  const result = spawnSync(resolvedCommand, args, {
    encoding: "utf8",
    env: withRustEnv()
  });

  return !result.error && result.status === 0;
}

function resolveTauriCli() {
  return process.platform === "win32"
    ? path.resolve(process.cwd(), "node_modules", ".bin", "tauri.cmd")
    : path.resolve(process.cwd(), "node_modules", ".bin", "tauri");
}

function fail(message) {
  console.error(`[desktop:dev] ${message}`);
  process.exit(1);
}

function main() {
  if (!hasBinary("cargo") || !hasBinary("rustc")) {
    fail("Rust toolchain is not ready. Please install cargo + rustc, then rerun npm run desktop:dev.");
  }

  console.log("[desktop:dev] Starting Tauri desktop dev mode...");
  console.log("[desktop:dev] The first Rust/Tauri compile may take a while. This is expected.");

  const tauriCli = resolveTauriCli();
  const [exec, execArgs] = process.platform === "win32"
    ? ["cmd.exe", ["/c", tauriCli, "dev"]]
    : [tauriCli, ["dev"]];

  const child = spawn(exec, execArgs, {
    stdio: "inherit",
    env: withRustEnv()
  });

  child.on("error", (error) => {
    fail(`Failed to start local Tauri CLI: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
      return;
    }

    process.exit(code ?? 0);
  });
}

main();
