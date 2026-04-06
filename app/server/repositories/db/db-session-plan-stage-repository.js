import { query } from "../../db/client.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapStageRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    stageId: row.stage_id,
    position: row.position,
    category: row.category,
    title: row.title,
    goal: row.goal,
    promptHint: row.prompt_hint,
    targetTopics: row.target_topics_json || [],
    snapshot: row.snapshot_json || {},
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

export class DbSessionPlanStageRepository {
  async replaceForSession(session, stages = []) {
    await query(`delete from session_plan_stages where session_id = $1;`, [session.id]);

    const now = session.updatedAt || new Date().toISOString();
    const results = [];
    let position = 0;
    for (const stage of stages) {
      position += 1;
      const result = await query(
        `
insert into session_plan_stages (
  id,
  session_id,
  stage_id,
  position,
  category,
  title,
  goal,
  prompt_hint,
  target_topics_json,
  snapshot_json,
  created_at,
  updated_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
returning *;
`,
        [
          `${session.id}:${stage.id || position}`,
          session.id,
          stage.id || `stage_${position}`,
          position,
          stage.category || null,
          stage.title || "",
          stage.goal || null,
          stage.promptHint || null,
          JSON.stringify(stage.targetTopics || []),
          JSON.stringify(stage || {}),
          session.createdAt || now,
          now
        ]
      );
      results.push(mapStageRow(result.rows[0] || null));
    }

    return results.filter(Boolean);
  }

  async listBySessionId(sessionId) {
    const result = await query(
      `
select *
from session_plan_stages
where session_id = $1
order by position asc;
`,
      [sessionId]
    );
    return result.rows.map(mapStageRow);
  }
}

export function createDbSessionPlanStageRepository() {
  return new DbSessionPlanStageRepository();
}
