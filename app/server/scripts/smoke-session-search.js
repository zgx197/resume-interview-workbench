import { loadEnvFile } from "../env.js";
import { createInterviewSession, getInterviewSession } from "../services/interview-service.js";

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
    roleId: "ai-systems-interviewer",
    jobId: "ai-game-tools-architect",
    notes: "请结合最新 AI Agent 工具链趋势与 Unity 生态提问",
    enableWebSearch: true
  });
  const session = await waitForSession(created.id, (current) => current.status !== "processing");

  console.log("session:", session.id);
  console.log("enableWebSearch:", session.enableWebSearch);
  console.log("plan strategy:", session.plan.strategy);
  console.log("question strategy:", session.nextQuestion.strategy);
  console.log("first question:", session.nextQuestion.text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
