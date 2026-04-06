import { query, withTransaction } from "../../db/client.js";
import { QuestionRepository } from "../interfaces/question-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toJson(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

function buildQuestionFilters(filter = {}, { includeStatusFallback = true } = {}) {
  const conditions = [];
  const params = [];
  let index = 1;

  const addCondition = (sql, ...values) => {
    let resolvedSql = sql;
    for (const value of values) {
      resolvedSql = resolvedSql.replace("$?", `$${index}`);
      params.push(value);
      index += 1;
    }
    conditions.push(resolvedSql);
  };

  if (filter.status) {
    addCondition("q.status = $?", filter.status);
  } else if (includeStatusFallback) {
    conditions.push(`q.status = 'active'`);
  }

  if (filter.category) {
    addCondition("q.category = $?", filter.category);
  }

  if (filter.sourceType) {
    addCondition(
      "(q.source_type = $? or exists (select 1 from question_sources qs where qs.question_id = q.id and qs.source_kind = $?))",
      filter.sourceType,
      filter.sourceType
    );
  }

  if (Number.isFinite(Number(filter.difficulty))) {
    addCondition("q.difficulty = $?", Number(filter.difficulty));
  } else {
    if (Number.isFinite(Number(filter.minDifficulty))) {
      addCondition("q.difficulty >= $?", Number(filter.minDifficulty));
    }
    if (Number.isFinite(Number(filter.maxDifficulty))) {
      addCondition("q.difficulty <= $?", Number(filter.maxDifficulty));
    }
  }

  const tagKeys = Array.isArray(filter.tagKeys)
    ? filter.tagKeys.map((item) => String(item || "").trim()).filter(Boolean)
    : (filter.tagKey ? [String(filter.tagKey).trim()] : []);
  if (tagKeys.length) {
    addCondition(
      `exists (
        select 1
        from question_tag_links qtl
        join question_tags qt on qt.id = qtl.tag_id
        where qtl.question_id = q.id
          and qt.tag_key = any($?::text[])
      )`,
      tagKeys
    );
  }

  const searchText = String(filter.q || filter.query || "").trim();
  if (searchText) {
    const likeValue = `%${searchText}%`;
    addCondition(
      `(
        q.canonical_text ilike $?
        or exists (
          select 1
          from question_variants qv
          where qv.question_id = q.id
            and qv.status = 'active'
            and qv.variant_text ilike $?
        )
      )`,
      likeValue,
      likeValue
    );
  }

  const orderBy = filter.orderBy === "updated_desc"
    ? "order by q.updated_at desc, q.id"
    : "order by q.category, q.updated_at desc, q.id";
  const limit = Number.isFinite(Number(filter.limit)) ? Math.max(1, Math.floor(Number(filter.limit))) : 50;
  params.push(limit);
  const limitPlaceholder = `$${index}`;

  return {
    whereSql: conditions.length ? `where ${conditions.join("\n  and ")}` : "",
    params,
    orderBy,
    limitPlaceholder
  };
}

function mapQuestionRow(row, relations = {}) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    questionKey: row.question_key,
    canonicalText: row.canonical_text,
    category: row.category,
    difficulty: row.difficulty,
    status: row.status,
    sourceType: row.source_type,
    language: row.language,
    metadata: row.metadata_json || {},
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    archivedAt: toIsoString(row.archived_at),
    variants: relations.variantsByQuestionId?.get(row.id) || [],
    sources: relations.sourcesByQuestionId?.get(row.id) || [],
    tags: relations.tagsByQuestionId?.get(row.id) || [],
    usageStats: relations.usageByQuestionId?.get(row.id) || {
      askedCount: 0,
      answeredCount: 0,
      avgScore: null,
      avgFollowupCount: null,
      lastAskedAt: null,
      updatedAt: null
    }
  };
}

async function loadRelations(questionIds) {
  if (!questionIds.length) {
    return {
      variantsByQuestionId: new Map(),
      sourcesByQuestionId: new Map(),
      tagsByQuestionId: new Map(),
      usageByQuestionId: new Map()
    };
  }

  const [variantResult, sourceResult, tagResult, usageResult] = await Promise.all([
    query(
      `
select id, question_id, variant_text, style, status, created_at, updated_at
from question_variants
where question_id = any($1::text[])
order by question_id, created_at, id;
`,
      [questionIds]
    ),
    query(
      `
select id, question_id, source_kind, source_id, source_snapshot_json, created_at
from question_sources
where question_id = any($1::text[])
order by question_id, created_at, id;
`,
      [questionIds]
    ),
    query(
      `
select
  qtl.question_id,
  qt.id,
  qt.tag_key,
  qt.label,
  qt.category,
  qt.created_at
from question_tag_links qtl
join question_tags qt on qt.id = qtl.tag_id
where qtl.question_id = any($1::text[])
order by qtl.question_id, qt.label, qt.id;
`,
      [questionIds]
    ),
    query(
      `
select question_id, asked_count, answered_count, avg_score, avg_followup_count, last_asked_at, updated_at
from question_usage_stats
where question_id = any($1::text[]);
`,
      [questionIds]
    )
  ]);

  const variantsByQuestionId = new Map();
  for (const row of variantResult.rows) {
    const current = variantsByQuestionId.get(row.question_id) || [];
    current.push({
      id: row.id,
      text: row.variant_text,
      style: row.style,
      status: row.status,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at)
    });
    variantsByQuestionId.set(row.question_id, current);
  }

  const sourcesByQuestionId = new Map();
  for (const row of sourceResult.rows) {
    const current = sourcesByQuestionId.get(row.question_id) || [];
    current.push({
      id: row.id,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      sourceSnapshot: row.source_snapshot_json || {},
      createdAt: toIsoString(row.created_at)
    });
    sourcesByQuestionId.set(row.question_id, current);
  }

  const tagsByQuestionId = new Map();
  for (const row of tagResult.rows) {
    const current = tagsByQuestionId.get(row.question_id) || [];
    current.push({
      id: row.id,
      tagKey: row.tag_key,
      label: row.label,
      category: row.category,
      createdAt: toIsoString(row.created_at)
    });
    tagsByQuestionId.set(row.question_id, current);
  }

  const usageByQuestionId = new Map();
  for (const row of usageResult.rows) {
    usageByQuestionId.set(row.question_id, {
      askedCount: row.asked_count,
      answeredCount: row.answered_count,
      avgScore: row.avg_score == null ? null : Number(row.avg_score),
      avgFollowupCount: row.avg_followup_count == null ? null : Number(row.avg_followup_count),
      lastAskedAt: toIsoString(row.last_asked_at),
      updatedAt: toIsoString(row.updated_at)
    });
  }

  return {
    variantsByQuestionId,
    sourcesByQuestionId,
    tagsByQuestionId,
    usageByQuestionId
  };
}

async function hydrateQuestionRows(rows) {
  const relations = await loadRelations(rows.map((row) => row.id));
  return rows.map((row) => mapQuestionRow(row, relations));
}

async function replaceQuestionVariants(client, questionId, variants, fallbackVariant, timestamp) {
  await client.query(`delete from question_variants where question_id = $1;`, [questionId]);

  const normalizedVariants = (Array.isArray(variants) && variants.length ? variants : [fallbackVariant])
    .map((variant, index) => ({
      id: variant?.id || `${questionId}_variant_${String(index + 1).padStart(3, "0")}`,
      text: String(variant?.text || variant?.variantText || "").trim(),
      style: String(variant?.style || (index === 0 ? "primary" : "variant")).trim() || null,
      status: String(variant?.status || "active").trim() || "active",
      createdAt: variant?.createdAt || timestamp,
      updatedAt: variant?.updatedAt || timestamp
    }))
    .filter((variant) => variant.text);

  for (const variant of normalizedVariants) {
    await client.query(
      `
insert into question_variants (
  id,
  question_id,
  variant_text,
  style,
  status,
  created_at,
  updated_at
)
values ($1, $2, $3, $4, $5, $6, $7);
`,
      [
        variant.id,
        questionId,
        variant.text,
        variant.style,
        variant.status,
        variant.createdAt,
        variant.updatedAt
      ]
    );
  }
}

async function replaceQuestionSources(client, questionId, sources, fallbackSource, timestamp) {
  await client.query(`delete from question_sources where question_id = $1;`, [questionId]);

  const normalizedSources = (Array.isArray(sources) && sources.length ? sources : [fallbackSource])
    .map((source, index) => ({
      id: source?.id || `${questionId}_source_${String(index + 1).padStart(3, "0")}`,
      sourceKind: String(source?.sourceKind || source?.source_type || "").trim(),
      sourceId: String(source?.sourceId || "").trim() || null,
      sourceSnapshot: source?.sourceSnapshot || source?.sourceSnapshotJson || {},
      createdAt: source?.createdAt || timestamp
    }))
    .filter((source) => source.sourceKind);

  for (const source of normalizedSources) {
    await client.query(
      `
insert into question_sources (
  id,
  question_id,
  source_kind,
  source_id,
  source_snapshot_json,
  created_at
)
values ($1, $2, $3, $4, $5::jsonb, $6);
`,
      [
        source.id,
        questionId,
        source.sourceKind,
        source.sourceId,
        toJson(source.sourceSnapshot),
        source.createdAt
      ]
    );
  }
}

async function replaceQuestionTags(client, questionId, tags, timestamp) {
  await client.query(`delete from question_tag_links where question_id = $1;`, [questionId]);

  const normalizedTags = (Array.isArray(tags) ? tags : [])
    .map((tag, index) => {
      const tagKey = String(tag?.tagKey || tag?.key || tag?.label || "").trim();
      return {
        id: tag?.id || `tag_${tagKey || questionId}_${String(index + 1).padStart(3, "0")}`,
        tagKey,
        label: String(tag?.label || tagKey).trim(),
        category: String(tag?.category || "").trim() || null,
        createdAt: tag?.createdAt || timestamp
      };
    })
    .filter((tag) => tag.tagKey && tag.label);

  for (const tag of normalizedTags) {
    const result = await client.query(
      `
insert into question_tags (
  id,
  tag_key,
  label,
  category,
  created_at
)
values ($1, $2, $3, $4, $5)
on conflict (tag_key) do update
set
  label = excluded.label,
  category = excluded.category
returning id;
`,
      [
        tag.id,
        tag.tagKey,
        tag.label,
        tag.category,
        tag.createdAt
      ]
    );

    await client.query(
      `
insert into question_tag_links (question_id, tag_id)
values ($1, $2)
on conflict do nothing;
`,
      [questionId, result.rows[0].id]
    );
  }
}

async function upsertUsageStats(client, questionId, usageStats, timestamp) {
  if (!usageStats) {
    await client.query(
      `
insert into question_usage_stats (
  question_id,
  asked_count,
  answered_count,
  avg_score,
  avg_followup_count,
  last_asked_at,
  updated_at
)
values ($1, 0, 0, null, null, null, $2)
on conflict (question_id) do nothing;
`,
      [questionId, timestamp]
    );
    return;
  }

  await client.query(
    `
insert into question_usage_stats (
  question_id,
  asked_count,
  answered_count,
  avg_score,
  avg_followup_count,
  last_asked_at,
  updated_at
)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (question_id) do update
set
  asked_count = excluded.asked_count,
  answered_count = excluded.answered_count,
  avg_score = excluded.avg_score,
  avg_followup_count = excluded.avg_followup_count,
  last_asked_at = excluded.last_asked_at,
  updated_at = excluded.updated_at;
`,
    [
      questionId,
      usageStats.askedCount ?? 0,
      usageStats.answeredCount ?? 0,
      usageStats.avgScore ?? null,
      usageStats.avgFollowupCount ?? null,
      usageStats.lastAskedAt ?? null,
      usageStats.updatedAt || timestamp
    ]
  );
}

const BASE_SELECT = `
select
  q.id,
  q.question_key,
  q.canonical_text,
  q.category,
  q.difficulty,
  q.status,
  q.source_type,
  q.language,
  q.metadata_json,
  q.created_at,
  q.updated_at,
  q.archived_at
from question_items q
`;

export class DbQuestionRepository extends QuestionRepository {
  async listAll(filter = {}) {
    return this.search(filter);
  }

  async listByCategory(category, options = {}) {
    return this.search({
      ...options,
      category
    });
  }

  async search(filter = {}) {
    const { whereSql, params, orderBy, limitPlaceholder } = buildQuestionFilters(filter);
    const result = await query(
      `
${BASE_SELECT}
${whereSql}
${orderBy}
limit ${limitPlaceholder};
`,
      params
    );
    return hydrateQuestionRows(result.rows);
  }

  async getById(questionId) {
    const result = await query(
      `
${BASE_SELECT}
where q.id = $1
limit 1;
`,
      [questionId]
    );
    const rows = await hydrateQuestionRows(result.rows);
    return rows[0] || null;
  }

  async listCategories() {
    const result = await query(
      `
select category, count(*)::int as question_count
from question_items
where status = 'active'
group by category
order by category;
`
    );

    return result.rows.map((row) => ({
      category: row.category,
      questionCount: row.question_count
    }));
  }

  async listTags(filter = {}) {
    const result = await query(
      `
select
  qt.id,
  qt.tag_key,
  qt.label,
  qt.category,
  qt.created_at,
  count(qtl.question_id)::int as question_count
from question_tags qt
left join question_tag_links qtl on qtl.tag_id = qt.id
left join question_items qi on qi.id = qtl.question_id and qi.status = 'active'
where ($1::text is null or qt.category = $1)
  and ($2::text is null or qi.category = $2)
group by qt.id, qt.tag_key, qt.label, qt.category, qt.created_at
order by question_count desc, qt.label, qt.id;
`,
      [filter.tagCategory || null, filter.category || null]
    );

    return result.rows.map((row) => ({
      id: row.id,
      tagKey: row.tag_key,
      label: row.label,
      category: row.category,
      createdAt: toIsoString(row.created_at),
      questionCount: row.question_count
    }));
  }

  async save(question) {
    const timestamp = question.updatedAt || new Date().toISOString();
    const createdAt = question.createdAt || timestamp;
    const normalizedQuestion = {
      id: question.id,
      questionKey: question.questionKey || question.id,
      canonicalText: String(question.canonicalText || "").trim(),
      category: String(question.category || "").trim(),
      difficulty: Number.isFinite(Number(question.difficulty)) ? Number(question.difficulty) : 3,
      status: String(question.status || "active").trim() || "active",
      sourceType: String(question.sourceType || "manual").trim() || "manual",
      language: String(question.language || "").trim() || null,
      metadata: question.metadata || {},
      createdAt,
      updatedAt: timestamp,
      variants: Array.isArray(question.variants) ? question.variants : [],
      sources: Array.isArray(question.sources) ? question.sources : [],
      tags: Array.isArray(question.tags) ? question.tags : [],
      usageStats: question.usageStats || null
    };

    if (!normalizedQuestion.id || !normalizedQuestion.canonicalText || !normalizedQuestion.category) {
      throw new Error("Question id, canonicalText, and category are required.");
    }

    await withTransaction(async (client) => {
      await client.query(
        `
insert into question_items (
  id,
  question_key,
  canonical_text,
  category,
  difficulty,
  status,
  source_type,
  language,
  metadata_json,
  created_at,
  updated_at,
  archived_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
on conflict (id) do update
set
  question_key = excluded.question_key,
  canonical_text = excluded.canonical_text,
  category = excluded.category,
  difficulty = excluded.difficulty,
  status = excluded.status,
  source_type = excluded.source_type,
  language = excluded.language,
  metadata_json = excluded.metadata_json,
  updated_at = excluded.updated_at,
  archived_at = excluded.archived_at;
`,
        [
          normalizedQuestion.id,
          normalizedQuestion.questionKey,
          normalizedQuestion.canonicalText,
          normalizedQuestion.category,
          normalizedQuestion.difficulty,
          normalizedQuestion.status,
          normalizedQuestion.sourceType,
          normalizedQuestion.language,
          toJson(normalizedQuestion.metadata),
          normalizedQuestion.createdAt,
          normalizedQuestion.updatedAt,
          normalizedQuestion.status === "archived" ? normalizedQuestion.updatedAt : null
        ]
      );

      await replaceQuestionVariants(
        client,
        normalizedQuestion.id,
        normalizedQuestion.variants,
        {
          id: `${normalizedQuestion.id}_primary`,
          text: normalizedQuestion.canonicalText,
          style: "primary",
          status: normalizedQuestion.status,
          createdAt: normalizedQuestion.createdAt,
          updatedAt: normalizedQuestion.updatedAt
        },
        normalizedQuestion.updatedAt
      );

      await replaceQuestionSources(
        client,
        normalizedQuestion.id,
        normalizedQuestion.sources,
        {
          id: `${normalizedQuestion.id}_source_primary`,
          sourceKind: normalizedQuestion.sourceType,
          sourceId: normalizedQuestion.metadata?.sourceId || null,
          sourceSnapshot: normalizedQuestion.metadata || {},
          createdAt: normalizedQuestion.createdAt
        },
        normalizedQuestion.updatedAt
      );

      await replaceQuestionTags(
        client,
        normalizedQuestion.id,
        normalizedQuestion.tags,
        normalizedQuestion.updatedAt
      );

      await upsertUsageStats(
        client,
        normalizedQuestion.id,
        normalizedQuestion.usageStats,
        normalizedQuestion.updatedAt
      );
    });

    return this.getById(normalizedQuestion.id);
  }

  async importIfMissing(question) {
    const existing = await this.getById(question.id);
    if (existing) {
      return existing;
    }
    return this.save(question);
  }

  async recordUsage(input) {
    const timestamp = input.occurredAt || new Date().toISOString();
    await query(
      `
insert into question_usage_stats (
  question_id,
  asked_count,
  answered_count,
  avg_score,
  avg_followup_count,
  last_asked_at,
  updated_at
)
values (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6,
  $7
)
on conflict (question_id) do update
set
  asked_count = excluded.asked_count,
  answered_count = excluded.answered_count,
  avg_score = excluded.avg_score,
  avg_followup_count = excluded.avg_followup_count,
  last_asked_at = excluded.last_asked_at,
  updated_at = excluded.updated_at;
`,
      [
        input.questionId,
        input.askedCount ?? 0,
        input.answeredCount ?? 0,
        input.avgScore ?? null,
        input.avgFollowupCount ?? null,
        input.lastAskedAt || timestamp,
        timestamp
      ]
    );

    return this.getById(input.questionId);
  }
}

export function createDbQuestionRepository() {
  return new DbQuestionRepository();
}
