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
function evaluateThreadPolicy({ activeThread, assessment, policy }) {
  const maxFollowups = policy.maxFollowupsPerThread || 2;
  const followupsUsed = activeThread?.followupCount || 0;
  const needsFollowup = Boolean(assessment?.followupNeeded || (assessment?.score ?? 0) <= 3);
  const shouldContinue = Boolean(activeThread) && needsFollowup && followupsUsed < maxFollowups;

  return {
    maxFollowups,
    followupsUsed,
    needsFollowup,
    shouldContinue,
    reason: shouldContinue
      ? "Answer still needs one more depth pass inside the same thread."
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
  const reachedMinimumTurns = turnCount >= minimumTurnsBeforeStop;
  const reachedHardLimit = turnCount >= hardTurnLimit;
  const coveredAllRequiredTopics = coverageGaps.length === 0;

  const shouldStop = !threadPolicy.shouldContinue && (
    reachedHardLimit ||
    (reachedMinimumTurns && coveredAllRequiredTopics)
  );

  return {
    shouldStop,
    minimumTurnsBeforeStop,
    targetTurnCount,
    hardTurnLimit,
    reachedMinimumTurns,
    reachedHardLimit,
    coveredAllRequiredTopics,
    reason: shouldStop
      ? (reachedHardLimit ? "Reached hard turn limit." : "Required coverage completed and minimum turn count reached.")
      : "Interview should continue."
  };
}

// 首题永远开启一个新的证据线程，
// 先把候选人与岗位的主线映射建立起来。
function buildStartDecision({ session, stage }) {
  const currentStageIndex = Math.max(0, session.stageIndex || 0);
  const searchPolicy = evaluateSearchPolicy({
    session,
    activeThread: null,
    category: stage?.category,
    text: `${session.notes} ${session.job.title} ${session.job.description} ${session.role.name}`
  });

  return {
    strategy: "policy_v1",
    action: "ask_new_question",
    threadMode: "new",
    shouldSearch: searchPolicy.shouldSearch,
    rationale: "Start from a concrete evidence-backed project and establish the candidate-job mapping first.",
    topicLabel: stage?.title || "Project warmup",
    stopCurrentThread: false,
    targetStageIndex: currentStageIndex,
    policyTrace: {
      coverageGaps: listCoverageGaps(session),
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
  const coverageGaps = listCoverageGaps(session);
  const threadPolicy = evaluateThreadPolicy({
    activeThread,
    assessment,
    policy: session.policy || {}
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
      topicLabel: activeThread?.label || stage?.title || turn.question.topicCategory,
      stopCurrentThread: false,
      targetStageIndex: currentStageIndex,
      policyTrace: {
        coverageGaps,
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
      topicLabel: activeThread?.label || stage?.title || turn.question.topicCategory,
      stopCurrentThread: true,
      targetStageIndex: currentStageIndex,
      policyTrace: {
        coverageGaps,
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
  const searchPolicy = evaluateSearchPolicy({
    session,
    activeThread,
    category: nextStage?.category || stage?.category || turn.question.topicCategory,
    text: `${turn.question.text} ${turn.answer} ${session.notes} ${(nextStage?.title || "")}`
  });

  return {
    strategy: "policy_v1",
    action: "ask_new_question",
    threadMode: "close",
    shouldSearch: searchPolicy.shouldSearch,
    rationale: coverageGaps.length
      ? `Shift to the next coverage gap: ${nextStage?.title || nextStage?.category || "next topic"}.`
      : "Current thread is sufficient; move to the next topic.",
    topicLabel: nextStage?.title || nextStage?.category || stage?.title || turn.question.topicCategory,
    stopCurrentThread: true,
    targetStageIndex: Number.isInteger(nextStage?.stageIndex) ? nextStage.stageIndex : currentStageIndex,
    policyTrace: {
      coverageGaps,
      nextStage,
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
