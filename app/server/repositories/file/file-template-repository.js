import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../../config.js";
import { readJson, writeJson } from "../../lib/fs-utils.js";
import { TemplateRepository } from "../interfaces/template-repository.js";

function templateFilePath(templateId) {
  return path.join(config.templatesDir, `${templateId}.json`);
}

function compareTemplateRecency(left, right) {
  const leftRecent = left.recentUsedAt || "";
  const rightRecent = right.recentUsedAt || "";
  if (leftRecent !== rightRecent) {
    return rightRecent.localeCompare(leftRecent);
  }

  return (right.updatedAt || "").localeCompare(left.updatedAt || "");
}

export class FileTemplateRepository extends TemplateRepository {
  async list() {
    try {
      const entries = await fs.readdir(config.templatesDir, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
      const templates = await Promise.all(files.map((file) => readJson(path.join(config.templatesDir, file.name))));
      return templates.sort(compareTemplateRecency);
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async getById(templateId) {
    return readJson(templateFilePath(templateId));
  }

  async save(template) {
    await writeJson(templateFilePath(template.id), template);
    return template;
  }

  async archive(templateId) {
    await fs.rm(templateFilePath(templateId), { force: true });
  }

  async markUsed(templateId) {
    const template = await this.getById(templateId);
    const next = {
      ...template,
      recentUsedAt: new Date().toISOString(),
      updatedAt: template.updatedAt || new Date().toISOString()
    };
    await writeJson(templateFilePath(templateId), next);
    return next;
  }

  async importIfMissing(template) {
    const existing = await this.getById(template.id).catch(() => null);
    if (existing) {
      return existing;
    }
    return this.save(template);
  }
}

export function createFileTemplateRepository() {
  return new FileTemplateRepository();
}
