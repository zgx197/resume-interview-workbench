create table if not exists question_items (
  id text primary key,
  question_key text not null unique,
  canonical_text text not null,
  category text not null,
  difficulty smallint not null default 3,
  status text not null default 'active',
  source_type text not null,
  language text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz null
);

create index if not exists question_items_category_status_idx
  on question_items (category, status, updated_at desc);

create table if not exists question_variants (
  id text primary key,
  question_id text not null references question_items(id) on delete cascade,
  variant_text text not null,
  style text null,
  status text not null default 'active',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists question_sources (
  id text primary key,
  question_id text not null references question_items(id) on delete cascade,
  source_kind text not null,
  source_id text null,
  source_snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table if not exists question_tags (
  id text primary key,
  tag_key text not null unique,
  label text not null,
  category text null,
  created_at timestamptz not null
);

create table if not exists question_tag_links (
  question_id text not null references question_items(id) on delete cascade,
  tag_id text not null references question_tags(id) on delete cascade,
  primary key (question_id, tag_id)
);

create table if not exists question_usage_stats (
  question_id text primary key references question_items(id) on delete cascade,
  asked_count integer not null default 0,
  answered_count integer not null default 0,
  avg_score numeric(5, 2) null,
  avg_followup_count numeric(5, 2) null,
  last_asked_at timestamptz null,
  updated_at timestamptz not null
);
