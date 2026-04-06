import { query } from "../../db/client.js";
import { ReportRepository } from "../interfaces/report-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapReportRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    snapshot: row.snapshot_json || {}
  };
}

export class DbReportRepository extends ReportRepository {
  async upsertReport(session) {
    if (!session.report) {
      return null;
    }

    const result = await query(
      `
insert into session_reports (
  id,
  session_id,
  status,
  created_at,
  updated_at,
  snapshot_json
)
values ($1, $2, $3, $4, $5, $6::jsonb)
on conflict (session_id) do update
set
  status = excluded.status,
  updated_at = excluded.updated_at,
  snapshot_json = excluded.snapshot_json
returning *;
`,
      [
        `report:${session.id}`,
        session.id,
        session.status === "completed" ? "completed" : "active",
        session.report.createdAt || session.updatedAt,
        session.updatedAt,
        JSON.stringify(session.report)
      ]
    );

    return mapReportRow(result.rows[0] || null);
  }

  async getBySessionId(sessionId) {
    const result = await query(
      `select * from session_reports where session_id = $1 limit 1;`,
      [sessionId]
    );
    return mapReportRow(result.rows[0] || null);
  }
}

export function createDbReportRepository() {
  return new DbReportRepository();
}
