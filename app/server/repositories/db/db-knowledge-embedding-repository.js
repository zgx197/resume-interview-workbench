import { query } from "../../db/client.js";
import { KnowledgeEmbeddingRepository } from "../interfaces/knowledge-embedding-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapEmbeddingRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    documentId: row.document_id,
    embeddingModel: row.embedding_model,
    embeddingVersion: row.embedding_version,
    embeddingVector: row.embedding ? String(row.embedding) : null,
    contentHash: row.content_hash,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapStaleDocumentRow(row) {
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

export class DbKnowledgeEmbeddingRepository extends KnowledgeEmbeddingRepository {
  async upsertEmbedding(input) {
    const result = await query(
      `
insert into knowledge_embeddings (
  id,
  document_id,
  embedding_model,
  embedding_version,
  embedding,
  content_hash,
  created_at,
  updated_at
)
values ($1, $2, $3, $4, $5::vector, $6, $7, $8)
on conflict (document_id, embedding_model) do update
set
  embedding_version = excluded.embedding_version,
  embedding = excluded.embedding,
  content_hash = excluded.content_hash,
  updated_at = excluded.updated_at
returning *;
`,
      [
        input.id,
        input.documentId,
        input.embeddingModel,
        input.embeddingVersion || null,
        input.embeddingVector,
        input.contentHash,
        input.createdAt,
        input.updatedAt
      ]
    );
    return mapEmbeddingRow(result.rows[0] || null);
  }

  async getByDocumentId(documentId, embeddingModel) {
    const result = await query(
      `
select *
from knowledge_embeddings
where document_id = $1
  and embedding_model = $2
limit 1;
`,
      [documentId, embeddingModel]
    );
    return mapEmbeddingRow(result.rows[0] || null);
  }

  async listStaleDocuments(filter = {}) {
    const result = await query(
      `
select
  kd.*
from knowledge_documents kd
left join knowledge_embeddings ke
  on ke.document_id = kd.id
 and ke.embedding_model = $1
where kd.status = 'active'
  and ($2::text is null or kd.document_type = $2)
  and (
    ke.id is null
    or ke.content_hash <> kd.content_hash
  )
order by kd.updated_at asc
limit $3;
`,
      [
        filter.embeddingModel,
        filter.documentType || null,
        filter.limit || 20
      ]
    );
    return result.rows.map(mapStaleDocumentRow);
  }

  async searchNearestByVector(input) {
    const result = await query(
      `
select
  kd.id,
  kd.document_key,
  kd.document_type,
  kd.source_table,
  kd.source_id,
  kd.title,
  kd.content,
  kd.metadata_json,
  kd.status,
  kd.content_hash,
  kd.created_at,
  kd.updated_at,
  (ke.embedding <=> $2::vector) as distance
from knowledge_embeddings ke
join knowledge_documents kd on kd.id = ke.document_id
where ke.embedding_model = $1
  and kd.status = 'active'
  and ($3::text is null or kd.document_type = $3)
  and ($4::text is null or kd.id <> $4)
order by ke.embedding <=> $2::vector asc
limit $5;
`,
      [
        input.embeddingModel,
        input.embeddingVector,
        input.documentType || null,
        input.excludeDocumentId || null,
        input.limit || 10
      ]
    );

    return result.rows.map((row) => ({
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
      updatedAt: toIsoString(row.updated_at),
      distance: row.distance == null ? null : Number(row.distance)
    }));
  }

  async searchNearestToDocument(input) {
    const result = await query(
      `
select
  kd.id,
  kd.document_key,
  kd.document_type,
  kd.source_table,
  kd.source_id,
  kd.title,
  kd.content,
  kd.metadata_json,
  kd.status,
  kd.content_hash,
  kd.created_at,
  kd.updated_at,
  (candidate.embedding <=> base.embedding) as distance
from knowledge_embeddings base
join knowledge_embeddings candidate
  on candidate.embedding_model = base.embedding_model
join knowledge_documents kd
  on kd.id = candidate.document_id
where base.document_id = $1
  and base.embedding_model = $2
  and kd.status = 'active'
  and candidate.document_id <> $1
  and ($3::text is null or kd.document_type = $3)
order by candidate.embedding <=> base.embedding asc
limit $4;
`,
      [
        input.documentId,
        input.embeddingModel,
        input.documentType || null,
        input.limit || 10
      ]
    );

    return result.rows.map((row) => ({
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
      updatedAt: toIsoString(row.updated_at),
      distance: row.distance == null ? null : Number(row.distance)
    }));
  }
}

export function createDbKnowledgeEmbeddingRepository() {
  return new DbKnowledgeEmbeddingRepository();
}
