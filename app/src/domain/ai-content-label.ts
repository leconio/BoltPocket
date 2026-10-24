/** Keeps the disclosure attached when assistant text leaves the chat UI. */
export function labeledAiGeneratedText(content: string, label: string) {
  return `${content}\n\n【${label}】`;
}
