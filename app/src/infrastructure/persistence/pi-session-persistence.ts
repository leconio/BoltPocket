import type { RuntimeSessionPersistencePort } from "@boltpocket/agent-runtime";

import type { DurableDocumentStore } from "./document-store";

const SESSION_TREE_PREFIX = "pi-session-tree:v1:";
const MAX_SESSION_TREE_BYTES = 16 * 1024 * 1024;

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

/** Stores Pi's upstream Session tree as an opaque encrypted document. */
export class DurablePiSessionPersistence implements RuntimeSessionPersistencePort {
  constructor(readonly store: DurableDocumentStore) {}

  async load(sessionId: string) {
    return this.store.read(this.#key(sessionId));
  }

  async save(sessionId: string, value: string) {
    if (byteLength(value) > MAX_SESSION_TREE_BYTES) {
      throw new Error("会话上下文超过本机加密存储上限。");
    }
    await this.store.write(this.#key(sessionId), value);
  }

  async delete(sessionId: string) {
    await this.store.remove(this.#key(sessionId));
  }

  #key(sessionId: string) {
    const normalized = sessionId.trim();
    if (!normalized || normalized.length > 240 || normalized.includes("\0")) {
      throw new Error("会话标识无效。");
    }
    return `${SESSION_TREE_PREFIX}${normalized}`;
  }
}
