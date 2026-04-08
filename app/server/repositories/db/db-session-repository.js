import { query } from "../../db/client.js";
import { SessionRepository } from "../interfaces/session-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapSessionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    status: row.status,
    roleId: row.role_id,
    roleName: row.role_name,
    jobId: row.job_id,
    jobTitle: row.job_title,
    templateId: row.template_id,
    provider: row.provider,
    planStrategy: row.plan_strategy,
    stageIndex: row.stage_index,
    turnCount: row.turn_count,
    currentThreadId: row.current_thread_id,
    role: row.role_json || {},
    job: row.job_json || {},
    interviewTemplate: row.interview_template_json || {},
    notes: row.notes || "",
    enableWebSearch: Boolean(row.enable_web_search),
    plan: row.plan_json || {},
    coverage: row.coverage_json || {},
    topicGraph: row.topic_graph_json || {},
    nextQuestion: row.next_question_json || {},
    topicThreads: row.topic_threads_json || [],
    policy: row.policy_json || {},
    currentRunKind: row.current_run_kind || null,
    currentRunStatus: row.current_run_status || null,
    currentRunPhase: row.current_run_phase || null,
    currentRunRequestedAt: toIsoString(row.current_run_requested_at),
    currentRunStartedAt: toIsoString(row.current_run_started_at),
    currentRunCompletedAt: toIsoString(row.current_run_completed_at),
    currentRunDurationMs: row.current_run_duration_ms == null ? null : Number(row.current_run_duration_ms),
    currentRunError: row.current_run_error || null,
    currentRunPayload: row.current_run_payload_json || {},
    currentRunDebug: row.current_run_debug_json || {},
    currentRunPhaseStatus: row.current_run_phase_status_json || [],
    currentRun: row.current_run_json || {},
    planJob: row.plan_job_json || {},
    reportJob: row.report_job_json || {},
    currentStageId: row.current_stage_id || null,
    currentStageCategory: row.current_stage_category || null,
    currentStageTitle: row.current_stage_title || null,
    planStageCount: row.plan_stage_count == null ? 0 : Number(row.plan_stage_count),
    topicNodeCount: row.topic_node_count == null ? 0 : Number(row.topic_node_count),
    coveredTopicCount: row.covered_topic_count == null ? 0 : Number(row.covered_topic_count),
    topicThreadCount: row.topic_thread_count == null ? 0 : Number(row.topic_thread_count),
    activeTopicThreadCount: row.active_topic_thread_count == null ? 0 : Number(row.active_topic_thread_count),
    pendingThreadSummaryCount: row.pending_thread_summary_count == null ? 0 : Number(row.pending_thread_summary_count),
    currentThreadLabel: row.current_thread_label || null,
    currentThreadStatus: row.current_thread_status || null,
    pendingBackgroundJobCount: row.pending_background_job_count == null ? 0 : Number(row.pending_background_job_count),
    runningBackgroundJobCount: row.running_background_job_count == null ? 0 : Number(row.running_background_job_count),
    failedBackgroundJobCount: row.failed_background_job_count == null ? 0 : Number(row.failed_background_job_count),
    reportReady: Boolean(row.report_ready),
    resumableTurnIndex: row.resumable_turn_index == null ? null : Number(row.resumable_turn_index),
    version: row.version,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    completedAt: toIsoString(row.completed_at),
    snapshot: row.snapshot_json || {}
  };
}

export class DbSessionRepository extends SessionRepository {
  async upsertSession(input) {
    const result = await query(
      `
insert into interview_sessions (
  id,
  status,
  role_id,
  role_name,
  job_id,
  job_title,
  template_id,
  provider,
  plan_strategy,
  stage_index,
  turn_count,
  current_thread_id,
  version,
  created_at,
  updated_at,
  completed_at,
  snapshot_json,
  role_json,
  job_json,
  interview_template_json,
  notes,
  enable_web_search,
  plan_json,
  coverage_json,
  topic_graph_json,
  next_question_json,
  topic_threads_json,
  policy_json,
  current_run_kind,
  current_run_status,
  current_run_phase,
  current_run_requested_at,
  current_run_started_at,
  current_run_completed_at,
  current_run_duration_ms,
  current_run_error,
  current_run_payload_json,
  current_run_debug_json,
  current_run_phase_status_json,
  current_run_json,
  plan_job_json,
  report_job_json
)
values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14, $15, $16::jsonb,
  $17::jsonb, $18::jsonb, $19::jsonb, $20, $21, $22::jsonb, $23::jsonb, $24::jsonb, $25::jsonb, $26::jsonb,
  $27::jsonb, $28, $29, $30, $31, $32, $33, $34, $35, $36::jsonb, $37::jsonb, $38::jsonb, $39::jsonb, $40::jsonb, $41::jsonb
)
on conflict (id) do update
set
  status = excluded.status,
  role_id = excluded.role_id,
  role_name = excluded.role_name,
  job_id = excluded.job_id,
  job_title = excluded.job_title,
  template_id = excluded.template_id,
  provider = excluded.provider,
  plan_strategy = excluded.plan_strategy,
  stage_index = excluded.stage_index,
  turn_count = excluded.turn_count,
  current_thread_id = excluded.current_thread_id,
  version = interview_sessions.version + 1,
  updated_at = excluded.updated_at,
  completed_at = excluded.completed_at,
  snapshot_json = excluded.snapshot_json,
  role_json = excluded.role_json,
  job_json = excluded.job_json,
  interview_template_json = excluded.interview_template_json,
  notes = excluded.notes,
  enable_web_search = excluded.enable_web_search,
  plan_json = excluded.plan_json,
  coverage_json = excluded.coverage_json,
  topic_graph_json = excluded.topic_graph_json,
  next_question_json = excluded.next_question_json,
  topic_threads_json = excluded.topic_threads_json,
  policy_json = excluded.policy_json,
  current_run_kind = excluded.current_run_kind,
  current_run_status = excluded.current_run_status,
  current_run_phase = excluded.current_run_phase,
  current_run_requested_at = excluded.current_run_requested_at,
  current_run_started_at = excluded.current_run_started_at,
  current_run_completed_at = excluded.current_run_completed_at,
  current_run_duration_ms = excluded.current_run_duration_ms,
  current_run_error = excluded.current_run_error,
  current_run_payload_json = excluded.current_run_payload_json,
  current_run_debug_json = excluded.current_run_debug_json,
  current_run_phase_status_json = excluded.current_run_phase_status_json,
  current_run_json = excluded.current_run_json,
  plan_job_json = excluded.plan_job_json,
  report_job_json = excluded.report_job_json
where ($42::integer is null or interview_sessions.version = $42)
returning *;
`,
      [
        input.id,
        input.status,
        input.roleId || null,
        input.roleName || null,
        input.jobId || null,
        input.jobTitle || null,
        input.templateId || null,
        input.provider || null,
        input.planStrategy || null,
        input.stageIndex ?? 0,
        input.turnCount ?? 0,
        input.currentThreadId || null,
        input.createdAt,
        input.updatedAt,
        input.completedAt || null,
        JSON.stringify(input.snapshot || {}),
        JSON.stringify(input.role || {}),
        JSON.stringify(input.job || {}),
        JSON.stringify(input.interviewTemplate || {}),
        input.notes || "",
        Boolean(input.enableWebSearch),
        JSON.stringify(input.plan || {}),
        JSON.stringify(input.coverage || {}),
        JSON.stringify(input.topicGraph || {}),
        JSON.stringify(input.nextQuestion || {}),
        JSON.stringify(input.topicThreads || []),
        JSON.stringify(input.policy || {}),
        input.currentRunKind || null,
        input.currentRunStatus || null,
        input.currentRunPhase || null,
        input.currentRunRequestedAt || null,
        input.currentRunStartedAt || null,
        input.currentRunCompletedAt || null,
        input.currentRunDurationMs ?? null,
        input.currentRunError || null,
        JSON.stringify(input.currentRunPayload || {}),
        JSON.stringify(input.currentRunDebug || {}),
        JSON.stringify(input.currentRunPhaseStatus || []),
        JSON.stringify(input.currentRun || {}),
        JSON.stringify(input.planJob || {}),
        JSON.stringify(input.reportJob || {}),
        Number.isInteger(input.expectedVersion) ? input.expectedVersion : null
      ]
    );

    if (!result.rows[0] && Number.isInteger(input.expectedVersion)) {
      const existing = await query(
        `select version from interview_sessions where id = $1 limit 1;`,
        [input.id]
      );

      if (existing.rows[0]) {
        const error = new Error(
          `Session version conflict for ${input.id}: expected ${input.expectedVersion}, actual ${existing.rows[0].version}`
        );
        error.code = "SESSION_VERSION_CONFLICT";
        error.sessionId = input.id;
        error.expectedVersion = input.expectedVersion;
        error.actualVersion = existing.rows[0].version;
        throw error;
      }
    }

    return mapSessionRow(result.rows[0] || null);
  }

  async getById(sessionId) {
    const result = await query(
      `select * from interview_sessions where id = $1 limit 1;`,
      [sessionId]
    );
    return mapSessionRow(result.rows[0] || null);
  }

  async listRecent(filter = {}) {
    const result = await query(
      `
select
  s.*,
  current_stage.stage_id as current_stage_id,
  current_stage.category as current_stage_category,
  current_stage.title as current_stage_title,
  coalesce(stage_summary.plan_stage_count, 0) as plan_stage_count,
  coalesce(node_summary.topic_node_count, 0) as topic_node_count,
  coalesce(node_summary.covered_topic_count, 0) as covered_topic_count,
  coalesce(thread_summary.topic_thread_count, 0) as topic_thread_count,
  coalesce(thread_summary.active_topic_thread_count, 0) as active_topic_thread_count,
  coalesce(thread_summary.pending_thread_summary_count, 0) as pending_thread_summary_count,
  current_thread.label as current_thread_label,
  current_thread.status as current_thread_status,
  coalesce(job_summary.pending_background_job_count, 0) as pending_background_job_count,
  coalesce(job_summary.running_background_job_count, 0) as running_background_job_count,
  coalesce(job_summary.failed_background_job_count, 0) as failed_background_job_count,
  coalesce(report_summary.report_ready, false) as report_ready,
  nullif(s.current_run_payload_json ->> 'turnIndex', '')::integer as resumable_turn_index
from interview_sessions s
left join lateral (
  select count(*)::int as plan_stage_count
  from session_plan_stages
  where session_id = s.id
) stage_summary on true
left join lateral (
  select stage_id, category, title
  from session_plan_stages
  where session_id = s.id
    and position = greatest(1, s.stage_index + 1)
  limit 1
) current_stage on true
left join lateral (
  select
    count(*)::int as topic_node_count,
    count(*) filter (where covered)::int as covered_topic_count
  from session_topic_nodes
  where session_id = s.id
) node_summary on true
left join lateral (
  select
    count(*)::int as topic_thread_count,
    count(*) filter (where status = 'active')::int as active_topic_thread_count,
    count(*) filter (
      where coalesce(summary_job_json ->> 'status', 'idle') in ('pending', 'running')
    )::int as pending_thread_summary_count
  from session_topic_threads
  where session_id = s.id
) thread_summary on true
left join lateral (
  select label, status
  from session_topic_threads
  where session_id = s.id
    and (
      id = s.current_thread_id
      or (s.current_thread_id is null and status = 'active')
    )
  order by case when id = s.current_thread_id then 0 else 1 end, updated_at desc, id asc
  limit 1
) current_thread on true
left join lateral (
  select
    count(*) filter (where status in ('pending', 'running', 'leased'))::int as pending_background_job_count,
    count(*) filter (where status = 'running')::int as running_background_job_count,
    count(*) filter (where status = 'failed')::int as failed_background_job_count
  from background_jobs
  where session_id = s.id
) job_summary on true
left join lateral (
  select true as report_ready
  from session_reports
  where session_id = s.id
  limit 1
) report_summary on true
where ($1::text is null or s.status = $1)
order by s.created_at desc, s.id desc
limit $2;
`,
      [
        filter.status || null,
        filter.limit || 100
      ]
    );
    return result.rows.map(mapSessionRow);
  }

  async listResumableRuns(filter = {}) {
    const result = await query(
      `
select
  s.*,
  current_stage.stage_id as current_stage_id,
  current_stage.category as current_stage_category,
  current_stage.title as current_stage_title,
  coalesce(stage_summary.plan_stage_count, 0) as plan_stage_count,
  coalesce(node_summary.topic_node_count, 0) as topic_node_count,
  coalesce(node_summary.covered_topic_count, 0) as covered_topic_count,
  coalesce(thread_summary.topic_thread_count, 0) as topic_thread_count,
  coalesce(thread_summary.active_topic_thread_count, 0) as active_topic_thread_count,
  coalesce(thread_summary.pending_thread_summary_count, 0) as pending_thread_summary_count,
  current_thread.label as current_thread_label,
  current_thread.status as current_thread_status,
  coalesce(job_summary.pending_background_job_count, 0) as pending_background_job_count,
  coalesce(job_summary.running_background_job_count, 0) as running_background_job_count,
  coalesce(job_summary.failed_background_job_count, 0) as failed_background_job_count,
  coalesce(report_summary.report_ready, false) as report_ready,
  nullif(s.current_run_payload_json ->> 'turnIndex', '')::integer as resumable_turn_index
from interview_sessions s
left join lateral (
  select count(*)::int as plan_stage_count
  from session_plan_stages
  where session_id = s.id
) stage_summary on true
left join lateral (
  select stage_id, category, title
  from session_plan_stages
  where session_id = s.id
    and position = greatest(1, s.stage_index + 1)
  limit 1
) current_stage on true
left join lateral (
  select
    count(*)::int as topic_node_count,
    count(*) filter (where covered)::int as covered_topic_count
  from session_topic_nodes
  where session_id = s.id
) node_summary on true
left join lateral (
  select
    count(*)::int as topic_thread_count,
    count(*) filter (where status = 'active')::int as active_topic_thread_count,
    count(*) filter (
      where coalesce(summary_job_json ->> 'status', 'idle') in ('pending', 'running')
    )::int as pending_thread_summary_count
  from session_topic_threads
  where session_id = s.id
) thread_summary on true
left join lateral (
  select label, status
  from session_topic_threads
  where session_id = s.id
    and (
      id = s.current_thread_id
      or (s.current_thread_id is null and status = 'active')
    )
  order by case when id = s.current_thread_id then 0 else 1 end, updated_at desc, id asc
  limit 1
) current_thread on true
left join lateral (
  select
    count(*) filter (where status in ('pending', 'running', 'leased'))::int as pending_background_job_count,
    count(*) filter (where status = 'running')::int as running_background_job_count,
    count(*) filter (where status = 'failed')::int as failed_background_job_count
  from background_jobs
  where session_id = s.id
) job_summary on true
left join lateral (
  select true as report_ready
  from session_reports
  where session_id = s.id
  limit 1
) report_summary on true
where s.status = 'processing'
  and coalesce(s.current_run_status, '') = 'running'
  and coalesce(s.current_run_kind, '') in ('start', 'answer')
order by s.updated_at asc, s.id asc
limit $1;
`,
      [
        filter.limit || 100
      ]
    );
    return result.rows.map(mapSessionRow);
  }
}

export function createDbSessionRepository() {
  return new DbSessionRepository();
}
