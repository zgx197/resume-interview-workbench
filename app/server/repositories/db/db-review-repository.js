import { query } from "../../db/client.js";
import { ReviewRepository } from "../interfaces/review-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapReviewRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    reviewKey: row.review_key,
    sourceSessionId: row.source_session_id,
    sourceTurnId: row.source_turn_id,
    questionId: row.question_id,
    topicId: row.topic_id,
    topicLabel: row.topic_label,
    weaknessType: row.weakness_type,
    title: row.title,
    evidenceSummary: row.evidence_summary,
    recommendedQuestionIds: row.recommended_question_ids || [],
    priority: row.priority,
    status: row.status,
    masteryLevel: row.mastery_level,
    metadata: row.metadata_json || {},
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    resolvedAt: toIsoString(row.resolved_at)
  };
}

function mapAttemptRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    reviewItemId: row.review_item_id,
    reviewKey: row.review_key,
    sessionId: row.session_id,
    questionId: row.question_id,
    score: row.score == null ? null : Number(row.score),
    outcome: row.outcome,
    notes: row.notes,
    metadata: row.metadata_json || {},
    attemptedAt: toIsoString(row.attempted_at),
    createdAt: toIsoString(row.created_at)
  };
}

function mapReviewSetRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    setKey: row.set_key,
    title: row.title,
    description: row.description,
    status: row.status,
    metadata: row.metadata_json || {},
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    archivedAt: toIsoString(row.archived_at)
  };
}

async function hydrateReviewSetItems(rows) {
  if (!rows.length) {
    return [];
  }

  const setIds = rows.map((row) => row.id);
  const itemResult = await query(
    `
select
  rsi.review_set_id,
  rsi.review_item_id,
  rsi.position,
  rsi.added_at,
  rsi.metadata_json,
  ri.*
from review_set_items rsi
join review_items ri on ri.id = rsi.review_item_id
where rsi.review_set_id = any($1::text[])
order by rsi.review_set_id, rsi.position asc, rsi.added_at asc;
`,
    [setIds]
  );

  const itemsBySetId = new Map();
  for (const row of itemResult.rows) {
    const current = itemsBySetId.get(row.review_set_id) || [];
    current.push({
      reviewItem: mapReviewRow(row),
      position: row.position,
      addedAt: toIsoString(row.added_at),
      metadata: row.metadata_json || {}
    });
    itemsBySetId.set(row.review_set_id, current);
  }

  return rows.map((row) => ({
    ...mapReviewSetRow(row),
    items: itemsBySetId.get(row.id) || []
  }));
}

export class DbReviewRepository extends ReviewRepository {
  async upsertItem(input) {
    const result = await query(
      `
insert into review_items (
  id,
  review_key,
  source_session_id,
  source_turn_id,
  question_id,
  topic_id,
  topic_label,
  weakness_type,
  title,
  evidence_summary,
  recommended_question_ids,
  priority,
  status,
  mastery_level,
  metadata_json,
  created_at,
  updated_at,
  resolved_at
)
values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15::jsonb, $16, $17, $18
)
on conflict (review_key) do update
set
  source_session_id = excluded.source_session_id,
  source_turn_id = excluded.source_turn_id,
  question_id = excluded.question_id,
  topic_id = excluded.topic_id,
  topic_label = excluded.topic_label,
  weakness_type = excluded.weakness_type,
  title = excluded.title,
  evidence_summary = excluded.evidence_summary,
  recommended_question_ids = excluded.recommended_question_ids,
  priority = excluded.priority,
  status = excluded.status,
  mastery_level = excluded.mastery_level,
  metadata_json = excluded.metadata_json,
  updated_at = excluded.updated_at,
  resolved_at = excluded.resolved_at
returning *;
`,
      [
        input.id,
        input.reviewKey,
        input.sourceSessionId,
        input.sourceTurnId,
        input.questionId,
        input.topicId,
        input.topicLabel,
        input.weaknessType,
        input.title,
        input.evidenceSummary,
        JSON.stringify(input.recommendedQuestionIds || []),
        input.priority,
        input.status,
        input.masteryLevel,
        JSON.stringify(input.metadata || {}),
        input.createdAt,
        input.updatedAt,
        input.resolvedAt || null
      ]
    );
    return mapReviewRow(result.rows[0] || null);
  }

  async list(filter = {}) {
    const result = await query(
      `
select * from review_items
where ($1::text is null or status = $1)
  and ($2::text is null or topic_id = $2)
  and ($3::text is null or source_session_id = $3)
order by priority desc, updated_at desc
limit $4;
`,
      [
        filter.status || null,
        filter.topicId || null,
        filter.sessionId || null,
        filter.limit || 20
      ]
    );
    return result.rows.map(mapReviewRow);
  }

  async getByReviewKey(reviewKey) {
    const result = await query(
      `select * from review_items where review_key = $1 limit 1;`,
      [reviewKey]
    );
    return mapReviewRow(result.rows[0] || null);
  }

  async updateStatus(reviewKey, patch = {}) {
    const existing = await this.getByReviewKey(reviewKey);
    if (!existing) {
      return null;
    }

    const now = patch.updatedAt || new Date().toISOString();
    const result = await query(
      `
update review_items
set
  status = $2,
  mastery_level = $3,
  priority = $4,
  metadata_json = $5::jsonb,
  updated_at = $6,
  resolved_at = $7
where review_key = $1
returning *;
`,
      [
        reviewKey,
        patch.status || existing.status,
        patch.masteryLevel ?? existing.masteryLevel,
        patch.priority ?? existing.priority,
        JSON.stringify({
          ...(existing.metadata || {}),
          ...(patch.metadata || {})
        }),
        now,
        patch.resolvedAt ?? (patch.status === "mastered" ? now : existing.resolvedAt)
      ]
    );
    return mapReviewRow(result.rows[0] || null);
  }

  async recordAttempt(reviewKey, attempt = {}) {
    const item = await this.getByReviewKey(reviewKey);
    if (!item) {
      return null;
    }

    const timestamp = attempt.createdAt || attempt.attemptedAt || new Date().toISOString();
    const result = await query(
      `
insert into review_item_attempts (
  id,
  review_item_id,
  review_key,
  session_id,
  question_id,
  score,
  outcome,
  notes,
  metadata_json,
  attempted_at,
  created_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
returning *;
`,
      [
        attempt.id,
        item.id,
        reviewKey,
        attempt.sessionId || null,
        attempt.questionId || item.questionId || null,
        Number.isFinite(Number(attempt.score)) ? Number(attempt.score) : null,
        attempt.outcome || "reviewed",
        attempt.notes || "",
        JSON.stringify(attempt.metadata || {}),
        attempt.attemptedAt || timestamp,
        timestamp
      ]
    );
    return mapAttemptRow(result.rows[0] || null);
  }

  async listAttempts(reviewKey, filter = {}) {
    const result = await query(
      `
select *
from review_item_attempts
where review_key = $1
order by attempted_at desc, created_at desc
limit $2;
`,
      [
        reviewKey,
        filter.limit || 20
      ]
    );
    return result.rows.map(mapAttemptRow);
  }

  async listAttemptsByReviewKeys(reviewKeys = [], filter = {}) {
    const normalizedKeys = [...new Set((reviewKeys || []).map((item) => String(item || "").trim()).filter(Boolean))];
    if (!normalizedKeys.length) {
      return new Map();
    }

    const perKeyLimit = filter.limit || 20;
    const result = await query(
      `
select *
from review_item_attempts
where review_key = any($1::text[])
order by review_key asc, attempted_at desc, created_at desc;
`,
      [normalizedKeys]
    );

    const attemptsByReviewKey = new Map();
    for (const row of result.rows) {
      const current = attemptsByReviewKey.get(row.review_key) || [];
      if (current.length >= perKeyLimit) {
        continue;
      }
      current.push(mapAttemptRow(row));
      attemptsByReviewKey.set(row.review_key, current);
    }

    return attemptsByReviewKey;
  }

  async saveSet(input) {
    const result = await query(
      `
insert into review_sets (
  id,
  set_key,
  title,
  description,
  status,
  metadata_json,
  created_at,
  updated_at,
  archived_at
)
values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
on conflict (id) do update
set
  set_key = excluded.set_key,
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  metadata_json = excluded.metadata_json,
  updated_at = excluded.updated_at,
  archived_at = excluded.archived_at
returning *;
`,
      [
        input.id,
        input.setKey || input.id,
        input.title,
        input.description || "",
        input.status || "active",
        JSON.stringify(input.metadata || {}),
        input.createdAt,
        input.updatedAt,
        input.archivedAt || null
      ]
    );

    const set = mapReviewSetRow(result.rows[0] || null);
    if (!set) {
      return null;
    }

    if (Array.isArray(input.items)) {
      await query(`delete from review_set_items where review_set_id = $1;`, [set.id]);
      let position = 0;
      for (const item of input.items) {
        position += 1;
        await query(
          `
insert into review_set_items (
  review_set_id,
  review_item_id,
  position,
  added_at,
  metadata_json
)
values ($1, $2, $3, $4, $5::jsonb)
on conflict (review_set_id, review_item_id) do update
set
  position = excluded.position,
  added_at = excluded.added_at,
  metadata_json = excluded.metadata_json;
`,
          [
            set.id,
            item.reviewItemId,
            item.position ?? position,
            item.addedAt || input.updatedAt || input.createdAt,
            JSON.stringify(item.metadata || {})
          ]
        );
      }
    }

    return this.getSetById(set.id);
  }

  async listSets(filter = {}) {
    const result = await query(
      `
select *
from review_sets
where ($1::text is null or status = $1)
order by updated_at desc, id
limit $2;
`,
      [
        filter.status || null,
        filter.limit || 20
      ]
    );
    return hydrateReviewSetItems(result.rows);
  }

  async getSetById(setId) {
    const result = await query(
      `
select *
from review_sets
where id = $1
limit 1;
`,
      [setId]
    );
    const rows = await hydrateReviewSetItems(result.rows);
    return rows[0] || null;
  }
}

export function createDbReviewRepository() {
  return new DbReviewRepository();
}
