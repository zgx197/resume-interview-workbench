import crypto from "node:crypto";
import { withTransaction } from "../../db/client.js";
import { TemplateRepository } from "../interfaces/template-repository.js";

function computeTemplateContentHash(template) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        name: template.name,
        companyName: template.companyName,
        companyIntro: template.companyIntro,
        jobDirection: template.jobDirection,
        jobDescription: template.jobDescription,
        additionalContext: template.additionalContext,
        interviewerRoleName: template.interviewerRoleName,
        roleId: template.roleId,
        jobId: template.jobId
      })
    )
    .digest("hex");
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function mapTemplateRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name,
    companyIntro: row.company_intro,
    jobDirection: row.job_direction,
    jobDescription: row.job_description,
    additionalContext: row.additional_context,
    interviewerRoleName: row.interviewer_role_name,
    roleId: row.role_id,
    jobId: row.job_id,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    recentUsedAt: toIsoString(row.recent_used_at)
  };
}

const TEMPLATE_SELECT = `
select
  t.id,
  t.created_at,
  t.updated_at,
  t.recent_used_at,
  v.name,
  v.company_name,
  v.company_intro,
  v.job_direction,
  v.job_description,
  v.additional_context,
  v.interviewer_role_name,
  v.role_id,
  v.job_id
from interview_templates t
join template_versions v
  on v.template_id = t.id
 and v.version_no = t.current_version_no
where t.status = 'active'
`;

export class DbTemplateRepository extends TemplateRepository {
  async list() {
    const result = await withTransaction((client) => client.query(`${TEMPLATE_SELECT} order by t.recent_used_at desc nulls last, t.updated_at desc;`));
    return result.rows.map(mapTemplateRow);
  }

  async getById(templateId) {
    const result = await withTransaction((client) => client.query(`${TEMPLATE_SELECT} and t.id = $1 limit 1;`, [templateId]));
    return mapTemplateRow(result.rows[0] || null);
  }

  async save(template) {
    const now = template.updatedAt || new Date().toISOString();
    const contentHash = computeTemplateContentHash(template);

    return withTransaction(async (client) => {
      const existingResult = await client.query(
        `
select
  t.id,
  t.created_at,
  t.updated_at,
  t.recent_used_at,
  t.current_version_no,
  v.content_hash
from interview_templates t
join template_versions v
  on v.template_id = t.id
 and v.version_no = t.current_version_no
where t.id = $1
limit 1;
`,
        [template.id]
      );

      const existing = existingResult.rows[0] || null;

      if (!existing) {
        await client.query(
          `
insert into interview_templates (
  id,
  template_key,
  status,
  current_version_no,
  recent_used_at,
  created_at,
  updated_at,
  archived_at
)
values ($1, $2, 'active', 1, $3, $4, $5, null);
`,
          [template.id, template.id, template.recentUsedAt, template.createdAt, now]
        );

        await client.query(
          `
insert into template_versions (
  id,
  template_id,
  version_no,
  name,
  company_name,
  company_intro,
  job_direction,
  job_description,
  additional_context,
  interviewer_role_name,
  role_id,
  job_id,
  content_hash,
  created_at
)
values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
`,
          [
            `${template.id}_v1`,
            template.id,
            template.name,
            template.companyName,
            template.companyIntro,
            template.jobDirection,
            template.jobDescription,
            template.additionalContext,
            template.interviewerRoleName,
            template.roleId,
            template.jobId,
            contentHash,
            template.createdAt
          ]
        );

        return template;
      }

      let nextVersionNo = Number(existing.current_version_no) || 1;
      if (existing.content_hash !== contentHash) {
        nextVersionNo += 1;
        await client.query(
          `
insert into template_versions (
  id,
  template_id,
  version_no,
  name,
  company_name,
  company_intro,
  job_direction,
  job_description,
  additional_context,
  interviewer_role_name,
  role_id,
  job_id,
  content_hash,
  created_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
`,
          [
            `${template.id}_v${nextVersionNo}`,
            template.id,
            nextVersionNo,
            template.name,
            template.companyName,
            template.companyIntro,
            template.jobDirection,
            template.jobDescription,
            template.additionalContext,
            template.interviewerRoleName,
            template.roleId,
            template.jobId,
            contentHash,
            now
          ]
        );
      }

      await client.query(
        `
update interview_templates
set
  current_version_no = $2,
  recent_used_at = $3,
  updated_at = $4,
  archived_at = null,
  status = 'active'
where id = $1;
`,
        [template.id, nextVersionNo, template.recentUsedAt, now]
      );

      const refreshed = await client.query(`${TEMPLATE_SELECT} and t.id = $1 limit 1;`, [template.id]);
      return mapTemplateRow(refreshed.rows[0] || null);
    });
  }

  async archive(templateId) {
    await withTransaction((client) => client.query(
      `
update interview_templates
set
  status = 'archived',
  archived_at = now(),
  updated_at = now()
where id = $1;
`,
      [templateId]
    ));
  }

  async markUsed(templateId) {
    return withTransaction(async (client) => {
      await client.query(
        `
update interview_templates
set
  recent_used_at = now(),
  updated_at = now()
where id = $1
  and status = 'active';
`,
        [templateId]
      );
      const refreshed = await client.query(`${TEMPLATE_SELECT} and t.id = $1 limit 1;`, [templateId]);
      return mapTemplateRow(refreshed.rows[0] || null);
    });
  }

  async importIfMissing(template) {
    const existing = await this.getById(template.id);
    if (existing) {
      return existing;
    }
    return this.save(template);
  }
}

export function createDbTemplateRepository() {
  return new DbTemplateRepository();
}
