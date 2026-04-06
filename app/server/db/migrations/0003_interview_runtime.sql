create table if not exists interview_sessions (
  id text primary key,
  status text not null,
  role_id text null,
  role_name text null,
  job_id text null,
  job_title text null,
  template_id text null,
  provider text null,
  plan_strategy text null,
  stage_index integer not null default 0,
  turn_count integer not null default 0,
  current_thread_id text null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz null,
  snapshot_json jsonb not null default '{}'::jsonb
);

create index if not exists interview_sessions_status_updated_idx
  on interview_sessions (status, updated_at desc);

create index if not exists interview_sessions_role_job_idx
  on interview_sessions (role_id, job_id, updated_at desc);

create table if not exists interview_turns (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  turn_index integer not null,
  thread_id text null,
  question_text text not null default '',
  question_topic_category text null,
  question_topic_id text null,
  question_topic_label text null,
  answer_text text not null default '',
  processing boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  snapshot_json jsonb not null default '{}'::jsonb,
  unique (session_id, turn_index)
);

create index if not exists interview_turns_session_idx
  on interview_turns (session_id, turn_index);

create index if not exists interview_turns_topic_idx
  on interview_turns (question_topic_category, updated_at desc);

create table if not exists turn_assessments (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  turn_id text not null references interview_turns(id) on delete cascade,
  turn_index integer not null,
  strategy text null,
  score smallint null,
  confidence text null,
  followup_needed boolean not null default false,
  suggested_followup text null,
  strengths_json jsonb not null default '[]'::jsonb,
  risks_json jsonb not null default '[]'::jsonb,
  evidence_used_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  snapshot_json jsonb not null default '{}'::jsonb,
  unique (turn_id)
);

create index if not exists turn_assessments_session_score_idx
  on turn_assessments (session_id, score, updated_at desc);

create table if not exists session_reports (
  id text primary key,
  session_id text not null unique references interview_sessions(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  snapshot_json jsonb not null default '{}'::jsonb
);

create index if not exists session_reports_updated_idx
  on session_reports (updated_at desc);
