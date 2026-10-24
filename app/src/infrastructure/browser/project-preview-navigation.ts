import type { BrowserTask } from "@/features/browser/browser-provider";

function previewRoutePrefixes(task: BrowserTask) {
  if (task.source.kind !== "project-preview") return null;
  const expected = new URL(task.source.snapshot.url);
  const loopback =
    expected.protocol === "http:" && expected.hostname === "127.0.0.1";
  return {
    expected,
    content: loopback ? `/${task.source.snapshot.id}/content/` : "/content/",
    runtime: loopback ? `/${task.source.snapshot.id}/runtime/` : "/runtime/",
  };
}

function samePreviewOrigin(expected: URL, candidate: URL) {
  return (
    !candidate.username &&
    !candidate.password &&
    expected.protocol === candidate.protocol &&
    expected.host === candidate.host
  );
}

export function isProjectPreviewDocumentUrl(task: BrowserTask, value: string) {
  try {
    const routes = previewRoutePrefixes(task);
    if (!routes) return false;
    const candidate = new URL(value);
    return (
      samePreviewOrigin(routes.expected, candidate) &&
      candidate.pathname.startsWith(routes.content) &&
      /\.html?$/iu.test(candidate.pathname)
    );
  } catch {
    return false;
  }
}

export function isProjectPreviewResourceUrl(task: BrowserTask, value: string) {
  try {
    const routes = previewRoutePrefixes(task);
    if (!routes) return false;
    const candidate = new URL(value);
    if (!samePreviewOrigin(routes.expected, candidate)) return false;
    if (candidate.pathname.startsWith(routes.content)) return true;
    return new RegExp(
      `^${routes.runtime.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[a-f0-9]{64}\\.js$`,
      "u",
    ).test(candidate.pathname);
  } catch {
    return false;
  }
}
