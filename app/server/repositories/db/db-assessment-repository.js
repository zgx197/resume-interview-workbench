import { query } from "../../db/client.js";
import { AssessmentRepository } from "../interfaces/assessment-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapAssessmentRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    turnIndex: row.turn_index,
    strategy: row.strategy,
    score: row.score,
    confidence: row.confidence,
    followupNeeded: Boolean(row.followup_needed),
    suggestedFollowup: row.suggested_followup,
    strengths: row.strengths_json || [],
    risks: row.risks_json || [],
    evidenceUsed: row.evidence_used_json || [],
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    snapshot: row.snapshot_json || {}
  };
}

export class DbAssessmentRepository extends AssessmentRepository {
  async upsertAssessments(session, turns = []) {
    const results = [];
    for (const turn of turns) {
      if (!turn.assessment) {
        continue;
      }

      const assessmentId = `${session.id}:${turn.index}:assessment`;
      const turnId = `${session.id}:${turn.index}`;
      const updatedAt = session.updatedAt || new Date().toISOString();
      const result = await query(
        `
insert into turn_assessments (
  id,
  session_id,
  turn_id,
  turn_index,
  strategy,
  score,
  confidence,
  followup_needed,
  suggested_followup,
  strengths_json,
  risks_json,
  evidence_used_json,
  created_at,
  updated_at,
  snapshot_json
)
values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb
)
on conflict (turn_id) do update
set
  strategy = excluded.strategy,
  score = excluded.score,
  confidence = excluded.confidence,
  followup_needed = excluded.followup_needed,
  suggested_followup = excluded.suggested_followup,
  strengths_json = excluded.strengths_json,
  risks_json = excluded.risks_json,
  evidence_used_json = excluded.evidence_used_json,
  updated_at = excluded.updated_at,
  snapshot_json = excluded.snapshot_json
returning *;
`,
        [
          assessmentId,
          session.id,
          turnId,
          turn.index,
          turn.assessment.strategy || null,
          Number.isFinite(Number(turn.assessment.score)) ? Number(turn.assessment.score) : null,
          turn.assessment.confidence || null,
          Boolean(turn.assessment.followupNeeded),
          turn.assessment.suggestedFollowup || null,
          JSON.stringify(turn.assessment.strengths || []),
          JSON.stringify(turn.assessment.risks || []),
          JSON.stringify(turn.assessment.evidenceUsed || []),
          turn.createdAt || updatedAt,
          updatedAt,
          JSON.stringify(turn.assessment)
        ]
      );
      results.push(mapAssessmentRow(result.rows[0] || null));
    }
    return results;
  }

  async listBySessionId(sessionId) {
    const result = await query(
      `
select * from turn_assessments
where session_id = $1
order by turn_index;
`,
      [sessionId]
    );
    return result.rows.map(mapAssessmentRow);
  }
}

export function createDbAssessmentRepository() {
  return new DbAssessmentRepository();
}
