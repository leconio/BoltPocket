import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";

import { normalizeBrowserUrl } from "./browser-url";

const BOOKMARKS_KEY = "browser:bookmarks:v1";
const MAX_BOOKMARKS = 200;

export type BrowserBookmark = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
};

function parseBookmark(value: unknown): BrowserBookmark {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("书签数据无效。");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim() ||
    candidate.id.length > 120 ||
    candidate.id.includes("\0") ||
    typeof candidate.title !== "string" ||
    candidate.title.length > 240 ||
    candidate.title.includes("\0") ||
    typeof candidate.url !== "string" ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt))
  ) {
    throw new Error("书签数据无效。");
  }
  return {
    id: candidate.id,
    title: candidate.title,
    url: normalizeBrowserUrl(candidate.url),
    createdAt: candidate.createdAt,
  };
}

function validateBookmarks(value: unknown): BrowserBookmark[] {
  if (!Array.isArray(value) || value.length > MAX_BOOKMARKS) {
    throw new Error("书签数据无效或超出限制。");
  }
  const bookmarks = value.map(parseBookmark);
  if (
    new Set(bookmarks.map((bookmark) => bookmark.id)).size !== bookmarks.length
  ) {
    throw new Error("书签编号重复。");
  }
  return bookmarks;
}

export class BrowserBookmarkRepository {
  readonly #store: DurableDocumentStore;

  constructor(store: DurableDocumentStore) {
    this.#store = store;
  }

  async load(): Promise<BrowserBookmark[]> {
    const stored = await this.#store.read(BOOKMARKS_KEY);
    if (stored === undefined) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error("本机书签无法读取。");
    }
    return validateBookmarks(parsed);
  }

  async save(bookmarks: readonly BrowserBookmark[]): Promise<void> {
    const validated = validateBookmarks(bookmarks);
    await this.#store.write(BOOKMARKS_KEY, JSON.stringify(validated));
    await this.#store.flush();
  }
}
