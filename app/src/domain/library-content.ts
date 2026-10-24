import type { MemoryItem, SkillItem } from "./models.ts";

export const MAX_GLOBAL_MEMORY_CHARACTERS = 20_000;
export const MAX_GLOBAL_SKILL_CHARACTERS = 100_000;

export type EditableLibraryContentKind = "memory" | "skill";

export function validateEditableLibraryContent(
  kind: EditableLibraryContentKind,
  content: string,
) {
  const label = kind === "memory" ? "记忆" : "Skill";
  const maximum =
    kind === "memory"
      ? MAX_GLOBAL_MEMORY_CHARACTERS
      : MAX_GLOBAL_SKILL_CHARACTERS;
  if (!content.trim()) {
    throw new Error(`${label}内容不能为空。`);
  }
  if (content.includes("\0")) {
    throw new Error(`${label}只能保存纯文本内容。`);
  }
  if (content.length > maximum) {
    throw new Error(
      `${label}不能超过 ${maximum.toLocaleString("en-US")} 个字符。`,
    );
  }
  return content;
}

export function isValidEditableLibraryContent(
  kind: EditableLibraryContentKind,
  content: string,
) {
  try {
    validateEditableLibraryContent(kind, content);
    return true;
  } catch {
    return false;
  }
}

const SAFE_LIBRARY_ID = /^[a-zA-Z0-9._-]{1,240}$/u;

export function isValidCustomGlobalMemory(item: MemoryItem) {
  return (
    SAFE_LIBRARY_ID.test(item.id) &&
    item.scope === "global" &&
    (!item.projectIds || item.projectIds.length === 0) &&
    Boolean(item.source.trim()) &&
    item.source.length <= 240 &&
    isValidEditableLibraryContent("memory", item.text)
  );
}

export function isValidCustomGlobalSkill(item: SkillItem) {
  return (
    SAFE_LIBRARY_ID.test(item.id) &&
    item.scope === "global" &&
    item.projectIds.length === 0 &&
    Boolean(item.name.trim()) &&
    item.name.length <= 120 &&
    item.description.length <= 240 &&
    (item.risk === "read" || item.risk === "propose") &&
    isValidEditableLibraryContent("skill", item.content)
  );
}
