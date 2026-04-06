create table if not exists interview_templates (
  id text primary key,
  template_key text not null unique,
  status text not null default 'active',
  current_version_no integer not null default 1,
  recent_used_at timestamptz null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz null
);

create table if not exists template_versions (
  id text primary key,
  template_id text not null references interview_templates(id) on delete cascade,
  version_no integer not null,
  name text not null,
  company_name text not null,
  company_intro text not null default '',
  job_direction text not null,
  job_description text not null,
  additional_context text not null default '',
  interviewer_role_name text not null,
  role_id text not null,
  job_id text not null,
  content_hash text not null,
  created_at timestamptz not null,
  unique (template_id, version_no)
);

create index if not exists interview_templates_status_updated_idx
  on interview_templates (status, updated_at desc);

create index if not exists interview_templates_recent_used_idx
  on interview_templates (recent_used_at desc nulls last, updated_at desc);

create table if not exists review_items (
  id text primary key,
  review_key text not null unique,
  source_session_id text null,
  source_turn_id text null,
  question_id text null,
  topic_id text null,
  topic_label text null,
  weakness_type text not null,
  title text not null,
  evidence_summary text not null,
  recommended_question_ids jsonb not null default '[]'::jsonb,
  priority integer not null default 50,
  status text not null default 'pending',
  mastery_level smallint not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  resolved_at timestamptz null
);

create index if not exists review_items_status_priority_idx
  on review_items (status, priority desc, updated_at desc);

create table if not exists background_jobs (
  id text primary key,
  job_key text not null unique,
  kind text not null,
  target_type text not null,
  target_id text null,
  session_id text null,
  status text not null,
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  scheduled_at timestamptz not null,
  started_at timestamptz null,
  finished_at timestamptz null,
  lease_owner text null,
  lease_expires_at timestamptz null,
  last_error text null,
  payload_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists background_jobs_status_schedule_idx
  on background_jobs (status, scheduled_at, priority);

create table if not exists knowledge_documents (
  id text primary key,
  document_key text not null unique,
  document_type text not null,
  source_table text not null,
  source_id text null,
  title text not null,
  content text not null,
  search_text tsvector null,
  metadata_json jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  content_hash text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists knowledge_documents_status_updated_idx
  on knowledge_documents (document_type, status, updated_at desc);

create index if not exists knowledge_documents_search_idx
  on knowledge_documents using gin (search_text);

create table if not exists knowledge_embeddings (
  id text primary key,
  document_id text not null references knowledge_documents(id) on delete cascade,
  embedding_model text not null,
  embedding_version text null,
  embedding vector null,
  content_hash text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (document_id, embedding_model)
);
