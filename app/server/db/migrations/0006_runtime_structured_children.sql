alter table interview_sessions
  add column if not exists current_run_phase text null,
  add column if not exists current_run_requested_at timestamptz null,
  add column if not exists current_run_started_at timestamptz null,
  add column if not exists current_run_completed_at timestamptz null,
  add column if not exists current_run_duration_ms integer null,
  add column if not exists current_run_error text null,
  add column if not exists current_run_payload_json jsonb not null default '{}'::jsonb,
  add column if not exists current_run_debug_json jsonb not null default '{}'::jsonb,
  add column if not exists current_run_phase_status_json jsonb not null default '[]'::jsonb;

create table if not exists session_plan_stages (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  stage_id text not null,
  position integer not null,
  category text null,
  title text not null,
  goal text null,
  prompt_hint text null,
  target_topics_json jsonb not null default '[]'::jsonb,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (session_id, stage_id),
  unique (session_id, position)
);

create index if not exists session_plan_stages_session_position_idx
  on session_plan_stages (session_id, position);

create table if not exists session_topic_nodes (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  node_id text not null,
  label text not null,
  category text null,
  stage_ids_json jsonb not null default '[]'::jsonb,
  stage_titles_json jsonb not null default '[]'::jsonb,
  planned_count integer not null default 0,
  ask_count integer not null default 0,
  average_score double precision null,
  last_score double precision null,
  last_turn_index integer null,
  thread_count integer not null default 0,
  active_thread_id text null,
  current_question boolean not null default false,
  covered boolean not null default false,
  status text not null default 'idle',
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (session_id, node_id)
);

create index if not exists session_topic_nodes_session_status_idx
  on session_topic_nodes (session_id, status, updated_at desc);

create table if not exists session_topic_threads (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  topic_id text null,
  category text not null,
  label text not null,
  stage_id text null,
  status text not null default 'active',
  question_count integer not null default 0,
  answer_count integer not null default 0,
  followup_count integer not null default 0,
  search_count integer not null default 0,
  last_decision text null,
  closure_reason text null,
  evidence_source text null,
  last_question_text text null,
  last_evidence_source text null,
  last_assessment_score double precision null,
  summary text null,
  summary_signals_json jsonb not null default '[]'::jsonb,
  summary_risks_json jsonb not null default '[]'::jsonb,
  summary_updated_at timestamptz null,
  summary_job_json jsonb not null default '{}'::jsonb,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  closed_at timestamptz null
);

create index if not exists session_topic_threads_session_updated_idx
  on session_topic_threads (session_id, updated_at desc);
