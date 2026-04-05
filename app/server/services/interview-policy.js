// 第二阶段引入的确定性策略层。
// 流程控制交给本地规则，模型只负责评估和表达。
function policyProviderMeta() {
  return {
    provider: "local",
    model: "interview-policy-v1",
    purpose: "deliberate",
    thinkingType: "disabled",
    toolMode: false,
    strategyLabel: "deterministic policy v1"
  };
}

function stageRef(stage, stageIndex) {
  if (!stage) {
    return null;
  }

  return {
    stageIndex,
    stageId: stage.id,
    category: stage.category,
    title: stage.title
  };
}

// 覆盖缺口按阶段/类别追踪，
// 这样策略层可以在不再调用模型的前提下判断“还有什么没问到”。
function listCoverageGaps(session) {
  return (session.plan?.stages || []).flatMap((stage, stageIndex) => {
    const bucket = session.coverage?.[stage.category];
    const planned = Math.max(bucket?.planned || 0, 1);
    const asked = bucket?.asked || 0;
    if (asked >= planned) {
      return [];
    }

    return [{
      stageIndex,
      stageId: stage.id,
      category: stage.category,
      title: stage.title,
      remaining: planned - asked
    }];
  });
}

function summarizeCoverageProgress(session, coverageGaps) {
  const plannedNodes = (session.topicGraph?.nodes || []).filter((node) => node.plannedCount > 0);
  const coveredPlannedNodes = plannedNodes.filter((node) => node.covered);
  const mustCover = session.policy?.mustCover || [];
  const coveredMustCoverCategories = mustCover.filter((category) => (session.coverage?.[category]?.asked || 0) > 0);
  const remainingCoverageGapCount = coverageGaps.reduce((sum, item) => sum + (item.remaining || 0), 0);
  const recentTurns = (session.turns || []).slice(-3);
  const recentTopicIds = new Set(recentTurns.map((turn) => turn.question?.topicId).filter(Boolean));

  return {
    plannedTopicCount: plannedNodes.length,
    coveredPlannedTopicCount: coveredPlannedNodes.length,
    plannedTopicCoverageRatio: plannedNodes.length
      ? coveredPlannedNodes.length / plannedNodes.length
      : 0,
    mustCoverCount: mustCover.length,
    coveredMustCoverCount: coveredMustCoverCategories.length,
    coveredMustCoverCategories,
    coveredAllMustCoverCategories: mustCover.length === 0 || coveredMustCoverCategories.length >= mustCover.length,
    remainingCoverageGapCount,
    recentUniqueTopicCount: recentTopicIds.size
  };
}

function findNextStageTarget(session, currentStageIndex) {
  const stages = session.plan?.stages || [];
  if (!stages.length) {
    return null;
  }

  const coverageGaps = listCoverageGaps(session);
  const nextGap = coverageGaps.find((item) => item.stageIndex > currentStageIndex) || coverageGaps[0];
  if (nextGap) {
    return nextGap;
  }

  const sequentialIndex = currentStageIndex < stages.length - 1
    ? currentStageIndex + 1
    : Math.max(0, Math.min(currentStageIndex, stages.length - 1));

  return stageRef(stages[sequentialIndex], sequentialIndex);
}

function getTopicNode(session, topicId) {
  if (!topicId) {
    return null;
  }
  return session.topicGraph?.nodes?.find((node) => node.id === topicId) || null;
}

function compareTopicCandidates(left, right) {
  return (
    (left.askCount || 0) - (right.askCount || 0) ||
    Number(Boolean(right.plannedCount)) - Number(Boolean(left.plannedCount)) ||
    (right.sourceCount || 0) - (left.sourceCount || 0) ||
    (right.evidenceCount || 0) - (left.evidenceCount || 0) ||
    (left.lastTurnIndex || 0) - (right.lastTurnIndex || 0) ||
    String(left.label || "").localeCompare(String(right.label || ""))
  );
}

// 先命中 stage.targetTopics，找不到再回退到同 category 的图谱节点。
// 排序上优先“少问过、证据多、计划内”的主题，保证覆盖效率和可追问性。
function pickStageTopicCandidate(session, stage, excludedTopicId = null) {
  if (!stage) {
    return null;
  }

  const preferredTopicIds = new Set((stage.targetTopics || []).map((topic) => topic.topicId).filter(Boolean));
  const graphNodes = session.topicGraph?.nodes || [];
  const candidates = graphNodes.filter((node) => {
    if (node.id === excludedTopicId) {
      return false;
    }

    if (preferredTopicIds.size > 0) {
      return preferredTopicIds.has(node.id);
    }

    return node.category === stage.category;
  });

  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort(compareTopicCandidates)[0];
}

function getActiveThread(session, turn) {
  const targetThreadId = turn?.threadId || session.currentThreadId;
  return session.topicThreads?.find((item) => item.id === targetThreadId) || null;
}

function getSessionSearchCount(session) {
  return (session.topicThreads || []).reduce((sum, thread) => sum + (thread.searchCount || 0), 0);
}

function remainingSearchBudget(session) {
  return Math.max(0, (session.policy?.searchBudgetPerSession || 0) - getSessionSearchCount(session));
}

function hasFreshnessSignal(text) {
  return /(latest|recent|trend|trends|state of|ecosystem|release|version|roadmap|benchmark|pricing|202[4-9]|202[0-9]|最新|近期|趋势|现状|生态|发布|版本|路线图|基准|价格)/i.test(String(text || ""));
}

function searchFriendlyCategory(category) {
  return ["ai_agent_design", "system_design", "game_framework"].includes(category);
}

// 只有当问题明显依赖最新外部信息、且 session/thread 预算仍然允许时，
// 才会放行联网搜索。
function evaluateSearchPolicy({ session, activeThread, category, text }) {
  const budgetRemaining = remainingSearchBudget(session);
  const alreadySearchedThisThread = (activeThread?.searchCount || 0) > 0;
  const freshnessSignal = hasFreshnessSignal(text);
  const allowedCategory = searchFriendlyCategory(category);
  const shouldSearch = Boolean(
    session.enableWebSearch &&
    budgetRemaining > 0 &&
    !alreadySearchedThisThread &&
    freshnessSignal &&
    allowedCategory
  );

  return {
    shouldSearch,
    budgetRemaining,
    alreadySearchedThisThread,
    freshnessSignal,
    allowedCategory,
    reason: shouldSearch
      ? "Need current external context for this topic."
      : "No current external context required."
  };
}

// 追问策略故意保守：
// 只有上一轮回答确实偏弱，且当前线程仍有深挖预算时才继续追问。
function evaluateThreadPolicy({ session, activeThread, assessment, policy, coverageProgress }) {
  const maxFollowups = policy.maxFollowupsPerThread || 2;
  const followupsUsed = activeThread?.followupCount || 0;
  const needsFollowup = Boolean(assessment?.followupNeeded || (assessment?.score ?? 0) <= 3);
  const score = assessment?.score ?? 0;
  const lowSignalAnswer = score <= 2;
  const followupBudget = lowSignalAnswer ? Math.min(maxFollowups, 1) : maxFollowups;
  const targetTurnCount = session.plan?.targetTurnCount || policy.minimumTurnsBeforeStop || 6;
  const turnsLeftBeforeTarget = Math.max(0, targetTurnCount - session.turns.length);
  const shouldReserveTurnsForCoverage = (
    coverageProgress.remainingCoverageGapCount > 0 &&
    turnsLeftBeforeTarget <= coverageProgress.remainingCoverageGapCount
  );
  const shouldPreferWrapUp = (
    session.turns.length >= targetTurnCount &&
    coverageProgress.coveredAllMustCoverCategories
  );
  const shouldContinue = Boolean(activeThread) && needsFollowup && !shouldReserveTurnsForCoverage && !shouldPreferWrapUp && followupsUsed < followupBudget;

  return {
    maxFollowups,
    followupBudget,
    followupsUsed,
    needsFollowup,
    lowSignalAnswer,
    shouldReserveTurnsForCoverage,
    shouldPreferWrapUp,
    turnsLeftBeforeTarget,
    shouldContinue,
    reason: shouldContinue
      ? "Answer still needs one more depth pass inside the same thread."
      : shouldPreferWrapUp
        ? "Target coverage is already complete, so the interview should wrap up instead of adding another follow-up."
      : shouldReserveTurnsForCoverage
        ? "Need to preserve remaining turns for uncovered topics."
        : lowSignalAnswer && followupsUsed >= followupBudget
          ? "Low-signal thread already consumed its limited follow-up budget."
          : "Thread has enough information or follow-up budget is exhausted."
  };
}

// 停止策略同时考虑最小覆盖要求和硬上限，
// 避免面试在评估模糊时无限拖长。
function evaluateStopPolicy({ session, coverageGaps, threadPolicy }) {
  const minimumTurnsBeforeStop = session.policy?.minimumTurnsBeforeStop || 6;
  const targetTurnCount = session.plan?.targetTurnCount || minimumTurnsBeforeStop;
  const hardTurnLimit = session.policy?.hardTurnLimit || Math.max(targetTurnCount + 2, minimumTurnsBeforeStop + 1);
  const turnCount = session.turns.length;
  const coverageProgress = summarizeCoverageProgress(session, coverageGaps);
  const reachedMinimumTurns = turnCount >= minimumTurnsBeforeStop;
  const reachedTargetTurns = turnCount >= targetTurnCount;
  const reachedHardLimit = turnCount >= hardTurnLimit;
  const coveredAllRequiredTopics = coverageGaps.length === 0;
  const stalledRecentCoverage = reachedTargetTurns && coverageProgress.recentUniqueTopicCount <= 1;

  const shouldStop = !threadPolicy.shouldContinue && (
    reachedHardLimit ||
    (reachedTargetTurns && coverageProgress.coveredAllMustCoverCategories && (
      coveredAllRequiredTopics ||
      coverageProgress.remainingCoverageGapCount <= 1 ||
      stalledRecentCoverage
    )) ||
    (reachedMinimumTurns && coveredAllRequiredTopics)
  );

  return {
    shouldStop,
    minimumTurnsBeforeStop,
    targetTurnCount,
    hardTurnLimit,
    reachedMinimumTurns,
    reachedTargetTurns,
    reachedHardLimit,
    coveredAllRequiredTopics,
    stalledRecentCoverage,
    coverageProgress,
    reason: shouldStop
      ? (
          reachedHardLimit
            ? "Reached hard turn limit."
            : reachedTargetTurns && coverageProgress.coveredAllMustCoverCategories
              ? "Target turn count reached and must-cover categories are already covered."
              : "Required coverage completed and minimum turn count reached."
        )
      : "Interview should continue."
  };
}

// 首题永远开启一个新的证据线程，
// 先把候选人与岗位的主线映射建立起来。
function buildStartDecision({ session, stage }) {
  const currentStageIndex = Math.max(0, session.stageIndex || 0);
  const topicNode = pickStageTopicCandidate(session, stage);
  const searchPolicy = evaluateSearchPolicy({
    session,
    activeThread: null,
    category: topicNode?.category || stage?.category,
    text: `${session.notes} ${session.job.title} ${session.job.description} ${session.role.name} ${topicNode?.label || ""}`
  });

  return {
    strategy: "policy_v1",
    action: "ask_new_question",
    threadMode: "new",
    shouldSearch: searchPolicy.shouldSearch,
    rationale: "Start from a concrete evidence-backed project and establish the candidate-job mapping first.",
    topicLabel: topicNode?.label || stage?.title || "Project warmup",
    stopCurrentThread: false,
    targetStageIndex: currentStageIndex,
    targetTopicId: topicNode?.id || null,
    targetTopicLabel: topicNode?.label || stage?.title || "Project warmup",
    targetTopicCategory: topicNode?.category || stage?.category || null,
    targetEvidenceSource: topicNode?.label || null,
    policyTrace: {
      coverageGaps: listCoverageGaps(session),
      selectedTopic: topicNode,
      searchPolicy
    },
    _providerMeta: policyProviderMeta()
  };
}

// 回答后的决策只在三件事之间选择：
// 继续追问、切换主题、结束面试。
function buildAnswerDecision({ session, stage, turn, assessment }) {
  const currentStageIndex = Math.max(0, session.stageIndex || 0);
  const activeThread = getActiveThread(session, turn);
  const currentTopicNode = getTopicNode(session, turn.question?.topicId || activeThread?.topicId || null);
  const coverageGaps = listCoverageGaps(session);
  const coverageProgress = summarizeCoverageProgress(session, coverageGaps);
  const threadPolicy = evaluateThreadPolicy({
    session,
    activeThread,
    assessment,
    policy: session.policy || {},
    coverageProgress
  });
  const stopPolicy = evaluateStopPolicy({
    session,
    coverageGaps,
    threadPolicy
  });

  if (threadPolicy.shouldContinue && !stopPolicy.reachedHardLimit) {
    return {
      strategy: "policy_v1",
      action: "ask_followup",
      threadMode: "continue",
      shouldSearch: false,
      rationale: threadPolicy.reason,
      topicLabel: currentTopicNode?.label || activeThread?.label || stage?.title || turn.question.topicCategory,
      stopCurrentThread: false,
      targetStageIndex: currentStageIndex,
      targetTopicId: currentTopicNode?.id || turn.question?.topicId || activeThread?.topicId || null,
      targetTopicLabel: currentTopicNode?.label || activeThread?.label || stage?.title || turn.question.topicCategory,
      targetTopicCategory: currentTopicNode?.category || turn.question?.topicCategory || stage?.category || null,
      targetEvidenceSource: turn.question?.evidenceSource || null,
      policyTrace: {
        coverageGaps,
        coverageProgress,
        selectedTopic: currentTopicNode,
        threadPolicy,
        stopPolicy,
        searchPolicy: {
          shouldSearch: false,
          reason: "Follow-up questions stay inside the current evidence thread."
        }
      },
      _providerMeta: policyProviderMeta()
    };
  }

  if (stopPolicy.shouldStop) {
    return {
      strategy: "policy_v1",
      action: "end_interview",
      threadMode: "close",
      shouldSearch: false,
      rationale: stopPolicy.reason,
      topicLabel: currentTopicNode?.label || activeThread?.label || stage?.title || turn.question.topicCategory,
      stopCurrentThread: true,
      targetStageIndex: currentStageIndex,
      targetTopicId: currentTopicNode?.id || turn.question?.topicId || activeThread?.topicId || null,
      targetTopicLabel: currentTopicNode?.label || activeThread?.label || stage?.title || turn.question.topicCategory,
      targetTopicCategory: currentTopicNode?.category || turn.question?.topicCategory || stage?.category || null,
      targetEvidenceSource: turn.question?.evidenceSource || null,
      policyTrace: {
        coverageGaps,
        coverageProgress,
        selectedTopic: currentTopicNode,
        threadPolicy,
        stopPolicy,
        searchPolicy: {
          shouldSearch: false,
          reason: "Interview is ready to conclude."
        }
      },
      _providerMeta: policyProviderMeta()
    };
  }

  const nextStage = findNextStageTarget(session, currentStageIndex);
  const nextTopicNode = pickStageTopicCandidate(session, nextStage, turn.question?.topicId || activeThread?.topicId || null)
    || pickStageTopicCandidate(session, stage, turn.question?.topicId || activeThread?.topicId || null);
  const searchPolicy = evaluateSearchPolicy({
    session,
    activeThread,
    category: nextTopicNode?.category || nextStage?.category || stage?.category || turn.question.topicCategory,
    text: `${turn.question.text} ${turn.answer} ${session.notes} ${(nextTopicNode?.label || nextStage?.title || "")}`
  });

  return {
    strategy: "policy_v1",
    action: "ask_new_question",
    threadMode: "close",
    shouldSearch: searchPolicy.shouldSearch,
    rationale: coverageGaps.length
      ? `Shift to the next coverage gap: ${nextTopicNode?.label || nextStage?.title || nextStage?.category || "next topic"}.`
      : "Current thread is sufficient; move to the next topic.",
    topicLabel: nextTopicNode?.label || nextStage?.title || nextStage?.category || stage?.title || turn.question.topicCategory,
    stopCurrentThread: true,
    targetStageIndex: Number.isInteger(nextStage?.stageIndex) ? nextStage.stageIndex : currentStageIndex,
    targetTopicId: nextTopicNode?.id || null,
    targetTopicLabel: nextTopicNode?.label || nextStage?.title || nextStage?.category || stage?.title || turn.question.topicCategory,
    targetTopicCategory: nextTopicNode?.category || nextStage?.category || stage?.category || turn.question.topicCategory,
    targetEvidenceSource: nextTopicNode?.label || null,
      policyTrace: {
        coverageGaps,
        coverageProgress,
        nextStage,
        selectedTopic: nextTopicNode,
        threadPolicy,
      stopPolicy,
      searchPolicy
    },
    _providerMeta: policyProviderMeta()
  };
}

export function buildInterviewPolicy(normalizedResume, job, role) {
  const estimatedYears = normalizedResume.profile.estimatedYearsExperience || 0;
  const mustCover = job.questionAreas || [];
  const minimumTurnsBeforeStop = Math.max(6, mustCover.length);
  const targetTurnCount = Math.max(minimumTurnsBeforeStop, mustCover.length + 2);

  return {
    estimatedYears,
    targetLevel: estimatedYears >= 5 ? "senior" : "mid",
    maxFollowupsPerThread: estimatedYears >= 5 ? 3 : 2,
    searchBudgetPerSession: /ai|agent/i.test(`${job.title} ${job.description} ${role.name} ${role.summary}`) ? 3 : 2,
    minimumTurnsBeforeStop,
    hardTurnLimit: Math.max(targetTurnCount + 2, minimumTurnsBeforeStop + 1),
    mustCover,
    roleBias: role.id
  };
}

// interview-service 只调用这一个公开入口，避免策略入口分散。
export function buildInterviewDecision({ mode, session, stage, turn = null, assessment = null }) {
  if (mode === "start") {
    return buildStartDecision({ session, stage });
  }

  return buildAnswerDecision({ session, stage, turn, assessment });
}
