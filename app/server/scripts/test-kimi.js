import { config } from "../config.js";
import { loadEnvFile } from "../env.js";

async function main() {
  await loadEnvFile();

  if (!config.moonshotApiKey) {
    throw new Error("MOONSHOT_API_KEY is not configured.");
  }

  const response = await fetch(`${config.moonshotBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.moonshotApiKey}`
    },
    body: JSON.stringify({
      model: config.moonshotModel,
      stream: false,
      temperature: config.moonshotThinking === "enabled" ? 1.0 : 0.6,
      top_p: config.moonshotThinking === "enabled" ? 0.95 : undefined,
      thinking: {
        type: config.moonshotThinking
      },
      messages: [
        {
          role: "system",
          content: "你是一个严格的 JSON 输出器。你只输出 JSON。"
        },
        {
          role: "user",
          content: "{\"ping\":true,\"task\":\"请返回 {\\\"ok\\\":true,\\\"provider\\\":\\\"moonshot\\\"}，不要输出其他内容。\"}"
        }
      ]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Moonshot request failed with ${response.status}: ${text}`);
  }

  const json = JSON.parse(text);
  const message = json.choices?.[0]?.message;
  console.log("model:", json.model || config.moonshotModel);
  console.log("thinking:", config.moonshotThinking);
  console.log("has_reasoning:", Boolean(message?.reasoning_content));
  console.log("content:", message?.content || "");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
