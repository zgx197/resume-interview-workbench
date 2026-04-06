import crypto from "node:crypto";
import { createDbTemplateRepository } from "../repositories/db/db-template-repository.js";
import { createFileTemplateRepository } from "../repositories/file/file-template-repository.js";

const templateRepository = createDbTemplateRepository();
const fileTemplateRepository = createFileTemplateRepository();
let importTemplatesPromise = null;

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

async function importTemplatesFromFiles() {
  const templates = await fileTemplateRepository.list();
  for (const template of templates) {
    await templateRepository.importIfMissing(template);
  }
}

async function ensureTemplatesImported() {
  if (!importTemplatesPromise) {
    importTemplatesPromise = importTemplatesFromFiles().catch((error) => {
      importTemplatesPromise = null;
      throw error;
    });
  }

  await importTemplatesPromise;
}

export async function listInterviewTemplates() {
  await ensureTemplatesImported();
  return templateRepository.list();
}

export async function loadInterviewTemplate(templateId) {
  await ensureTemplatesImported();
  const template = await templateRepository.getById(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  return template;
}

export async function saveInterviewTemplate(input) {
  await ensureTemplatesImported();
  const existing = input.id ? await templateRepository.getById(input.id) : null;
  const normalized = normalizeTemplateInput(input, { existingId: existing?.id || null });
  const now = new Date().toISOString();
  const template = {
    ...normalized,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    recentUsedAt: existing?.recentUsedAt || null
  };
  return templateRepository.save(template);
}

export async function deleteInterviewTemplate(templateId) {
  await ensureTemplatesImported();
  await templateRepository.archive(templateId);
}

export async function markInterviewTemplateUsed(templateId) {
  await ensureTemplatesImported();
  const template = await templateRepository.markUsed(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  return template;
}
