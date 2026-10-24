class HeadlessComponent {
  protected text = "";

  constructor(text = "") {
    this.text = text;
  }

  addChild(): void {}
  clear(): void {}
  invalidate(): void {}
  setText(text: string): void {
    this.text = text;
  }
}

export class Text extends HeadlessComponent {}
export class Container extends HeadlessComponent {}
export class Box extends Container {}
export class Spacer extends HeadlessComponent {}

export function truncateToWidth(value: string): string {
  return value;
}

export function getCapabilities() {
  return { hyperlinks: false, images: false };
}

export function getImageDimensions(): undefined {
  return undefined;
}

export function hyperlink(value: string): string {
  return value;
}

export function imageFallback(mimeType: string): string {
  return `[image ${mimeType}]`;
}

export const theme = {
  bold: (value: string) => value,
  fg: (_color: string, value: string) => value,
};

export function keyHint(): string {
  return "";
}

export function keyText(): string {
  return "";
}

export function getLanguageFromPath(): undefined {
  return undefined;
}

export function highlightCode(value: string): string[] {
  return value.split("\n");
}

export function truncateToVisualLines(value: string) {
  return { lines: value.split("\n"), skipped: 0 };
}

export function renderDiff(value: string): string {
  return value;
}

export function str(value: unknown): string | null {
  if (typeof value === "string") return value;
  return value == null ? "" : null;
}

export function replaceTabs(value: string): string {
  return value.replace(/\t/gu, "   ");
}

export function normalizeDisplayText(value: string): string {
  return value.replace(/\r/gu, "");
}

export function shortenPath(value: string): string {
  return value;
}

export function invalidArgText(): string {
  return "[invalid arg]";
}

export function renderToolPath(value: string | null): string {
  return value ?? "[invalid arg]";
}

export function getTextOutput(
  result: { content?: { type: string; text?: string }[] } | undefined,
): string {
  return (
    result?.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

export function sanitizeBinaryOutput(value: string): string {
  return value;
}

export function getReadmePath(): string {
  return "/project/README.md";
}

export function getBinDir(): string {
  return "/project/.pi/bin";
}

export const APP_NAME = "BoltPocket";

export function getShellEnv(): Record<string, string> {
  return {};
}

export function getShellConfig(): never {
  throw new Error("Host shell is unavailable on mobile.");
}

export function killProcessTree(): void {}
export function trackDetachedChildPid(): void {}
export function untrackDetachedChildPid(): void {}

export function spawnProcess(): never {
  throw new Error("Host processes are unavailable on mobile.");
}

export function spawnProcessSync(): never {
  throw new Error("Host processes are unavailable on mobile.");
}

export function waitForChildProcess(): never {
  throw new Error("Host processes are unavailable on mobile.");
}

export async function ensureTool(): Promise<never> {
  throw new Error("Host tool discovery is unavailable on mobile.");
}

export async function detectSupportedImageMimeTypeFromFile(): Promise<null> {
  return null;
}

export async function processImage() {
  return {
    ok: false as const,
    message: "Image processing is not enabled for project text resources.",
  };
}
