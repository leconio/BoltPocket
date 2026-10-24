const MAX_MARKDOWN_URL_LENGTH = 4096;

export function normalizeMarkdownUrl(value: string): string | null {
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_MARKDOWN_URL_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(candidate)
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Single-line surfaces cannot host a Markdown tree. Keep their previews legible
 * without interpreting links, images, or formatting as interactive content.
 */
export function markdownPreviewText(value: string): string {
  return value
    .replace(/^[ \t]{0,3}(?:```|~~~)[^\n]*$/gmu, " ")
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^\n)]*\)/gu, "$1")
    .replace(/!\[([^\]]*)\]\s*\[[^\]]*\]/gu, "$1")
    .replace(/\[([^\]]+)\]\s*\[[^\]]*\]/gu, "$1")
    .replace(/<((?:https?|mailto):[^>]+)>/giu, "$1")
    .replace(/^[ \t]{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])[ \t]+/gmu, "")
    .replace(
      /^[ \t]*\|?[ \t]*[:|-]+(?:[ \t]*\|[ \t]*[:|-]+)+\|?[ \t]*$/gmu,
      " ",
    )
    .replace(/(`+)([^`]*?)\1/gu, "$2")
    .replace(/(\*\*|__|~~)(.*?)\1/gu, "$2")
    .replace(/(^|[\s([{>])([*_])([^\n]+?)\2(?=$|[\s.,!?;:)}\]])/gu, "$1$3")
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}
