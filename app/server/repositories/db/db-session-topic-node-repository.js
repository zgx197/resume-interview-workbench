import { query } from "../../db/client.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapNodeRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    nodeId: row.node_id,
    label: row.label,
    category: row.category,
    stageIds: row.stage_ids_json || [],
    stageTitles: row.stage_titles_json || [],
    plannedCount: row.planned_count,
    askCount: row.ask_count,
    averageScore: row.average_score == null ? null : Number(row.average_score),
    lastScore: row.last_score == null ? null : Number(row.last_score),
    lastTurnIndex: row.last_turn_index,
    threadCount: row.thread_count,
    activeThreadId: row.active_thread_id,
    currentQuestion: Boolean(row.current_question),
    covered: Boolean(row.covered),
    status: row.status,
    snapshot: row.snapshot_json || {},
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

export class DbSessionTopicNodeRepository {
  async replaceForSession(session, nodes = []) {
    await query(`delete from session_topic_nodes where session_id = $1;`, [session.id]);

    const now = session.updatedAt || new Date().toISOString();
    const results = [];
    for (const node of nodes) {
      const result = await query(
        `
insert into session_topic_nodes (
  id,
  session_id,
  node_id,
  label,
  category,
  stage_ids_json,
  stage_titles_json,
  planned_count,
  ask_count,
  average_score,
  last_score,
  last_turn_index,
  thread_count,
  active_thread_id,
  current_question,
  covered,
  status,
  snapshot_json,
  created_at,
  updated_at
)
values (
  $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20
)
returning *;
`,
        [
          `${session.id}:${node.id}`,
          session.id,
          node.id,
          node.label || "",
          node.category || null,
          JSON.stringify(node.stageIds || []),
          JSON.stringify(node.stageTitles || []),
          node.plannedCount ?? 0,
          node.askCount ?? 0,
          node.averageScore ?? null,
          node.lastScore ?? null,
          node.lastTurnIndex ?? null,
          node.threadCount ?? 0,
          node.activeThreadId || null,
          Boolean(node.currentQuestion),
          Boolean(node.covered),
          node.status || "idle",
          JSON.stringify(node || {}),
          session.createdAt || now,
          now
        ]
      );
      results.push(mapNodeRow(result.rows[0] || null));
    }

    return results.filter(Boolean);
  }

  async listBySessionId(sessionId) {
    const result = await query(
      `
select *
from session_topic_nodes
where session_id = $1
order by label asc, node_id asc;
`,
      [sessionId]
    );
    return result.rows.map(mapNodeRow);
  }
}

export function createDbSessionTopicNodeRepository() {
  return new DbSessionTopicNodeRepository();
}
