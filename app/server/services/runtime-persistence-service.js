import { createLogger } from "../lib/logger.js";
import { createDbAssessmentRepository } from "../repositories/db/db-assessment-repository.js";
import { createDbReportRepository } from "../repositories/db/db-report-repository.js";
import { createDbSessionPlanStageRepository } from "../repositories/db/db-session-plan-stage-repository.js";
import { createDbSessionTopicNodeRepository } from "../repositories/db/db-session-topic-node-repository.js";
import { createDbSessionTopicThreadRepository } from "../repositories/db/db-session-topic-thread-repository.js";
import { createDbSessionRepository } from "../repositories/db/db-session-repository.js";
import { createDbTurnRepository } from "../repositories/db/db-turn-repository.js";

const runtimeLogger = createLogger({ component: "runtime-db-sync" });
const sessionRepository = createDbSessionRepository();
const sessionPlanStageRepository = createDbSessionPlanStageRepository();
const sessionTopicNodeRepository = createDbSessionTopicNodeRepository();
const sessionTopicThreadRepository = createDbSessionTopicThreadRepository();
const turnRepository = createDbTurnRepository();
const assessmentRepository = createDbAssessmentRepository();
const reportRepository = createDbReportRepository();

function buildRuntimeSessionRecord(session) {
  return {
    id: session.id,
    status: session.status,
    roleId: session.role?.id || null,
    roleName: session.role?.name || null,
    jobId: session.job?.id || null,
    jobTitle: session.job?.title || null,
    templateId: session.interviewTemplate?.id || null,
    provider: session.provider || null,
    planStrategy: session.plan?.strategy || null,
    stageIndex: session.stageIndex ?? 0,
    turnCount: session.turns?.length || 0,
    currentThreadId: session.currentThreadId || null,
    role: session.role || {},
    job: session.job || {},
    interviewTemplate: session.interviewTemplate || {},
    notes: session.notes || "",
    enableWebSearch: Boolean(session.enableWebSearch),
    plan: session.plan || {},
    coverage: session.coverage || {},
    topicGraph: session.topicGraph || {},
    nextQuestion: session.nextQuestion || {},
    topicThreads: session.topicThreads || [],
    policy: session.policy || {},
    currentRunKind: session.currentRun?.kind || null,
    currentRunStatus: session.currentRun?.status || null,
    currentRunPhase: session.currentRun?.phase || null,
    currentRunRequestedAt: session.currentRun?.requestedAt || null,
    currentRunStartedAt: session.currentRun?.startedAt || null,
    currentRunCompletedAt: session.currentRun?.completedAt || null,
    currentRunDurationMs: session.currentRun?.durationMs ?? null,
    currentRunError: session.currentRun?.error || null,
    currentRunPayload: session.currentRun?.payload || {},
    currentRunDebug: session.currentRun?.debug || {},
    currentRunPhaseStatus: session.currentRun?.phaseStatus || [],
    currentRun: session.currentRun || {},
    planJob: session.planJob || {},
    reportJob: session.reportJob || {},
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.status === "completed" ? session.updatedAt : null,
    expectedVersion: Number.isInteger(session.version) ? session.version : null,
    snapshot: session
  };
}

export async function syncInterviewRuntimeSnapshot(session) {
  const span = runtimeLogger.startSpan("runtime_db.sync_session", {
    sessionId: session.id,
    status: session.status,
    turnCount: session.turns?.length || 0
  });

  try {
    const persistedSession = await sessionRepository.upsertSession(buildRuntimeSessionRecord(session));
    await sessionPlanStageRepository.replaceForSession(session, session.plan?.stages || []);
    await sessionTopicNodeRepository.replaceForSession(session, session.topicGraph?.nodes || []);
    await sessionTopicThreadRepository.replaceForSession(session, session.topicThreads || []);
    await turnRepository.upsertTurns(session, session.turns || []);
    await assessmentRepository.upsertAssessments(session, session.turns || []);
    if (session.report) {
      await reportRepository.upsertReport(session);
    }
    span.end({
      sessionId: session.id,
      version: persistedSession?.version || null,
      turnCount: session.turns?.length || 0
    });
    return persistedSession;
  } catch (error) {
    span.fail(error, {
      sessionId: session.id
    });
    throw error;
  }
}

export async function syncInterviewRuntimeSnapshotSafely(session, logContext = {}) {
  try {
    return await syncInterviewRuntimeSnapshot(session);
  } catch (error) {
    runtimeLogger.warn("runtime_db.sync_failed", error, {
      sessionId: session.id,
      status: session.status,
      turnCount: session.turns?.length || 0,
      ...logContext
    });
    return null;
  }
}
