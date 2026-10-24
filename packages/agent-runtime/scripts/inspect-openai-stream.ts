const apiKey = process.env.BOLTPOCKET_TEST_API_KEY;
const baseUrl = process.env.BOLTPOCKET_TEST_BASE_URL;
const model = process.env.BOLTPOCKET_TEST_MODEL;

if (!apiKey || !baseUrl || !model) {
  throw new Error(
    "BOLTPOCKET_TEST_API_KEY, BOLTPOCKET_TEST_BASE_URL and BOLTPOCKET_TEST_MODEL are required.",
  );
}

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Reply with the single word OK." }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 32,
  }),
});

const summary: {
  status: number;
  contentType: string | null;
  chunks: Array<Record<string, unknown>>;
  done: boolean;
} = {
  status: response.status,
  contentType: response.headers.get("content-type"),
  chunks: [],
  done: false,
};

if (!response.body) {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(response.ok ? 0 : 1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

function inspectLine(line: string) {
  if (!line.startsWith("data:")) return;
  const data = line.slice(5).trim();
  if (data === "[DONE]") {
    summary.done = true;
    return;
  }
  try {
    const chunk = JSON.parse(data) as Record<string, unknown>;
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const delta = first?.delta as Record<string, unknown> | undefined;
    summary.chunks.push({
      keys: Object.keys(chunk),
      choiceCount: choices.length,
      finishReason: first?.finish_reason ?? null,
      deltaKeys: delta ? Object.keys(delta) : [],
      hasContent:
        typeof delta?.content === "string" && delta.content.length > 0,
      hasToolCalls: Array.isArray(delta?.tool_calls),
    });
  } catch {
    summary.chunks.push({ invalidJson: true, byteLength: data.length });
  }
}

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) inspectLine(line);
}
buffer += decoder.decode();
for (const line of buffer.split(/\r?\n/)) inspectLine(line);

process.stdout.write(`${JSON.stringify(summary)}\n`);
process.exit(response.ok ? 0 : 1);
