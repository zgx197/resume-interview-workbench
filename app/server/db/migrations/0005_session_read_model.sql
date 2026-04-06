alter table interview_sessions
  add column if not exists role_json jsonb not null default '{}'::jsonb,
  add column if not exists job_json jsonb not null default '{}'::jsonb,
  add column if not exists interview_template_json jsonb not null default '{}'::jsonb,
  add column if not exists notes text not null default '',
  add column if not exists enable_web_search boolean not null default false,
  add column if not exists plan_json jsonb not null default '{}'::jsonb,
  add column if not exists coverage_json jsonb not null default '{}'::jsonb,
  add column if not exists topic_graph_json jsonb not null default '{}'::jsonb,
  add column if not exists next_question_json jsonb not null default '{}'::jsonb,
  add column if not exists topic_threads_json jsonb not null default '[]'::jsonb,
  add column if not exists policy_json jsonb not null default '{}'::jsonb,
  add column if not exists current_run_kind text null,
  add column if not exists current_run_status text null,
  add column if not exists current_run_json jsonb not null default '{}'::jsonb,
  add column if not exists plan_job_json jsonb not null default '{}'::jsonb,
  add column if not exists report_job_json jsonb not null default '{}'::jsonb;

create index if not exists interview_sessions_current_run_idx
  on interview_sessions (current_run_status, current_run_kind, updated_at asc);
