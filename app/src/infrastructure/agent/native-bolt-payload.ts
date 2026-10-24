import type { Context } from "@earendil-works/pi-ai";

export function nativePayload(context: Context) {
  const messages: Record<string, unknown>[] = [];
  if (context.systemPrompt)
    messages.push({ role: "system", content: context.systemPrompt });
  for (const message of context.messages) {
    const blocks =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;
    if (blocks.some((block) => block.type === "image"))
      throw new Error(
        "This local text model does not have a vision projector loaded.",
      );
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => ("text" in block ? block.text : ""))
      .join("\n");
    if (message.role === "toolResult") {
      messages.push({
        role: "tool",
        content: text,
        tool_call_id: message.toolCallId,
        name: message.toolName,
      });
    } else if (message.role === "assistant") {
      const calls = message.content
        .filter((block) => block.type === "toolCall")
        .map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        }));
      messages.push({
        role: "assistant",
        content: text,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
    } else messages.push({ role: "user", content: text });
  }
  const tools = (context.tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
  return { messages, tools };
}
