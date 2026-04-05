import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { readJson, writeJson } from "../lib/fs-utils.js";

// 模板是用户可编辑数据，保存前先做一次强归一化，
// 保证前后端看到的结构始终一致。
function templateFilePath(templateId) {
  return path.join(config.templatesDir, `${templateId}.json`);
}

function toStringValue(value) {
  return String(value || "").trim();
}

function assertRequired(value, fieldName) {
  if (!toStringValue(value)) {
    throw new Error(`${fieldName} is required.`);
  }
}

function normalizeTemplateInput(input = {}, { existingId = null } = {}) {
  const normalized = {
    id: existingId || input.id || `template_${crypto.randomUUID()}`,
    name: toStringValue(input.name),
    companyName: toStringValue(input.companyName),
    companyIntro: toStringValue(input.companyIntro),
    jobDirection: toStringValue(input.jobDirection),
    jobDescription: toStringValue(input.jobDescription),
    additionalContext: toStringValue(input.additionalContext),
    interviewerRoleName: toStringValue(input.interviewerRoleName),
    roleId: toStringValue(input.roleId),
    jobId: toStringValue(input.jobId)
  };

  assertRequired(normalized.name, "name");
  assertRequired(normalized.companyName, "companyName");
  assertRequired(normalized.jobDirection, "jobDirection");
  assertRequired(normalized.jobDescription, "jobDescription");
  assertRequired(normalized.interviewerRoleName, "interviewerRoleName");
  assertRequired(normalized.roleId, "roleId");
  assertRequired(normalized.jobId, "jobId");

  return normalized;
}

function compareTemplateRecency(left, right) {
  const leftRecent = left.recentUsedAt || "";
  const rightRecent = right.recentUsedAt || "";
  if (leftRecent !== rightRecent) {
    return rightRecent.localeCompare(leftRecent);
  }

  return (right.updatedAt || "").localeCompare(left.updatedAt || "");
}

export async function listInterviewTemplates() {
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

export async function loadInterviewTemplate(templateId) {
  return readJson(templateFilePath(templateId));
}

export async function saveInterviewTemplate(input) {
  const existing = input.id ? await loadInterviewTemplate(input.id).catch(() => null) : null;
  const normalized = normalizeTemplateInput(input, { existingId: existing?.id || null });
  const now = new Date().toISOString();
  const template = {
    ...normalized,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    recentUsedAt: existing?.recentUsedAt || null
  };
  await writeJson(templateFilePath(template.id), template);
  return template;
}

export async function deleteInterviewTemplate(templateId) {
  await fs.rm(templateFilePath(templateId), { force: true });
}

export async function markInterviewTemplateUsed(templateId) {
  const template = await loadInterviewTemplate(templateId);
  const next = {
    ...template,
    recentUsedAt: new Date().toISOString(),
    updatedAt: template.updatedAt || new Date().toISOString()
  };
  await writeJson(templateFilePath(templateId), next);
  return next;
}
