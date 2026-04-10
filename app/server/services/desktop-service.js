import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  DESKTOP_RESET_CONFIRMATION_TEXT,
  getDesktopRuntimePaths,
  scheduleDesktopRuntimeReset
} from "../scripts/desktop-runtime.js";
import { invalidateResumePackageCache, loadResumePackage } from "./resume-loader.js";

const RESET_MARKER_FILE = ".reset-runtime.json";
const RESUME_PACKAGE_FILE_ORDER = [
  "resume.json",
  "resume.meta.json",
  "resume.schema.json"
];

const CLEANUP_TARGETS = {
  cache: {
    label: "缓存",
    description: "删除本地缓存目录中的临时数据。",
    key: "cacheDir"
  },
  tmp: {
    label: "临时文件",
    description: "删除运行过程中的临时文件目录。",
    key: "tmpDir"
  },
  logs: {
    label: "日志",
    description: "清理桌面端和服务端日志文件。",
    key: "logsDir"
  },
  exports: {
    label: "导出文件",
    description: "清理导出和 debug session 文件。",
    key: "exportsDir"
  },
  config: {
    label: "本地配置",
    description: "清理桌面端本地配置文件。",
    key: "configDir"
  }
};

function buildCleanupTargetView(target, definition, paths) {
  const dirPath = paths[definition.key];
  return {
    target,
    label: definition.label,
    description: definition.description,
    path: dirPath,
    exists: fs.existsSync(dirPath)
  };
}

async function countDirEntries(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries.length;
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }

    throw error;
  }
}

async function clearDirectoryContents(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  });

  for (const entry of entries) {
    await fsp.rm(path.join(dirPath, entry.name), {
      recursive: true,
      force: true
    });
  }

  await fsp.mkdir(dirPath, { recursive: true });
}

function normalizeResumePackageFiles(files = []) {
  const map = new Map();

  for (const file of files || []) {
    const name = path.basename(String(file?.name || "").trim()).toLowerCase();
    if (!RESUME_PACKAGE_FILE_ORDER.includes(name)) {
      continue;
    }

    map.set(name, {
      name,
      content: String(file?.content || "")
    });
  }

  return map;
}

async function validateResumePackageFiles(fileMap) {
  for (const requiredName of ["resume.json", "resume.meta.json"]) {
    if (!fileMap.has(requiredName)) {
      throw new Error(`Missing required resume package file: ${requiredName}`);
    }
  }

  for (const fileName of RESUME_PACKAGE_FILE_ORDER) {
    if (!fileMap.has(fileName)) {
      continue;
    }

    const raw = fileMap.get(fileName).content;
    try {
      JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid JSON in ${fileName}: ${error.message}`);
    }
  }
}

async function replaceResumePackageDir(targetDir, fileMap) {
  await fsp.rm(targetDir, {
    recursive: true,
    force: true
  });
  await fsp.mkdir(targetDir, { recursive: true });

  for (const fileName of RESUME_PACKAGE_FILE_ORDER) {
    if (!fileMap.has(fileName)) {
      continue;
    }

    const targetPath = path.join(targetDir, fileName);
    const raw = fileMap.get(fileName).content.trim();
    await fsp.writeFile(targetPath, `${raw}\n`, "utf8");
  }
}

export async function getDesktopRuntimeSummary() {
  const paths = getDesktopRuntimePaths();
  const isDesktopRuntime = Boolean(process.env.DESKTOP_DATA_DIR || process.env.DESKTOP_RUNTIME_MODE);
  const resetMarkerPath = path.join(paths.baseDir, RESET_MARKER_FILE);
  const pendingFullReset = fs.existsSync(resetMarkerPath);

  const [cacheEntries, tmpEntries, logEntries, exportEntries, configEntries] = await Promise.all([
    countDirEntries(paths.cacheDir),
    countDirEntries(paths.tmpDir),
    countDirEntries(paths.logsDir),
    countDirEntries(paths.exportsDir),
    countDirEntries(paths.configDir)
  ]);

  return {
    enabled: isDesktopRuntime,
    desktopRuntimeMode: process.env.DESKTOP_RUNTIME_MODE || "web",
    desktopDatabaseMode: process.env.DESKTOP_DATABASE_MODE || "external",
    dataDir: paths.baseDir,
    paths: {
      baseDir: paths.baseDir,
      cacheDir: paths.cacheDir,
      configDir: paths.configDir,
      exportsDir: paths.exportsDir,
      logsDir: paths.logsDir,
      postgresDataDir: paths.postgresDataDir,
      runDir: paths.runDir,
      serverLogDir: paths.serverLogDir,
      sessionDir: paths.sessionDir,
      tmpDir: paths.tmpDir,
      workspaceDir: paths.workspaceDir,
      workspaceResumePackageDir: paths.workspaceResumePackageDir
    },
    counts: {
      cacheEntries,
      tmpEntries,
      logEntries,
      exportEntries,
      configEntries
    },
    cleanupTargets: Object.entries(CLEANUP_TARGETS).map(([target, definition]) => (
      buildCleanupTargetView(target, definition, paths)
    )),
    fullReset: {
      pending: pendingFullReset,
      markerPath: resetMarkerPath,
      confirmationText: DESKTOP_RESET_CONFIRMATION_TEXT
    }
  };
}

export async function cleanupDesktopRuntimeTarget(target) {
  const definition = CLEANUP_TARGETS[target];
  if (!definition) {
    return null;
  }

  const paths = getDesktopRuntimePaths();
  const dirPath = paths[definition.key];

  await clearDirectoryContents(dirPath);

  return {
    target,
    label: definition.label,
    path: dirPath,
    ok: true
  };
}

export async function requestDesktopRuntimeReset(confirmationText) {
  if (String(confirmationText || "").trim() !== DESKTOP_RESET_CONFIRMATION_TEXT) {
    return null;
  }

  return scheduleDesktopRuntimeReset("desktop:runtime");
}

export async function importDesktopResumePackage(files = []) {
  const normalizedFiles = normalizeResumePackageFiles(files);
  await validateResumePackageFiles(normalizedFiles);

  const paths = getDesktopRuntimePaths();
  await replaceResumePackageDir(paths.workspaceResumePackageDir, normalizedFiles);

  invalidateResumePackageCache();
  const resumePackage = await loadResumePackage();

  return {
    ok: true,
    workspacePath: paths.workspaceResumePackageDir,
    importedFiles: RESUME_PACKAGE_FILE_ORDER.filter((fileName) => normalizedFiles.has(fileName)),
    resumeReady: Boolean(resumePackage.available),
    missingFiles: resumePackage.missingFiles
  };
}
