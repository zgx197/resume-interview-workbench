import { query } from "../../db/client.js";
import { BackgroundJobRepository } from "../interfaces/background-job-repository.js";

function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapBackgroundJobRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    jobKey: row.job_key,
    kind: row.kind,
    targetType: row.target_type,
    targetId: row.target_id,
    sessionId: row.session_id,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: toIsoString(row.scheduled_at),
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: toIsoString(row.lease_expires_at),
    lastError: row.last_error,
    payload: row.payload_json || {},
    result: row.result_json || {},
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function normalizeLeaseMs(options = {}) {
  const value = Number(options.leaseMs || 60000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 60000;
}

function normalizeKinds(filter = {}) {
  return Array.isArray(filter.kinds) && filter.kinds.length
    ? filter.kinds
    : ["plan_refresh", "report", "thread_summary", "knowledge_embedding_sync"];
}

function normalizeStatuses(filter = {}) {
  return Array.isArray(filter.statuses) && filter.statuses.length
    ? filter.statuses
    : ["pending", "running", "leased"];
}

export class DbBackgroundJobRepository extends BackgroundJobRepository {
  async upsertSnapshot(input) {
    await query(
      `
insert into background_jobs (
  id,
  job_key,
  kind,
  target_type,
  target_id,
  session_id,
  status,
  priority,
  attempts,
  max_attempts,
  scheduled_at,
  started_at,
  finished_at,
  lease_owner,
  lease_expires_at,
  last_error,
  payload_json,
  result_json,
  created_at,
  updated_at
)
values (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, null, null, $14, $15::jsonb, $16::jsonb, $17, $18
)
on conflict (job_key) do update
set
  status = excluded.status,
  priority = excluded.priority,
  attempts = excluded.attempts,
  max_attempts = excluded.max_attempts,
  scheduled_at = excluded.scheduled_at,
  started_at = excluded.started_at,
  finished_at = excluded.finished_at,
  last_error = excluded.last_error,
  payload_json = excluded.payload_json,
  result_json = excluded.result_json,
  updated_at = excluded.updated_at;
`,
      [
        input.id,
        input.jobKey,
        input.kind,
        input.targetType,
        input.targetId,
        input.sessionId,
        input.status,
        input.priority ?? 100,
        input.attempts ?? 0,
        input.maxAttempts ?? 5,
        input.scheduledAt,
        input.startedAt || null,
        input.finishedAt || null,
        input.lastError || null,
        JSON.stringify(input.payload || {}),
        JSON.stringify(input.result || {}),
        input.createdAt,
        input.updatedAt
      ]
    );
    return this.getByJobKey(input.jobKey);
  }

  async listSnapshots(filter = {}) {
    const result = await query(
      `
select *
from background_jobs
where ($1::text is null or session_id = $1)
  and ($2::text is null or kind = $2)
  and ($3::text is null or status = $3)
order by scheduled_at desc, priority desc, updated_at desc
limit $4;
`,
      [
        filter.sessionId || null,
        filter.kind || null,
        filter.status || null,
        filter.limit || 50
      ]
    );
    return result.rows.map(mapBackgroundJobRow);
  }

  async getByJobKey(jobKey) {
    const result = await query(
      `
select *
from background_jobs
where job_key = $1
limit 1;
`,
      [jobKey]
    );
    return mapBackgroundJobRow(result.rows[0] || null);
  }

  async listResumable(filter = {}) {
    const kinds = normalizeKinds(filter);
    const statuses = normalizeStatuses(filter);
    const result = await query(
      `
select *
from background_jobs
where kind = any($1::text[])
  and status = any($2::text[])
  and ($3::text is null or session_id = $3)
  and (
    session_id is null
    or exists (
      select 1
      from interview_sessions session
      where session.id = background_jobs.session_id
    )
  )
  and (
    (status = 'pending' and scheduled_at <= now())
    or (
      status in ('leased', 'running')
      and (lease_expires_at is null or lease_expires_at <= now())
    )
  )
order by scheduled_at asc, updated_at asc, id asc
limit $4;
`,
      [
        kinds,
        statuses,
        filter.sessionId || null,
        filter.limit || 200
      ]
    );
    return result.rows.map(mapBackgroundJobRow);
  }

  async leaseNext(workerId, options = {}) {
    const leaseMs = normalizeLeaseMs(options);
    const result = await query(
      `
with candidate as (
  select id
  from background_jobs
  where kind = any($1::text[])
    and status = any($2::text[])
    and scheduled_at <= now()
    and (
      session_id is null
      or exists (
        select 1
        from interview_sessions session
        where session.id = background_jobs.session_id
      )
    )
    and (
      lease_expires_at is null
      or lease_expires_at <= now()
    )
    and attempts < max_attempts
  order by priority desc, scheduled_at asc, updated_at asc, id asc
  limit 1
  for update skip locked
)
update background_jobs job
set
  status = 'leased',
  lease_owner = $3,
  lease_expires_at = now() + (($4::text || ' milliseconds')::interval),
  started_at = coalesce(job.started_at, now()),
  attempts = job.attempts + 1,
  updated_at = now()
from candidate
where job.id = candidate.id
returning job.*;
`,
      [
        normalizeKinds(options),
        normalizeStatuses(options),
        workerId,
        String(leaseMs)
      ]
    );
    return mapBackgroundJobRow(result.rows[0] || null);
  }

  async leaseByJobKey(jobKey, workerId, options = {}) {
    const leaseMs = normalizeLeaseMs(options);
    const result = await query(
      `
update background_jobs
set
  status = 'leased',
  lease_owner = $2,
  lease_expires_at = now() + (($3::text || ' milliseconds')::interval),
  started_at = coalesce(started_at, now()),
  attempts = attempts + 1,
  updated_at = now()
where job_key = $1
  and scheduled_at <= now()
  and attempts < max_attempts
  and (
    session_id is null
    or exists (
      select 1
      from interview_sessions session
      where session.id = background_jobs.session_id
    )
  )
  and (
    lease_expires_at is null
    or lease_expires_at <= now()
  )
returning *;
`,
      [
        jobKey,
        workerId,
        String(leaseMs)
      ]
    );
    return mapBackgroundJobRow(result.rows[0] || null);
  }

  async startLease(jobKey, workerId) {
    const result = await query(
      `
update background_jobs
set
  status = 'running',
  started_at = coalesce(started_at, now()),
  updated_at = now()
where job_key = $1
  and lease_owner = $2
  and status in ('leased', 'running')
returning *;
`,
      [
        jobKey,
        workerId
      ]
    );
    return mapBackgroundJobRow(result.rows[0] || null);
  }

  async heartbeatLease(jobKey, workerId, options = {}) {
    const leaseMs = normalizeLeaseMs(options);
    const result = await query(
      `
update background_jobs
set
  lease_expires_at = now() + (($3::text || ' milliseconds')::interval),
  updated_at = now()
where job_key = $1
  and lease_owner = $2
  and status in ('leased', 'running')
returning *;
`,
      [
        jobKey,
        workerId,
        String(leaseMs)
      ]
    );
    return mapBackgroundJobRow(result.rows[0] || null);
  }

  async completeLease(jobKey, workerId, resultPayload = {}) {
    const result = await query(
      `
update background_jobs
set
  status = 'completed',
  lease_owner = null,
  lease_expires_at = null,
  finished_at = now(),
  last_error = null,
  result_json = $3::jsonb,
  updated_at = now()
where job_key = $1
  and lease_owner = $2
  and status in ('leased', 'running')
returning *;
`,
      [
        jobKey,
        workerId,
        JSON.stringify(resultPayload || {})
      ]
    );
    return mapBackgroundJobRow(result.rows[0] || null);
  }

  async failLease(jobKey, workerId, failure = {}) {
    const retryDelayMs = Number.isFinite(Number(failure.retryDelayMs)) ? Math.max(0, Math.floor(Number(failure.retryDelayMs))) : null;
    const shouldRetry = retryDelayMs != null;
    const result = await query(
      `
update background_jobs
set
  status = case
    when $3::boolean and attempts < max_attempts then 'pending'
    else 'failed'
  end,
  scheduled_at = case
    when $3::boolean and attempts < max_attempts then now() + (($4::text || ' milliseconds')::interval)
    else scheduled_at
  end,
  lease_owner = null,
  lease_expires_at = null,
  finished_at = case
    when $3::boolean and attempts < max_attempts then null
    else now()
  end,
  last_error = $5,
  result_json = $6::jsonb,
  updated_at = now()
where job_key = $1
  and lease_owner = $2
  and status in ('leased', 'running')
returning *;
`,
      [
        jobKey,
        workerId,
        shouldRetry,
        String(retryDelayMs || 0),
        failure.lastError || null,
        JSON.stringify(failure.result || {})
      ]
    );
    return mapBackgroundJobRow(result.rows[0] || null);
  }

  async recoverLeases(filter = {}) {
    const result = await query(
      `
update background_jobs
set
  status = case when attempts < max_attempts then 'pending' else 'failed' end,
  lease_owner = null,
  lease_expires_at = null,
  last_error = coalesce(last_error, 'lease_recovered'),
  finished_at = case when attempts < max_attempts then finished_at else now() end,
  updated_at = now()
where kind = any($1::text[])
  and status in ('leased', 'running')
  and (lease_expires_at is null or lease_expires_at <= now())
returning *;
`,
      [
        normalizeKinds(filter)
      ]
    );
    return result.rows.map(mapBackgroundJobRow);
  }

  async deleteOrphanedSessionJobs(filter = {}) {
    const kinds = Array.isArray(filter.kinds) && filter.kinds.length ? filter.kinds : null;
    const result = await query(
      `
delete from background_jobs
where session_id is not null
  and ($1::text[] is null or kind = any($1::text[]))
  and not exists (
    select 1
    from interview_sessions session
    where session.id = background_jobs.session_id
  )
returning id;
`,
      [kinds]
    );
    return result.rowCount || 0;
  }

  async getSummary(filter = {}) {
    const result = await query(
      `
with scoped_jobs as (
  select *
  from background_jobs
  where ($1::text is null or session_id = $1)
    and ($2::text is null or kind = $2)
    and ($3::text is null or status = $3)
),
status_counts as (
  select
    count(*)::int as total_count,
    count(*) filter (where status = 'pending')::int as pending_count,
    count(*) filter (where status = 'leased')::int as leased_count,
    count(*) filter (where status = 'running')::int as running_count,
    count(*) filter (where status = 'completed')::int as completed_count,
    count(*) filter (where status = 'failed')::int as failed_count,
    count(*) filter (
      where status = 'completed'
        and coalesce(result_json ->> 'skipped', 'false') = 'true'
    )::int as skipped_count,
    count(*) filter (
      where status = 'failed'
        and attempts >= max_attempts
    )::int as exhausted_count,
    count(*) filter (
      where status in ('leased', 'running')
        and lease_expires_at is not null
        and lease_expires_at <= now()
    )::int as expired_lease_count,
    count(*) filter (
      where status = 'pending'
        and attempts < max_attempts
        and scheduled_at <= now()
    )::int as ready_to_run_count
  from scoped_jobs
),
kind_counts as (
  select
    kind,
    count(*)::int as total_count,
    count(*) filter (where status = 'pending')::int as pending_count,
    count(*) filter (where status in ('leased', 'running'))::int as active_count,
    count(*) filter (where status = 'completed')::int as completed_count,
    count(*) filter (where status = 'failed')::int as failed_count,
    count(*) filter (
      where status = 'completed'
        and coalesce(result_json ->> 'skipped', 'false') = 'true'
    )::int as skipped_count,
    count(*) filter (
      where status = 'failed'
        and attempts >= max_attempts
    )::int as exhausted_count
  from scoped_jobs
  group by kind
)
select
  status_counts.*,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'kind', kind,
          'totalCount', total_count,
          'pendingCount', pending_count,
          'activeCount', active_count,
          'completedCount', completed_count,
          'failedCount', failed_count,
          'skippedCount', skipped_count,
          'exhaustedCount', exhausted_count
        )
        order by kind
      )
      from kind_counts
    ),
    '[]'::jsonb
  ) as kinds_json
from status_counts;
`,
      [
        filter.sessionId || null,
        filter.kind || null,
        filter.status || null
      ]
    );

    const row = result.rows[0] || {};
    return {
      totalCount: Number(row.total_count || 0),
      pendingCount: Number(row.pending_count || 0),
      leasedCount: Number(row.leased_count || 0),
      runningCount: Number(row.running_count || 0),
      completedCount: Number(row.completed_count || 0),
      failedCount: Number(row.failed_count || 0),
      skippedCount: Number(row.skipped_count || 0),
      exhaustedCount: Number(row.exhausted_count || 0),
      expiredLeaseCount: Number(row.expired_lease_count || 0),
      readyToRunCount: Number(row.ready_to_run_count || 0),
      kinds: Array.isArray(row.kinds_json) ? row.kinds_json : []
    };
  }
}

export function createDbBackgroundJobRepository() {
  return new DbBackgroundJobRepository();
}
