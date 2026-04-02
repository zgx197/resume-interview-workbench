import { config } from "../config.js";
import { loadEnvFile } from "../env.js";

function buildToolMessage(toolCall) {
  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: toolCall.function?.arguments || ""
  };
}

async function callMoonshot(messages, { enableTools, forceThinkingDisabled }) {
  const toolMode = Boolean(enableTools || forceThinkingDisabled);
  const response = await fetch(`${config.moonshotBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.moonshotApiKey}`
    },
    body: JSON.stringify({
      model: config.moonshotModel,
      messages,
      stream: false,
      temperature: toolMode ? 0.6 : 1.0,
      top_p: toolMode ? undefined : 0.95,
      thinking: {
        type: toolMode ? "disabled" : config.moonshotThinking
      },
      tools: enableTools
        ? [
            {
              type: "builtin_function",
              function: {
                name: "$web_search"
              }
            }
          ]
        : undefined
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Moonshot request failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  await loadEnvFile();

  if (!config.moonshotApiKey) {
    throw new Error("MOONSHOT_API_KEY is not configured.");
  }

  let messages = [
    {
      role: "system",
      content: "你是一个严格的 JSON 输出器。你只输出 JSON。"
    },
    {
      role: "user",
      content: [
        "{\"task\":\"请联网查询 2026 年 4 月 Unity 最新稳定版本信息，并返回 JSON：",
        "{\\\"searched\\\":true,\\\"latestVersion\\\":\\\"...\\\",\\\"whyItMatters\\\":\\\"...\\\"}",
        "不要输出其他内容。\"}"
      ].join("")
    }
  ];

  let response = await callMoonshot(messages, {
    enableTools: true,
    forceThinkingDisabled: true
  });
  let message = response.choices?.[0]?.message;

  console.log("first_has_tool_calls:", Boolean(message?.tool_calls?.length));
  console.log("first_content_preview:", (message?.content || "").slice(0, 120));

  if (message?.tool_calls?.length) {
    messages = [
      ...messages,
      {
        role: "assistant",
        content: message.content || "",
        tool_calls: message.tool_calls
      },
      ...message.tool_calls.map(buildToolMessage)
    ];
    response = await callMoonshot(messages, {
      enableTools: false,
      forceThinkingDisabled: true
    });
    message = response.choices?.[0]?.message;
  }

  console.log("final_has_reasoning:", Boolean(message?.reasoning_content));
  console.log("final_content:", message?.content || "");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
