import { query } from "../../db/client.js";
import { TurnRepository } from "../interfaces/turn-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTurnRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    turnIndex: row.turn_index,
    threadId: row.thread_id,
    questionText: row.question_text,
    questionTopicCategory: row.question_topic_category,
    questionTopicId: row.question_topic_id,
    questionTopicLabel: row.question_topic_label,
    answerText: row.answer_text,
    processing: Boolean(row.processing),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    snapshot: row.snapshot_json || {}
  };
}

export class DbTurnRepository extends TurnRepository {
  async upsertTurns(session, turns = []) {
    const results = [];
    for (const turn of turns) {
      const turnId = `${session.id}:${turn.index}`;
      const updatedAt = session.updatedAt || new Date().toISOString();
      const result = await query(
        `
insert into interview_turns (
  id,
  session_id,
  turn_index,
  thread_id,
  question_text,
  question_topic_category,
  question_topic_id,
  question_topic_label,
  answer_text,
  processing,
  created_at,
  updated_at,
  snapshot_json
)
values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
)
on conflict (id) do update
set
  thread_id = excluded.thread_id,
  question_text = excluded.question_text,
  question_topic_category = excluded.question_topic_category,
  question_topic_id = excluded.question_topic_id,
  question_topic_label = excluded.question_topic_label,
  answer_text = excluded.answer_text,
  processing = excluded.processing,
  updated_at = excluded.updated_at,
  snapshot_json = excluded.snapshot_json
returning *;
`,
        [
          turnId,
          session.id,
          turn.index,
          turn.threadId || null,
          String(turn.question?.text || ""),
          turn.question?.topicCategory || null,
          turn.question?.topicId || null,
          turn.question?.topicLabel || null,
          String(turn.answer || ""),
          Boolean(turn.processing),
          turn.createdAt || updatedAt,
          updatedAt,
          JSON.stringify(turn)
        ]
      );
      results.push(mapTurnRow(result.rows[0] || null));
    }
    return results;
  }

  async listBySessionId(sessionId) {
    const result = await query(
      `
select * from interview_turns
where session_id = $1
order by turn_index;
`,
      [sessionId]
    );
    return result.rows.map(mapTurnRow);
  }
}

export function createDbTurnRepository() {
  return new DbTurnRepository();
}
