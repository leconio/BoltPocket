import type {
  BrowserControlKind,
  BrowserPageFindResult,
  BrowserPageControl,
  BrowserPageControlAction,
  BrowserPageInteractionReceipt,
  BrowserPageSnapshot,
  BrowserPageTextChunk,
} from "@/application/ports/browser-control";

const CONTROL_KINDS = new Set<BrowserControlKind>([
  "link",
  "button",
  "input",
  "select",
  "control",
]);
const CONTROL_ID = /^control-[1-9]\d{0,2}$/u;
const CONTROL_ACTIONS = new Set<BrowserPageControlAction>(["click", "type"]);
export const MAX_BROWSER_PAGE_TEXT_LENGTH = 16_000;
export const MAX_BROWSER_SEARCHABLE_TEXT_LENGTH = 256_000;
export const MAX_BROWSER_TEXT_MATCHES = 20;
export const MAX_BROWSER_TEXT_QUERY_LENGTH = 200;
export const MAX_BROWSER_TEXT_SNIPPET_LENGTH = 320;
export const MAX_BROWSER_INPUT_TEXT_LENGTH = 4_000;
const MAX_CONTROLS = 80;

function requiredString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new Error(`网页返回了无效的${label}。`);
  }
  return value;
}

function optionalBoolean(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`网页返回了无效的${label}。`);
  }
  return value;
}

function parseControl(value: unknown): BrowserPageControl {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("网页返回了无效的控件信息。");
  }
  const candidate = value as Record<string, unknown>;
  const id = requiredString(candidate.id, "控件编号", 24);
  if (!CONTROL_ID.test(id)) throw new Error("网页控件编号无效。");
  const kind = requiredString(candidate.kind, "控件类型", 16);
  if (!CONTROL_KINDS.has(kind as BrowserControlKind)) {
    throw new Error("网页控件类型无效。");
  }
  const label = requiredString(candidate.label, "控件名称", 240);
  if (!Array.isArray(candidate.actions) || candidate.actions.length > 2) {
    throw new Error("网页返回了无效的控件操作。");
  }
  const actions = candidate.actions.map((action) => {
    if (
      typeof action !== "string" ||
      !CONTROL_ACTIONS.has(action as BrowserPageControlAction)
    ) {
      throw new Error("网页返回了无效的控件操作。");
    }
    return action as BrowserPageControlAction;
  });
  if (new Set(actions).size !== actions.length) {
    throw new Error("网页控件操作重复。");
  }
  const href =
    candidate.href === undefined
      ? undefined
      : requiredString(candidate.href, "链接", 2_048);
  const sensitive = optionalBoolean(candidate.sensitive, "敏感标记");
  const disabled = optionalBoolean(candidate.disabled, "禁用标记");
  if (
    (disabled && actions.length > 0) ||
    (sensitive && actions.length > 0) ||
    (actions.includes("type") && kind !== "input") ||
    (kind === "link" && actions.includes("click") && !href)
  ) {
    throw new Error("网页返回了不安全的控件操作。");
  }
  return {
    id,
    kind: kind as BrowserControlKind,
    label,
    actions,
    ...(href ? { href } : {}),
    ...(sensitive !== undefined ? { sensitive } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
  };
}

export function parseBrowserPageSnapshot(value: unknown): BrowserPageSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("网页返回了无效的页面快照。");
  }
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.controls) ||
    candidate.controls.length > MAX_CONTROLS
  ) {
    throw new Error("网页控件数量超出限制。");
  }
  const text = typeof candidate.text === "string" ? candidate.text : "";
  if (text.length > MAX_BROWSER_PAGE_TEXT_LENGTH || text.includes("\0")) {
    throw new Error("网页可见文字超出限制。");
  }
  const controls = candidate.controls.map(parseControl);
  if (new Set(controls.map((control) => control.id)).size !== controls.length) {
    throw new Error("网页控件编号重复。");
  }
  return {
    revision: requiredString(candidate.revision, "页面版本", 240),
    url: requiredString(candidate.url, "网址", 2_048),
    title:
      typeof candidate.title === "string" && candidate.title.length <= 240
        ? candidate.title
        : "",
    text,
    controls,
  };
}

function requiredInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new Error(`网页返回了无效的${label}。`);
  }
  return value as number;
}

function pageTextMetadata(value: Record<string, unknown>) {
  const revision = requiredString(value.revision, "页面版本", 240);
  const url = requiredString(value.url, "网址", 2_048);
  const title =
    typeof value.title === "string" && value.title.length <= 240
      ? value.title
      : "";
  const searchedLength = requiredInteger(
    value.searchedLength,
    "网页文字长度",
    0,
    MAX_BROWSER_SEARCHABLE_TEXT_LENGTH,
  );
  if (typeof value.truncated !== "boolean") {
    throw new Error("网页返回了无效的截断标记。");
  }
  return {
    revision,
    url,
    title,
    searchedLength,
    truncated: value.truncated,
  };
}

export function parseBrowserPageTextChunk(
  value: unknown,
): BrowserPageTextChunk {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("网页返回了无效的文字分段。");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.searchedLength !== undefined &&
    candidate.totalLength !== undefined &&
    candidate.searchedLength !== candidate.totalLength
  ) {
    throw new Error("网页返回了不一致的网页文字长度。");
  }
  const metadata = pageTextMetadata({
    ...candidate,
    searchedLength: candidate.searchedLength ?? candidate.totalLength,
  });
  const offset = requiredInteger(
    candidate.offset,
    "文字偏移",
    0,
    MAX_BROWSER_SEARCHABLE_TEXT_LENGTH,
  );
  const text = typeof candidate.text === "string" ? candidate.text : "";
  if (
    text.length > MAX_BROWSER_PAGE_TEXT_LENGTH ||
    text.includes("\0") ||
    offset + text.length > metadata.searchedLength
  ) {
    throw new Error("网页返回了无效的文字分段。");
  }
  const nextOffset =
    candidate.nextOffset === null
      ? null
      : requiredInteger(
          candidate.nextOffset,
          "下一段偏移",
          1,
          MAX_BROWSER_SEARCHABLE_TEXT_LENGTH,
        );
  const expectedNextOffset =
    offset + text.length < metadata.searchedLength
      ? offset + text.length
      : null;
  if (nextOffset !== expectedNextOffset) {
    throw new Error("网页返回了无效的下一段偏移。");
  }
  return {
    revision: metadata.revision,
    url: metadata.url,
    title: metadata.title,
    offset,
    text,
    totalLength: metadata.searchedLength,
    nextOffset,
    truncated: metadata.truncated,
  };
}

export function parseBrowserPageFindResult(
  value: unknown,
): BrowserPageFindResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("网页返回了无效的文字查找结果。");
  }
  const candidate = value as Record<string, unknown>;
  const metadata = pageTextMetadata(candidate);
  if (
    !Array.isArray(candidate.matches) ||
    candidate.matches.length > MAX_BROWSER_TEXT_MATCHES
  ) {
    throw new Error("网页文字匹配数量超出限制。");
  }
  const matches = candidate.matches.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("网页返回了无效的文字匹配。");
    }
    const match = value as Record<string, unknown>;
    const offset = requiredInteger(
      match.offset,
      "匹配位置",
      0,
      Math.max(0, metadata.searchedLength - 1),
    );
    const snippet = requiredString(
      match.snippet,
      "匹配片段",
      MAX_BROWSER_TEXT_SNIPPET_LENGTH,
    );
    return { offset, snippet };
  });
  if (metadata.searchedLength === 0 && matches.length > 0) {
    throw new Error("网页返回了无效的文字匹配。");
  }
  const totalMatches = requiredInteger(
    candidate.totalMatches,
    "匹配总数",
    matches.length,
    MAX_BROWSER_SEARCHABLE_TEXT_LENGTH,
  );
  return {
    revision: metadata.revision,
    url: metadata.url,
    title: metadata.title,
    matches,
    totalMatches,
    searchedLength: metadata.searchedLength,
    truncated: metadata.truncated,
  };
}

export function parseBrowserPageInteractionReceipt(
  value: unknown,
): BrowserPageInteractionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("网页返回了无效的交互回执。");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.action !== "string" ||
    !CONTROL_ACTIONS.has(candidate.action as BrowserPageControlAction)
  ) {
    throw new Error("网页返回了无效的交互操作。");
  }
  const action = candidate.action as BrowserPageControlAction;
  const targetId = requiredString(candidate.targetId, "控件编号", 24);
  if (!CONTROL_ID.test(targetId)) throw new Error("网页控件编号无效。");
  const inputLength =
    candidate.inputLength === undefined
      ? undefined
      : requiredInteger(
          candidate.inputLength,
          "输入文字长度",
          0,
          MAX_BROWSER_INPUT_TEXT_LENGTH,
        );
  if (
    (action === "type" && inputLength === undefined) ||
    (action === "click" && inputLength !== undefined)
  ) {
    throw new Error("网页返回了不一致的交互回执。");
  }
  return {
    action,
    revision: requiredString(candidate.revision, "页面版本", 240),
    url: requiredString(candidate.url, "网址", 2_048),
    targetId,
    ...(inputLength !== undefined ? { inputLength } : {}),
  };
}

export function sanitizeBrowserPageSnapshot(
  snapshot: BrowserPageSnapshot,
  sanitizeUrl: (url: string | null) => string | null,
): BrowserPageSnapshot {
  return {
    ...snapshot,
    url: sanitizeUrl(snapshot.url) ?? "",
    controls: snapshot.controls.map((control) => ({
      ...control,
      ...(control.href
        ? { href: sanitizeUrl(control.href) ?? "不可用链接" }
        : {}),
    })),
  };
}

export function sanitizeBrowserPageTextChunk(
  chunk: BrowserPageTextChunk,
  sanitizeUrl: (url: string | null) => string | null,
): BrowserPageTextChunk {
  return { ...chunk, url: sanitizeUrl(chunk.url) ?? "" };
}

export function sanitizeBrowserPageFindResult(
  result: BrowserPageFindResult,
  sanitizeUrl: (url: string | null) => string | null,
): BrowserPageFindResult {
  return { ...result, url: sanitizeUrl(result.url) ?? "" };
}
