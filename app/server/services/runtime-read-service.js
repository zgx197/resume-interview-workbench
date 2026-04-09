import { createDbAssessmentRepository } from "../repositories/db/db-assessment-repository.js";
import { createDbReportRepository } from "../repositories/db/db-report-repository.js";
import { createDbSessionPlanStageRepository } from "../repositories/db/db-session-plan-stage-repository.js";
import { createDbSessionTopicNodeRepository } from "../repositories/db/db-session-topic-node-repository.js";
import { createDbSessionTopicThreadRepository } from "../repositories/db/db-session-topic-thread-repository.js";
import { createDbTurnRepository } from "../repositories/db/db-turn-repository.js";

const turnRepository = createDbTurnRepository();
const assessmentRepository = createDbAssessmentRepository();
const reportRepository = createDbReportRepository();
const sessionPlanStageRepository = createDbSessionPlanStageRepository();
const sessionTopicNodeRepository = createDbSessionTopicNodeRepository();
const sessionTopicThreadRepository = createDbSessionTopicThreadRepository();

function normalizeObjectValue(value, fallback = null) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
    return value;
  }
  return fallback;
}

function normalizeArrayValue(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function normalizeBaseSession(snapshot, persistedRecord = {}) {
  const snapshotRecord = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot
    : {};
  return {
    id: persistedRecord.id || snapshotRecord.id || null,
    status: persistedRecord.status || snapshotRecord.status || null,
    createdAt: snapshotRecord.createdAt || persistedRecord.createdAt || null,
    updatedAt: persistedRecord.updatedAt || snapshotRecord.updatedAt || null,
    version: persistedRecord.version ?? snapshotRecord.version ?? null,
    provider: persistedRecord.provider || snapshotRecord.provider || null,
    stageIndex: persistedRecord.stageIndex ?? snapshotRecord.stageIndex ?? 0,
    currentThreadId: persistedRecord.currentThreadId || snapshotRecord.currentThreadId || null,
    role: normalizeObjectValue(persistedRecord.role, normalizeObjectValue(snapshotRecord.role, null)),
    job: normalizeObjectValue(persistedRecord.job, normalizeObjectValue(snapshotRecord.job, null)),
    interviewTemplate: normalizeObjectValue(
      persistedRecord.interviewTemplate,
      normalizeObjectValue(snapshotRecord.interviewTemplate, null)
    ),
    notes: persistedRecord.notes ?? snapshotRecord.notes ?? "",
    enableWebSearch: persistedRecord.enableWebSearch ?? snapshotRecord.enableWebSearch ?? false,
    plan: normalizeObjectValue(persistedRecord.plan, normalizeObjectValue(snapshotRecord.plan, null)),
    coverage: normalizeObjectValue(persistedRecord.coverage, normalizeObjectValue(snapshotRecord.coverage, null)),
    topicGraph: normalizeObjectValue(persistedRecord.topicGraph, normalizeObjectValue(snapshotRecord.topicGraph, null)),
    nextQuestion: normalizeObjectValue(persistedRecord.nextQuestion, normalizeObjectValue(snapshotRecord.nextQuestion, null)),
    topicThreads: normalizeArrayValue(persistedRecord.topicThreads, normalizeArrayValue(snapshotRecord.topicThreads, [])),
    policy: normalizeObjectValue(persistedRecord.policy, normalizeObjectValue(snapshotRecord.policy, null)),
    currentRun: normalizeObjectValue(persistedRecord.currentRun, normalizeObjectValue(snapshotRecord.currentRun, null)),
    currentRunKind: persistedRecord.currentRunKind || snapshotRecord.currentRun?.kind || null,
    currentRunStatus: persistedRecord.currentRunStatus || snapshotRecord.currentRun?.status || null,
    currentRunPhase: persistedRecord.currentRunPhase || snapshotRecord.currentRun?.phase || null,
    currentRunRequestedAt: persistedRecord.currentRunRequestedAt || snapshotRecord.currentRun?.requestedAt || null,
    currentRunStartedAt: persistedRecord.currentRunStartedAt || snapshotRecord.currentRun?.startedAt || null,
    currentRunCompletedAt: persistedRecord.currentRunCompletedAt || snapshotRecord.currentRun?.completedAt || null,
    currentRunDurationMs: persistedRecord.currentRunDurationMs ?? snapshotRecord.currentRun?.durationMs ?? null,
    currentRunError: persistedRecord.currentRunError || snapshotRecord.currentRun?.error || null,
    currentRunPayload: normalizeObjectValue(persistedRecord.currentRunPayload, normalizeObjectValue(snapshotRecord.currentRun?.payload, {})),
    currentRunDebug: normalizeObjectValue(persistedRecord.currentRunDebug, normalizeObjectValue(snapshotRecord.currentRun?.debug, {})),
    currentRunPhaseStatus: normalizeArrayValue(
      persistedRecord.currentRunPhaseStatus,
      normalizeArrayValue(snapshotRecord.currentRun?.phaseStatus, [])
    ),
    planJob: normalizeObjectValue(persistedRecord.planJob, normalizeObjectValue(snapshotRecord.planJob, null)),
    reportJob: normalizeObjectValue(persistedRecord.reportJob, normalizeObjectValue(snapshotRecord.reportJob, null)),
    turns: [],
    report: null
  };
}

function buildAssessmentMap(assessments = []) {
  const byTurnIndex = new Map();
  for (const assessment of assessments) {
    byTurnIndex.set(assessment.turnIndex, assessment);
  }
  return byTurnIndex;
}

function hydrateAssessment(assessmentRecord, fallbackAssessment = null) {
  if (!assessmentRecord) {
    return fallbackAssessment || null;
  }

  const snapshot = assessmentRecord.snapshot && typeof assessmentRecord.snapshot === "object"
    ? assessmentRecord.snapshot
    : {};

  return {
    ...snapshot,
    strategy: snapshot.strategy || assessmentRecord.strategy || null,
    score: snapshot.score ?? assessmentRecord.score ?? null,
    confidence: snapshot.confidence || assessmentRecord.confidence || null,
    followupNeeded: snapshot.followupNeeded ?? assessmentRecord.followupNeeded ?? false,
    suggestedFollowup: snapshot.suggestedFollowup || assessmentRecord.suggestedFollowup || null,
    strengths: Array.isArray(snapshot.strengths) ? snapshot.strengths : (assessmentRecord.strengths || []),
    risks: Array.isArray(snapshot.risks) ? snapshot.risks : (assessmentRecord.risks || []),
    evidenceUsed: Array.isArray(snapshot.evidenceUsed) ? snapshot.evidenceUsed : (assessmentRecord.evidenceUsed || []),
    createdAt: snapshot.createdAt || assessmentRecord.createdAt || null,
    updatedAt: assessmentRecord.updatedAt || snapshot.updatedAt || null
  };
}

function hydrateTurn(turnRecord, assessmentRecord) {
  const snapshot = turnRecord.snapshot && typeof turnRecord.snapshot === "object"
    ? turnRecord.snapshot
    : {};
  const questionSnapshot = snapshot.question && typeof snapshot.question === "object"
    ? snapshot.question
    : {};

  return {
    ...snapshot,
    index: snapshot.index ?? turnRecord.turnIndex,
    threadId: snapshot.threadId || turnRecord.threadId || null,
    answer: snapshot.answer ?? turnRecord.answerText ?? "",
    processing: snapshot.processing ?? turnRecord.processing ?? false,
    createdAt: snapshot.createdAt || turnRecord.createdAt || null,
    updatedAt: turnRecord.updatedAt || snapshot.updatedAt || null,
    question: {
      ...questionSnapshot,
      text: questionSnapshot.text || turnRecord.questionText || "",
      topicCategory: questionSnapshot.topicCategory || turnRecord.questionTopicCategory || null,
      topicId: questionSnapshot.topicId || turnRecord.questionTopicId || null,
      topicLabel: questionSnapshot.topicLabel || turnRecord.questionTopicLabel || null
    },
    assessment: hydrateAssessment(assessmentRecord, snapshot.assessment || null)
  };
}

function buildStructuredRole(sessionRecord, base) {
  if (base?.role?.id || base?.role?.name || base?.role?.summary) {
    return base.role;
  }

  if (!sessionRecord?.roleId && !sessionRecord?.roleName) {
    return base?.role || null;
  }

  return {
    ...(base?.role || {}),
    id: sessionRecord.roleId || base?.role?.id || null,
    name: sessionRecord.roleName || base?.role?.name || ""
  };
}

function buildStructuredJob(sessionRecord, base) {
  if (base?.job?.id || base?.job?.title || base?.job?.description) {
    return base.job;
  }

  if (!sessionRecord?.jobId && !sessionRecord?.jobTitle) {
    return base?.job || null;
  }

  return {
    ...(base?.job || {}),
    id: sessionRecord.jobId || base?.job?.id || null,
    title: sessionRecord.jobTitle || base?.job?.title || ""
  };
}

function buildStructuredTemplate(sessionRecord, base) {
  if (base?.interviewTemplate?.id || base?.interviewTemplate?.name) {
    return base.interviewTemplate;
  }

  if (!sessionRecord?.templateId) {
    return base?.interviewTemplate || null;
  }

  return {
    ...(base?.interviewTemplate || {}),
    id: sessionRecord.templateId
  };
}

function buildStructuredCurrentRun(base) {
  const currentRun = {
    ...(base?.currentRun || {})
  };

  if (!base?.currentRunKind && !base?.currentRunStatus && !base?.currentRunPhase && !Object.keys(currentRun).length) {
    return base?.currentRun || null;
  }

  currentRun.kind = base?.currentRunKind || currentRun.kind || null;
  currentRun.status = base?.currentRunStatus || currentRun.status || null;
  currentRun.phase = base?.currentRunPhase || currentRun.phase || null;
  currentRun.requestedAt = base?.currentRunRequestedAt || currentRun.requestedAt || null;
  currentRun.startedAt = base?.currentRunStartedAt || currentRun.startedAt || null;
  currentRun.completedAt = base?.currentRunCompletedAt || currentRun.completedAt || null;
  currentRun.durationMs = base?.currentRunDurationMs ?? currentRun.durationMs ?? null;
  currentRun.error = base?.currentRunError || currentRun.error || null;
  currentRun.payload = base?.currentRunPayload || currentRun.payload || {};
  currentRun.debug = base?.currentRunDebug || currentRun.debug || {};
  currentRun.phaseStatus = base?.currentRunPhaseStatus || currentRun.phaseStatus || [];
  return currentRun;
}

function buildSessionReadModelSummary(sessionRecord, base) {
  const planStageCount = Number(sessionRecord?.planStageCount || 0);
  const topicNodeCount = Number(sessionRecord?.topicNodeCount || 0);
  const coveredTopicCount = Number(sessionRecord?.coveredTopicCount || 0);
  const topicThreadCount = Number(sessionRecord?.topicThreadCount || 0);
  const activeTopicThreadCount = Number(sessionRecord?.activeTopicThreadCount || 0);
  const pendingThreadSummaryCount = Number(sessionRecord?.pendingThreadSummaryCount || 0);
  const pendingBackgroundJobCount = Number(sessionRecord?.pendingBackgroundJobCount || 0);
  const leasedBackgroundJobCount = Number(sessionRecord?.leasedBackgroundJobCount || 0);
  const runningBackgroundJobCount = Number(sessionRecord?.runningBackgroundJobCount || 0);
  const completedBackgroundJobCount = Number(sessionRecord?.completedBackgroundJobCount || 0);
  const skippedBackgroundJobCount = Number(sessionRecord?.skippedBackgroundJobCount || 0);
  const failedBackgroundJobCount = Number(sessionRecord?.failedBackgroundJobCount || 0);
  const exhaustedBackgroundJobCount = Number(sessionRecord?.exhaustedBackgroundJobCount || 0);
  const expiredLeaseBackgroundJobCount = Number(sessionRecord?.expiredLeaseBackgroundJobCount || 0);

  return {
    planStageCount,
    currentStage: sessionRecord?.currentStageTitle ? {
      id: sessionRecord.currentStageId || null,
      category: sessionRecord.currentStageCategory || null,
      title: sessionRecord.currentStageTitle
    } : null,
    topicNodeCount,
    coveredTopicCount,
    uncoveredTopicCount: Math.max(0, topicNodeCount - coveredTopicCount),
    topicThreadCount,
    activeTopicThreadCount,
    pendingThreadSummaryCount,
    currentThread: sessionRecord?.currentThreadLabel ? {
      id: sessionRecord.currentThreadId || base?.currentThreadId || null,
      label: sessionRecord.currentThreadLabel,
      status: sessionRecord.currentThreadStatus || null
    } : null,
    backgroundJobs: {
      pendingCount: pendingBackgroundJobCount,
      leasedCount: leasedBackgroundJobCount,
      runningCount: runningBackgroundJobCount,
      completedCount: completedBackgroundJobCount,
      skippedCount: skippedBackgroundJobCount,
      failedCount: failedBackgroundJobCount,
      exhaustedCount: exhaustedBackgroundJobCount,
      expiredLeaseCount: expiredLeaseBackgroundJobCount
    },
    reportReady: Boolean(sessionRecord?.reportReady)
  };
}

function hydratePlanWithStages(basePlan, stageRows = []) {
  if (!stageRows.length) {
    return basePlan || null;
  }

  return {
    ...(basePlan || {}),
    stages: stageRows.map((stageRow) => ({
      ...(stageRow.snapshot || {}),
      id: stageRow.stageId,
      category: stageRow.category || stageRow.snapshot?.category || null,
      title: stageRow.title || stageRow.snapshot?.title || "",
      goal: stageRow.goal || stageRow.snapshot?.goal || null,
      promptHint: stageRow.promptHint || stageRow.snapshot?.promptHint || null,
      targetTopics: stageRow.targetTopics || stageRow.snapshot?.targetTopics || []
    }))
  };
}

function hydrateTopicGraphWithNodes(baseTopicGraph, nodeRows = [], updatedAt = null) {
  if (!nodeRows.length) {
    return baseTopicGraph || null;
  }

  return {
    ...(baseTopicGraph || {}),
    nodes: nodeRows.map((nodeRow) => ({
      ...(nodeRow.snapshot || {}),
      id: nodeRow.nodeId,
      label: nodeRow.label || nodeRow.snapshot?.label || "",
      category: nodeRow.category || nodeRow.snapshot?.category || null,
      stageIds: nodeRow.stageIds || nodeRow.snapshot?.stageIds || [],
      stageTitles: nodeRow.stageTitles || nodeRow.snapshot?.stageTitles || [],
      plannedCount: nodeRow.plannedCount ?? nodeRow.snapshot?.plannedCount ?? 0,
      askCount: nodeRow.askCount ?? nodeRow.snapshot?.askCount ?? 0,
      averageScore: nodeRow.averageScore ?? nodeRow.snapshot?.averageScore ?? null,
      lastScore: nodeRow.lastScore ?? nodeRow.snapshot?.lastScore ?? null,
      lastTurnIndex: nodeRow.lastTurnIndex ?? nodeRow.snapshot?.lastTurnIndex ?? null,
      threadCount: nodeRow.threadCount ?? nodeRow.snapshot?.threadCount ?? 0,
      activeThreadId: nodeRow.activeThreadId || nodeRow.snapshot?.activeThreadId || null,
      currentQuestion: nodeRow.currentQuestion ?? nodeRow.snapshot?.currentQuestion ?? false,
      covered: nodeRow.covered ?? nodeRow.snapshot?.covered ?? false,
      status: nodeRow.status || nodeRow.snapshot?.status || "idle"
    })),
    edges: baseTopicGraph?.edges || [],
    updatedAt: updatedAt || baseTopicGraph?.updatedAt || null
  };
}

function hydrateTopicThreads(baseTopicThreads, threadRows = []) {
  if (!threadRows.length) {
    return baseTopicThreads || [];
  }

  return threadRows.map((threadRow) => ({
    ...(threadRow.snapshot || {}),
    id: threadRow.id,
    topicId: threadRow.topicId || threadRow.snapshot?.topicId || null,
    category: threadRow.category || threadRow.snapshot?.category || "",
    label: threadRow.label || threadRow.snapshot?.label || "",
    stageId: threadRow.stageId || threadRow.snapshot?.stageId || null,
    status: threadRow.status || threadRow.snapshot?.status || "active",
    questionCount: threadRow.questionCount ?? threadRow.snapshot?.questionCount ?? 0,
    answerCount: threadRow.answerCount ?? threadRow.snapshot?.answerCount ?? 0,
    followupCount: threadRow.followupCount ?? threadRow.snapshot?.followupCount ?? 0,
    searchCount: threadRow.searchCount ?? threadRow.snapshot?.searchCount ?? 0,
    lastDecision: threadRow.lastDecision || threadRow.snapshot?.lastDecision || null,
    closureReason: threadRow.closureReason || threadRow.snapshot?.closureReason || null,
    evidenceSource: threadRow.evidenceSource || threadRow.snapshot?.evidenceSource || null,
    lastQuestionText: threadRow.lastQuestionText || threadRow.snapshot?.lastQuestionText || null,
    lastEvidenceSource: threadRow.lastEvidenceSource || threadRow.snapshot?.lastEvidenceSource || null,
    lastAssessmentScore: threadRow.lastAssessmentScore ?? threadRow.snapshot?.lastAssessmentScore ?? null,
    summary: threadRow.summary || threadRow.snapshot?.summary || null,
    summarySignals: threadRow.summarySignals || threadRow.snapshot?.summarySignals || [],
    summaryRisks: threadRow.summaryRisks || threadRow.snapshot?.summaryRisks || [],
    summaryUpdatedAt: threadRow.summaryUpdatedAt || threadRow.snapshot?.summaryUpdatedAt || null,
    summaryJob: threadRow.summaryJob || threadRow.snapshot?.summaryJob || {},
    createdAt: threadRow.createdAt || threadRow.snapshot?.createdAt || null,
    updatedAt: threadRow.updatedAt || threadRow.snapshot?.updatedAt || null,
    closedAt: threadRow.closedAt || threadRow.snapshot?.closedAt || null
  }));
}

export function hydrateRuntimeSessionSummaryFromDbRecord(sessionRecord) {
  if (!sessionRecord) {
    return null;
  }

  const base = normalizeBaseSession(sessionRecord.snapshot || {}, sessionRecord);
  return {
    ...base,
    id: sessionRecord.id,
    status: sessionRecord.status,
    createdAt: base.createdAt || sessionRecord.createdAt,
    updatedAt: sessionRecord.updatedAt || base.updatedAt,
    version: sessionRecord.version ?? base.version ?? null,
    stageIndex: sessionRecord.stageIndex ?? base.stageIndex ?? 0,
    currentThreadId: sessionRecord.currentThreadId || base.currentThreadId || null,
    role: buildStructuredRole(sessionRecord, base),
    job: buildStructuredJob(sessionRecord, base),
    interviewTemplate: buildStructuredTemplate(sessionRecord, base),
    notes: base.notes || "",
    enableWebSearch: Boolean(base.enableWebSearch),
    provider: base.provider || sessionRecord.provider || null,
    plan: base.plan || null,
    coverage: base.coverage || null,
    topicGraph: base.topicGraph || null,
    nextQuestion: base.nextQuestion || null,
    topicThreads: base.topicThreads || [],
    policy: base.policy || null,
    currentRun: buildStructuredCurrentRun(base),
    readModelSummary: buildSessionReadModelSummary(sessionRecord, base),
    planJob: base.planJob || null,
    reportJob: base.reportJob || null,
    turns: Array.isArray(base.turns) ? base.turns : [],
    turnCount: sessionRecord.turnCount ?? (Array.isArray(base.turns) ? base.turns.length : 0),
    report: base.report || null,
    reportReady: sessionRecord.reportReady ?? Boolean(base.report)
  };
}

export function hydrateRuntimeSessionSummariesFromDbRecords(sessionRecords = []) {
  return sessionRecords.map(hydrateRuntimeSessionSummaryFromDbRecord).filter(Boolean);
}

export async function hydrateRuntimeSessionFromDbRecord(sessionRecord) {
  if (!sessionRecord) {
    return null;
  }

  const [turns, assessments, report, stageRows, nodeRows, threadRows] = await Promise.all([
    turnRepository.listBySessionId(sessionRecord.id),
    assessmentRepository.listBySessionId(sessionRecord.id),
    reportRepository.getBySessionId(sessionRecord.id),
    sessionPlanStageRepository.listBySessionId(sessionRecord.id),
    sessionTopicNodeRepository.listBySessionId(sessionRecord.id),
    sessionTopicThreadRepository.listBySessionId(sessionRecord.id)
  ]);

  const assessmentByTurnIndex = buildAssessmentMap(assessments);
  const base = normalizeBaseSession(sessionRecord.snapshot || {}, sessionRecord);

  return {
    ...base,
    id: sessionRecord.id,
    status: sessionRecord.status,
    createdAt: base.createdAt || sessionRecord.createdAt,
    updatedAt: sessionRecord.updatedAt || base.updatedAt,
    version: sessionRecord.version ?? base.version ?? null,
    stageIndex: sessionRecord.stageIndex ?? base.stageIndex ?? 0,
    currentThreadId: sessionRecord.currentThreadId || base.currentThreadId || null,
    role: buildStructuredRole(sessionRecord, base),
    job: buildStructuredJob(sessionRecord, base),
    interviewTemplate: buildStructuredTemplate(sessionRecord, base),
    notes: base.notes || "",
    enableWebSearch: Boolean(base.enableWebSearch),
    provider: base.provider || sessionRecord.provider || null,
    plan: hydratePlanWithStages(base.plan, stageRows),
    coverage: base.coverage || null,
    topicGraph: hydrateTopicGraphWithNodes(base.topicGraph, nodeRows, sessionRecord.updatedAt || base.updatedAt),
    nextQuestion: base.nextQuestion || null,
    topicThreads: hydrateTopicThreads(base.topicThreads, threadRows),
    policy: base.policy || null,
    currentRun: buildStructuredCurrentRun(base),
    readModelSummary: buildSessionReadModelSummary(sessionRecord, base),
    planJob: base.planJob || null,
    reportJob: base.reportJob || null,
    turns: turns.map((turn) => hydrateTurn(turn, assessmentByTurnIndex.get(turn.turnIndex))),
    report: report?.snapshot || base.report || null,
    reportReady: Boolean(report || sessionRecord.reportReady || base.report)
  };
}

export async function hydrateRuntimeSessionsFromDbRecords(sessionRecords = []) {
  const sessions = [];
  for (const sessionRecord of sessionRecords) {
    sessions.push(await hydrateRuntimeSessionFromDbRecord(sessionRecord));
  }
  return sessions.filter(Boolean);
}
