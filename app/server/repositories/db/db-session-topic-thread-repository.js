import { query } from "../../db/client.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapThreadRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    topicId: row.topic_id,
    category: row.category,
    label: row.label,
    stageId: row.stage_id,
    status: row.status,
    questionCount: row.question_count,
    answerCount: row.answer_count,
    followupCount: row.followup_count,
    searchCount: row.search_count,
    lastDecision: row.last_decision,
    closureReason: row.closure_reason,
    evidenceSource: row.evidence_source,
    lastQuestionText: row.last_question_text,
    lastEvidenceSource: row.last_evidence_source,
    lastAssessmentScore: row.last_assessment_score == null ? null : Number(row.last_assessment_score),
    summary: row.summary,
    summarySignals: row.summary_signals_json || [],
    summaryRisks: row.summary_risks_json || [],
    summaryUpdatedAt: toIsoString(row.summary_updated_at),
    summaryJob: row.summary_job_json || {},
    snapshot: row.snapshot_json || {},
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    closedAt: toIsoString(row.closed_at)
  };
}

export class DbSessionTopicThreadRepository {
  async replaceForSession(session, threads = []) {
    await query(`delete from session_topic_threads where session_id = $1;`, [session.id]);

    const now = session.updatedAt || new Date().toISOString();
    const results = [];
    for (const thread of threads) {
      const result = await query(
        `
insert into session_topic_threads (
  id,
  session_id,
  topic_id,
  category,
  label,
  stage_id,
  status,
  question_count,
  answer_count,
  followup_count,
  search_count,
  last_decision,
  closure_reason,
  evidence_source,
  last_question_text,
  last_evidence_source,
  last_assessment_score,
  summary,
  summary_signals_json,
  summary_risks_json,
  summary_updated_at,
  summary_job_json,
  snapshot_json,
  created_at,
  updated_at,
  closed_at
)
values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21,
  $22::jsonb, $23::jsonb, $24, $25, $26
)
returning *;
`,
        [
          thread.id,
          session.id,
          thread.topicId || null,
          thread.category || "",
          thread.label || "",
          thread.stageId || null,
          thread.status || "active",
          thread.questionCount ?? 0,
          thread.answerCount ?? 0,
          thread.followupCount ?? 0,
          thread.searchCount ?? 0,
          thread.lastDecision || null,
          thread.closureReason || null,
          thread.evidenceSource || null,
          thread.lastQuestionText || null,
          thread.lastEvidenceSource || null,
          thread.lastAssessmentScore ?? null,
          thread.summary || null,
          JSON.stringify(thread.summarySignals || []),
          JSON.stringify(thread.summaryRisks || []),
          thread.summaryUpdatedAt || null,
          JSON.stringify(thread.summaryJob || {}),
          JSON.stringify(thread || {}),
          thread.createdAt || session.createdAt || now,
          thread.updatedAt || now,
          thread.closedAt || null
        ]
      );
      results.push(mapThreadRow(result.rows[0] || null));
    }

    return results.filter(Boolean);
  }

  async listBySessionId(sessionId) {
    const result = await query(
      `
select *
from session_topic_threads
where session_id = $1
order by created_at asc, id asc;
`,
      [sessionId]
    );
    return result.rows.map(mapThreadRow);
  }
}

export function createDbSessionTopicThreadRepository() {
  return new DbSessionTopicThreadRepository();
}
