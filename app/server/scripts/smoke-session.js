import { loadEnvFile } from "../env.js";
import { answerInterviewQuestion, createInterviewSession, getInterviewSession } from "../services/interview-service.js";

// 不依赖浏览器，直接从脚本层把异步面试链路跑通。
async function waitForSession(sessionId, predicate, timeoutMs = 360000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = await getInterviewSession(sessionId);
    if (predicate(session)) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for session ${sessionId}`);
}

async function main() {
  await loadEnvFile();

  const created = await createInterviewSession({
    roleId: "unity-technical-lead",
    jobId: "unity-gameplay-engineer",
    notes: "请偏重最近项目、系统设计与 AI Agent 设计"
  });
  const session = await waitForSession(created.id, (current) => current.status !== "processing");

  console.log("session:", session.id);
  console.log("plan strategy:", session.plan.strategy);
  console.log("question strategy:", session.nextQuestion.strategy);
  console.log("first question:", session.nextQuestion.text);

  const submitted = await answerInterviewQuestion(
    session.id,
    [
      "我会把编辑器创作、导出契约和运行时解释执行分成三层边界。",
      "编辑器层负责蓝图编辑、语义校验和资产组织；导出层负责把图结构收敛成稳定的 DSL/中间表示；运行时层只消费确定的数据契约并推进状态。",
      "这样做的核心权衡是前置更多导出校验成本，换运行时稳定性和可回放性。",
      "如果重来一次，我会更早把调试回放和契约 diff 工具纳入链路。"
    ].join("")
  );
  const next = await waitForSession(submitted.id, (current) => current.status !== "processing");

  console.log("turns:", next.turns.length);
  console.log("next status:", next.status);
  console.log("assessment score:", next.turns[0].assessment.score);
  console.log("followup needed:", next.turns[0].assessment.followupNeeded);
  console.log("next question strategy:", next.nextQuestion?.strategy || "completed");
  console.log("next question:", next.nextQuestion?.text || "none");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
