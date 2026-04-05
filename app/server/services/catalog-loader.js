import { config } from "../config.js";
import { listJsonFiles, readJson } from "../lib/fs-utils.js";

// 角色和岗位都是仓库内的静态数据，进程级缓存已经足够。
async function loadDirectory(dirPath) {
  const files = await listJsonFiles(dirPath);
  const values = await Promise.all(files.map((filePath) => readJson(filePath)));
  return values.sort((left, right) =>
    (left.name || left.title || "").localeCompare(right.name || right.title || "")
  );
}

let cache = null;

export async function loadInterviewCatalog() {
  if (cache) {
    return cache;
  }

  const [roles, jobs] = await Promise.all([
    loadDirectory(config.rolesDir),
    loadDirectory(config.jobsDir)
  ]);

  cache = { roles, jobs };
  return cache;
}

export async function findRole(roleId) {
  const { roles } = await loadInterviewCatalog();
  return roles.find((role) => role.id === roleId) || null;
}

export async function findJob(jobId) {
  const { jobs } = await loadInterviewCatalog();
  return jobs.find((job) => job.id === jobId) || null;
}
