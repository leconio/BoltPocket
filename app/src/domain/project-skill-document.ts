export const PROJECT_SKILL_MAX_CHARACTERS = 64_000;

export type ProjectSkillDocument = Readonly<{
  body: string;
  description?: string;
  name?: string;
  risk?: "read" | "propose";
  title?: string;
}>;

export function projectSkillPath(path: string) {
  const segments = path.split("/");
  let precedence = 0;
  let relative: string[];
  if (segments[0] === "skills") {
    precedence = 2;
    relative = segments.slice(1);
  } else if (segments[0] === ".agents" && segments[1] === "skills") {
    precedence = 1;
    relative = segments.slice(2);
  } else {
    return null;
  }
  if (
    (relative.length !== 2 && relative.length !== 3) ||
    relative.at(-1) !== "SKILL.md"
  ) {
    return null;
  }
  const slug = relative.at(-2)!;
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(slug)) return null;
  return { slug, precedence };
}

function parseScalar(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : "";
    } catch {
      return "";
    }
  }
  return trimmed;
}

export function parseProjectSkillDocument(
  content: string,
): ProjectSkillDocument | null {
  const normalized = content.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) {
    const body = normalized.trim();
    return body ? { body } : null;
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const values: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = /^(name|title|description|risk):\s*(.*)$/u.exec(line);
    if (!match?.[1]) continue;
    values[match[1]] = parseScalar(match[2] ?? "");
  }
  const body = normalized.slice(end + 5).trim();
  if (!body) return null;
  const risk = values.risk;
  return {
    body,
    ...(values.name ? { name: values.name } : {}),
    ...(values.title ? { title: values.title } : {}),
    ...(values.description ? { description: values.description } : {}),
    ...(risk === "read" || risk === "propose" ? { risk } : {}),
  };
}

export type ProjectSkillValidation =
  | Readonly<{ valid: true; document: ProjectSkillDocument; slug: string }>
  | Readonly<{ valid: false; reason: string }>;

export function validateProjectSkillDocument(
  path: string,
  content: string,
): ProjectSkillValidation {
  const parsedPath = projectSkillPath(path);
  if (!parsedPath) return { valid: false, reason: "Skill 路径无效。" };
  if (
    content.includes("\0") ||
    content.length === 0 ||
    content.length > PROJECT_SKILL_MAX_CHARACTERS
  ) {
    return { valid: false, reason: "Skill 文档大小或文本格式无效。" };
  }
  if (!content.replace(/\r\n?/gu, "\n").startsWith("---\n")) {
    return { valid: false, reason: "Skill 文档需要 YAML frontmatter。" };
  }
  const normalized = content.replace(/\r\n?/gu, "\n");
  const frontmatterEnd = normalized.indexOf("\n---\n", 4);
  if (frontmatterEnd === -1) {
    return { valid: false, reason: "Skill frontmatter 没有闭合。" };
  }
  const allowed = new Set(["name", "title", "description", "risk"]);
  const seen = new Set<string>();
  for (const line of normalized.slice(4, frontmatterEnd).split("\n")) {
    const match = /^([a-z]+):\s*(.*)$/u.exec(line);
    const key = match?.[1];
    if (!key || !allowed.has(key) || seen.has(key)) {
      return { valid: false, reason: "Skill frontmatter 包含未知或重复字段。" };
    }
    seen.add(key);
  }
  if ([...allowed].some((key) => !seen.has(key))) {
    return { valid: false, reason: "Skill frontmatter 缺少必填字段。" };
  }
  const document = parseProjectSkillDocument(content);
  if (!document || document.name !== parsedPath.slug) {
    return {
      valid: false,
      reason: "Skill frontmatter 的 name 必须与目录名一致。",
    };
  }
  if (
    !document.title ||
    document.title.length > 120 ||
    !document.description ||
    document.description.length > 240 ||
    !document.risk
  ) {
    return { valid: false, reason: "Skill 元数据不完整或超过长度限制。" };
  }
  return { valid: true, document, slug: parsedPath.slug };
}
