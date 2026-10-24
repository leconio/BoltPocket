import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";

const VERSION = 1;
const PUBLISHER_ID = /^publisher-[a-z0-9-]{8,80}$/u;

export class SkillMarketPublisherBlocklist {
  readonly #listeners = new Set<() => void>();

  constructor(
    private readonly store: DurableDocumentStore,
    private readonly key = "skill-market:publisher-blocklist:v1",
  ) {}

  async list(): Promise<readonly string[]> {
    const stored = await this.store.read(this.key);
    if (stored === undefined) return [];
    let value: unknown;
    try {
      value = JSON.parse(stored) as unknown;
    } catch {
      throw new Error("Blocked publisher settings are unreadable.");
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).version !== VERSION ||
      !Array.isArray((value as Record<string, unknown>).publisherIds) ||
      ((value as Record<string, unknown>).publisherIds as unknown[]).some(
        (id) => typeof id !== "string" || !PUBLISHER_ID.test(id),
      )
    ) {
      throw new Error("Blocked publisher settings are invalid.");
    }
    return Object.freeze(
      [...new Set((value as { publisherIds: string[] }).publisherIds)].sort(),
    );
  }

  async isBlocked(publisherId: string) {
    assertPublisherId(publisherId);
    return (await this.list()).includes(publisherId);
  }

  async setBlocked(publisherId: string, blocked: boolean) {
    assertPublisherId(publisherId);
    const next = new Set(await this.list());
    if (blocked) next.add(publisherId);
    else next.delete(publisherId);
    await this.store.write(
      this.key,
      JSON.stringify({ publisherIds: [...next].sort(), version: VERSION }),
    );
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

function assertPublisherId(value: string) {
  if (!PUBLISHER_ID.test(value)) {
    throw new Error("Skill market publisher identifier is invalid.");
  }
}
