import { query } from "../../db/client.js";
import { KnowledgeRepository } from "../interfaces/knowledge-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapKnowledgeRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    documentKey: row.document_key,
    documentType: row.document_type,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    title: row.title,
    content: row.content,
    metadata: row.metadata_json || {},
    status: row.status,
    contentHash: row.content_hash,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

export class DbKnowledgeRepository extends KnowledgeRepository {
  async upsertDocument(input) {
    const result = await query(
      `
insert into knowledge_documents (
  id,
  document_key,
  document_type,
  source_table,
  source_id,
  title,
  content,
  search_text,
  metadata_json,
  status,
  content_hash,
  created_at,
  updated_at
)
values (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6,
  $7,
  to_tsvector('simple', $7),
  $8::jsonb,
  $9,
  $10,
  $11,
  $12
)
on conflict (document_key) do update
set
  document_type = excluded.document_type,
  source_table = excluded.source_table,
  source_id = excluded.source_id,
  title = excluded.title,
  content = excluded.content,
  search_text = excluded.search_text,
  metadata_json = excluded.metadata_json,
  status = excluded.status,
  content_hash = excluded.content_hash,
  updated_at = excluded.updated_at
returning *;
`,
      [
        input.id,
        input.documentKey,
        input.documentType,
        input.sourceTable,
        input.sourceId,
        input.title,
        input.content,
        JSON.stringify(input.metadata || {}),
        input.status || "active",
        input.contentHash,
        input.createdAt,
        input.updatedAt
      ]
    );
    return mapKnowledgeRow(result.rows[0] || null);
  }

  async getById(documentId) {
    const result = await query(
      `select * from knowledge_documents where id = $1 limit 1;`,
      [documentId]
    );
    return mapKnowledgeRow(result.rows[0] || null);
  }

  async getByDocumentKey(documentKey) {
    const result = await query(
      `select * from knowledge_documents where document_key = $1 limit 1;`,
      [documentKey]
    );
    return mapKnowledgeRow(result.rows[0] || null);
  }

  async list(filter = {}) {
    const searchText = String(filter.q || filter.query || "").trim();
    const likeValue = searchText ? `%${searchText}%` : null;
    const result = await query(
      `
select *
from knowledge_documents
where ($1::text is null or document_type = $1)
  and ($2::text is null or source_table = $2)
  and ($3::text is null or source_id = $3)
  and ($4::text is null or status = $4)
  and (
    $5::text is null
    or title ilike $6
    or content ilike $6
    or search_text @@ plainto_tsquery('simple', $5)
  )
order by updated_at desc, id
limit $7;
`,
      [
        filter.documentType || null,
        filter.sourceTable || null,
        filter.sourceId || null,
        filter.status || null,
        searchText || null,
        likeValue,
        filter.limit || 50
      ]
    );
    return result.rows.map(mapKnowledgeRow);
  }

  async semanticSearch() {
    return [];
  }
}

export function createDbKnowledgeRepository() {
  return new DbKnowledgeRepository();
}
