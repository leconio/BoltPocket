import { ConnectorError } from "@boltpocket/connector-core";

export const MAX_GOOGLE_SLIDES_CHARACTERS = 300_000;
export const MAX_GOOGLE_SLIDES = 200;
export const MAX_GOOGLE_SLIDE_TEXTS = 200;

export type GoogleSlidesTextDeck = {
  slides: {
    texts: string[];
    tables?: string[][][];
  }[];
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_GOOGLE_SLIDES_CHARACTERS &&
    !value.includes("\0")
  );
}

function parseTables(value: unknown): string[][][] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every(
      (table) =>
        Array.isArray(table) &&
        table.every(
          (row) => Array.isArray(row) && row.every((cell) => boundedText(cell)),
        ),
    )
  ) {
    throw new ConnectorError("unsupported", "Google 幻灯片表格文本格式无效。");
  }
  return value as string[][][];
}

export function parseGoogleSlidesText(value: string): GoogleSlidesTextDeck {
  if (value.length > MAX_GOOGLE_SLIDES_CHARACTERS || value.includes("\0")) {
    throw new ConnectorError("unsupported", "Google 幻灯片内容超过安全限制。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ConnectorError(
      "unsupported",
      "Google 幻灯片内容必须是有效的幻灯片 JSON。",
    );
  }
  if (
    !record(parsed) ||
    Object.keys(parsed).some((key) => key !== "slides") ||
    !Array.isArray(parsed.slides) ||
    parsed.slides.length === 0 ||
    parsed.slides.length > MAX_GOOGLE_SLIDES
  ) {
    throw new ConnectorError("unsupported", "Google 幻灯片结构无效。");
  }
  const slides = parsed.slides.map((slide) => {
    if (
      !record(slide) ||
      Object.keys(slide).some((key) => key !== "texts" && key !== "tables") ||
      !Array.isArray(slide.texts) ||
      slide.texts.length > MAX_GOOGLE_SLIDE_TEXTS ||
      !slide.texts.every(boundedText)
    ) {
      throw new ConnectorError("unsupported", "Google 幻灯片结构无效。");
    }
    const tables = parseTables(slide.tables);
    return {
      texts: slide.texts as string[],
      ...(tables === undefined ? {} : { tables }),
    };
  });
  return { slides };
}

export function stringifyGoogleSlidesText(deck: GoogleSlidesTextDeck) {
  const value = JSON.stringify(deck, null, 2);
  if (value.length > MAX_GOOGLE_SLIDES_CHARACTERS) {
    throw new ConnectorError("unsupported", "Google 幻灯片内容超过安全限制。");
  }
  return value;
}

export function canonicalizeGoogleSlidesText(value: string) {
  try {
    return stringifyGoogleSlidesText(parseGoogleSlidesText(value));
  } catch (error) {
    if (value.trimStart().startsWith("{")) throw error;
  }
  const slides = value
    .split(/^\s*---+\s*$/gmu)
    .map((content) => content.trim())
    .filter(Boolean)
    .map((content) => ({ texts: [content] }));
  if (slides.length === 0) slides.push({ texts: [""] });
  return stringifyGoogleSlidesText({ slides });
}
