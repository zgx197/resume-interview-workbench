create table if not exists review_item_attempts (
  id text primary key,
  review_item_id text not null references review_items(id) on delete cascade,
  review_key text not null,
  session_id text null,
  question_id text null,
  score smallint null,
  outcome text not null default 'reviewed',
  notes text not null default '',
  metadata_json jsonb not null default '{}'::jsonb,
  attempted_at timestamptz not null,
  created_at timestamptz not null
);

create index if not exists review_item_attempts_item_attempted_idx
  on review_item_attempts (review_item_id, attempted_at desc);

create table if not exists review_sets (
  id text primary key,
  set_key text not null unique,
  title text not null,
  description text not null default '',
  status text not null default 'active',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz null
);

create index if not exists review_sets_status_updated_idx
  on review_sets (status, updated_at desc);

create table if not exists review_set_items (
  review_set_id text not null references review_sets(id) on delete cascade,
  review_item_id text not null references review_items(id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null,
  metadata_json jsonb not null default '{}'::jsonb,
  primary key (review_set_id, review_item_id)
);

create index if not exists review_set_items_position_idx
  on review_set_items (review_set_id, position, added_at);

create index if not exists background_jobs_due_lease_idx
  on background_jobs (kind, status, scheduled_at, lease_expires_at, priority desc);
