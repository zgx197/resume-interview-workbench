import fs from "node:fs/promises";
import path from "node:path";

// 统一封装 JSON 文件读写，避免 session、template、catalog、
// resume-package 在落盘格式上各自实现一套。
export async function readJson(filePath) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      const retryable = error instanceof SyntaxError || error.code === "ENOENT";
      if (!retryable || attempt === 3) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }

  throw new Error(`Unable to read JSON file: ${filePath}`);
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFilePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

  try {
    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    if (["EEXIST", "EPERM"].includes(error.code)) {
      await fs.rm(filePath, { force: true });
      await fs.rename(tempFilePath, filePath);
    } else {
      throw error;
    }
  } finally {
    await fs.rm(tempFilePath, { force: true }).catch(() => {});
  }
}

export async function listJsonFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));
}
