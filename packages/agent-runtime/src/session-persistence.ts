import {
  InMemorySessionStorage,
  type SessionMetadata,
  type SessionStorage,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";

import type { RuntimeSessionPersistencePort } from "./contracts.ts";

const SNAPSHOT_VERSION = 1;
const MAX_SESSION_BYTES = 16 * 1024 * 1024;
const MAX_SESSION_ENTRIES = 20_000;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const OMITTED_IMAGE_TEXT =
  "[Image attachment omitted from durable Agent session.]";
const OMIT_DURABLE_VALUE = Symbol("omit-durable-value");
const ENTRY_TYPES = new Set([
  "message",
  "thinking_level_change",
  "model_change",
  "active_tools_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
  "leaf",
]);
const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

type PersistedSessionTree = {
  version: 1;
  metadata: SessionMetadata;
  entries: SessionTreeEntry[];
};

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function openAIReasoningSignature(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    parsed.type !== "reasoning" ||
    typeof parsed.encrypted_content !== "string" ||
    !parsed.encrypted_content
  ) {
    return undefined;
  }
  return JSON.stringify({
    type: "reasoning",
    ...(validId(parsed.id) ? { id: parsed.id } : {}),
    encrypted_content: parsed.encrypted_content,
    summary: [],
    ...(typeof parsed.status === "string" ? { status: parsed.status } : {}),
  });
}

function textPhase(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) &&
      (parsed.phase === "commentary" || parsed.phase === "final_answer")
      ? parsed.phase
      : undefined;
  } catch {
    return undefined;
  }
}

function durableArray(value: unknown[], redactText?: (text: string) => string) {
  const result: unknown[] = [];
  for (const item of value) {
    const durable = withoutDurableSensitiveData(item, redactText);
    if (durable !== OMIT_DURABLE_VALUE) result.push(durable);
  }
  return result;
}

function durableAssistantContent(
  content: unknown[],
  redactText?: (text: string) => string,
) {
  const hasToolCall = content.some(
    (block) => isRecord(block) && block.type === "toolCall",
  );
  return durableArray(
    content.filter(
      (block) =>
        !(
          isRecord(block) &&
          block.type === "text" &&
          (hasToolCall || textPhase(block.textSignature) === "commentary")
        ),
    ),
    redactText,
  );
}

function withoutDurableSensitiveData(
  value: unknown,
  redactText?: (text: string) => string,
): unknown | typeof OMIT_DURABLE_VALUE {
  if (typeof value === "string") return redactText?.(value) ?? value;
  if (Array.isArray(value)) {
    return durableArray(value, redactText);
  }
  if (!isRecord(value)) return value;
  if (value.type === "image") {
    return { type: "text", text: OMITTED_IMAGE_TEXT };
  }
  if (value.type === "thinking") {
    const thinkingSignature = openAIReasoningSignature(value.thinkingSignature);
    return thinkingSignature
      ? {
          type: "thinking",
          thinking: "",
          thinkingSignature,
          ...(value.redacted === true ? { redacted: true } : {}),
        }
      : OMIT_DURABLE_VALUE;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const durable =
      key === "content" && value.role === "assistant" && Array.isArray(item)
        ? durableAssistantContent(item, redactText)
        : withoutDurableSensitiveData(item, redactText);
    if (durable !== OMIT_DURABLE_VALUE) result[key] = durable;
  }
  return result;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !value.includes("\0")
  );
}

function assertEntryShape(entry: unknown): asserts entry is SessionTreeEntry {
  if (!isRecord(entry) || !ENTRY_TYPES.has(String(entry.type))) {
    throw new Error("Saved agent session contains an unsupported entry.");
  }
  if (
    !validId(entry.id) ||
    (entry.parentId !== null && !validId(entry.parentId)) ||
    !validDate(entry.timestamp)
  ) {
    throw new Error("Saved agent session entry metadata is invalid.");
  }
  if (byteLength(JSON.stringify(entry)) > MAX_ENTRY_BYTES) {
    throw new Error("Saved agent session entry exceeds its size limit.");
  }
  switch (entry.type) {
    case "message":
      if (
        !isRecord(entry.message) ||
        !["user", "assistant", "toolResult"].includes(
          String(entry.message.role),
        )
      ) {
        throw new Error(
          "Saved agent session contains an invalid message entry.",
        );
      }
      break;
    case "thinking_level_change":
      if (!THINKING_LEVELS.has(String(entry.thinkingLevel))) {
        throw new Error("Saved agent session thinking level is invalid.");
      }
      break;
    case "model_change":
      if (
        typeof entry.provider !== "string" ||
        typeof entry.modelId !== "string"
      ) {
        throw new Error("Saved agent session model entry is invalid.");
      }
      break;
    case "active_tools_change":
      if (
        !Array.isArray(entry.activeToolNames) ||
        entry.activeToolNames.some((name) => typeof name !== "string")
      ) {
        throw new Error("Saved agent session tool profile is invalid.");
      }
      break;
    case "compaction":
      if (
        typeof entry.summary !== "string" ||
        typeof entry.tokensBefore !== "number"
      ) {
        throw new Error("Saved agent session compaction entry is invalid.");
      }
      break;
    case "branch_summary":
      if (typeof entry.summary !== "string" || !validId(entry.fromId)) {
        throw new Error("Saved agent session branch summary is invalid.");
      }
      break;
    case "custom":
    case "custom_message":
      if (typeof entry.customType !== "string") {
        throw new Error("Saved agent session custom entry is invalid.");
      }
      break;
    case "label":
      if (!validId(entry.targetId)) {
        throw new Error("Saved agent session label target is invalid.");
      }
      break;
    case "session_info":
      if (entry.name !== undefined && typeof entry.name !== "string") {
        throw new Error("Saved agent session name is invalid.");
      }
      break;
    case "leaf":
      if (entry.targetId !== null && !validId(entry.targetId)) {
        throw new Error("Saved agent session leaf target is invalid.");
      }
      break;
  }
}

function decodeSnapshot(
  value: string,
  expectedId: string,
): PersistedSessionTree {
  if (byteLength(value) > MAX_SESSION_BYTES) {
    throw new Error("Saved agent session exceeds its size limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Saved agent session is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== SNAPSHOT_VERSION ||
    !isRecord(parsed.metadata) ||
    parsed.metadata.id !== expectedId ||
    !validId(parsed.metadata.id) ||
    !validDate(parsed.metadata.createdAt) ||
    !Array.isArray(parsed.entries) ||
    parsed.entries.length > MAX_SESSION_ENTRIES
  ) {
    throw new Error("Saved agent session snapshot is invalid.");
  }
  const knownIds = new Set<string>();
  for (const entry of parsed.entries) {
    assertEntryShape(entry);
    if (knownIds.has(entry.id)) {
      throw new Error("Saved agent session contains duplicate entry IDs.");
    }
    if (entry.parentId !== null && !knownIds.has(entry.parentId)) {
      throw new Error("Saved agent session contains a broken parent link.");
    }
    if (
      entry.type === "leaf" &&
      entry.targetId !== null &&
      !knownIds.has(entry.targetId)
    ) {
      throw new Error("Saved agent session contains a broken leaf link.");
    }
    knownIds.add(entry.id);
  }
  return parsed as unknown as PersistedSessionTree;
}

function encodeSnapshot(
  metadata: SessionMetadata,
  entries: SessionTreeEntry[],
  redactText?: (text: string) => string,
) {
  if (entries.length > MAX_SESSION_ENTRIES) {
    throw new Error("Agent session exceeds its entry limit; compact it first.");
  }
  const durableEntries = entries.map((entry) => {
    const durable = withoutDurableSensitiveData(entry, redactText);
    if (durable === OMIT_DURABLE_VALUE) {
      throw new Error("Agent session entry cannot be omitted.");
    }
    return durable as SessionTreeEntry;
  });
  const value = JSON.stringify({
    version: SNAPSHOT_VERSION,
    metadata,
    entries: durableEntries,
  } satisfies PersistedSessionTree);
  if (byteLength(value) > MAX_SESSION_BYTES) {
    throw new Error("Agent session exceeds its encrypted storage limit.");
  }
  return { value, durableEntries };
}

/**
 * SQLCipher/document-store adapter around Pi's upstream in-memory SessionStorage.
 * Pi owns all tree semantics; this class only validates and durably serializes it.
 */
export class PersistedPiSessionStorage implements SessionStorage {
  #storage: InMemorySessionStorage;
  readonly #persistence: RuntimeSessionPersistencePort;
  readonly #redactText?: (text: string) => string;
  #mutationQueue: Promise<void> = Promise.resolve();
  #durableMetadata: SessionMetadata;
  #durableEntries: SessionTreeEntry[];
  #batching = false;
  #dirty = false;

  private constructor(
    storage: InMemorySessionStorage,
    persistence: RuntimeSessionPersistencePort,
    redactText?: (text: string) => string,
  ) {
    this.#storage = storage;
    this.#persistence = persistence;
    this.#redactText = redactText;
    this.#durableMetadata = { id: "", createdAt: "" };
    this.#durableEntries = [];
  }

  static async open(
    sessionId: string,
    persistence: RuntimeSessionPersistencePort,
    redactText?: (text: string) => string,
  ) {
    const value = await persistence.load(sessionId);
    const snapshot = value
      ? decodeSnapshot(value, sessionId)
      : ({
          version: SNAPSHOT_VERSION,
          metadata: { id: sessionId, createdAt: new Date().toISOString() },
          entries: [],
        } satisfies PersistedSessionTree);
    const storage = new PersistedPiSessionStorage(
      new InMemorySessionStorage({
        metadata: snapshot.metadata,
        entries: snapshot.entries,
      }),
      persistence,
      redactText,
    );
    storage.#durableMetadata = snapshot.metadata;
    storage.#durableEntries = [...snapshot.entries];
    return storage;
  }

  /**
   * Coalesce the message, tool-result, leaf and metadata mutations of an Agent
   * turn into save-point writes. Reads continue to see the in-memory tree, and
   * a failed encrypted write rolls the tree back to its last durable snapshot.
   */
  beginBatch() {
    return this.#enqueue(async () => {
      this.#batching = true;
    });
  }

  flush() {
    return this.#enqueue(() => this.#flushLocked(false));
  }

  finishBatch() {
    return this.#enqueue(async () => {
      try {
        await this.#flushLocked(true);
      } finally {
        this.#batching = false;
      }
    });
  }

  async getMetadata() {
    await this.#mutationQueue;
    return this.#storage.getMetadata();
  }

  async getLeafId() {
    await this.#mutationQueue;
    return this.#storage.getLeafId();
  }

  setLeafId(leafId: string | null) {
    return this.#mutate((candidate) => candidate.setLeafId(leafId));
  }

  async createEntryId() {
    await this.#mutationQueue;
    return this.#storage.createEntryId();
  }

  appendEntry(entry: SessionTreeEntry) {
    return this.#mutate((candidate) => candidate.appendEntry(entry));
  }

  async getEntry(id: string) {
    await this.#mutationQueue;
    return this.#storage.getEntry(id);
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(type: TType) {
    await this.#mutationQueue;
    return this.#storage.findEntries(type);
  }

  async getLabel(id: string) {
    await this.#mutationQueue;
    return this.#storage.getLabel(id);
  }

  async getSessionName() {
    await this.#mutationQueue;
    return this.#storage.getSessionName();
  }

  async getSessionStats() {
    await this.#mutationQueue;
    return this.#storage.getSessionStats();
  }

  async getPathToRootOrCompaction(leafId: string | null) {
    await this.#mutationQueue;
    return this.#storage.getPathToRootOrCompaction(leafId);
  }

  async getEntries(options?: { afterEntrySeq?: number; limit?: number }) {
    await this.#mutationQueue;
    return this.#storage.getEntries(options);
  }

  #mutate(operation: (candidate: InMemorySessionStorage) => Promise<void>) {
    return this.#enqueue(async () => {
      await operation(this.#storage);
      this.#dirty = true;
      if (!this.#batching) await this.#flushLocked(true);
    });
  }

  #enqueue(operation: () => Promise<void>) {
    const result = this.#mutationQueue.then(operation);
    this.#mutationQueue = result.catch(() => undefined);
    return result;
  }

  async #flushLocked(replaceTransientStorage: boolean) {
    if (!this.#dirty) {
      if (replaceTransientStorage) {
        this.#storage = new InMemorySessionStorage({
          metadata: this.#durableMetadata,
          entries: this.#durableEntries,
        });
      }
      return;
    }
    const metadata = await this.#storage.getMetadata();
    const entries = await this.#storage.getEntries();
    try {
      const snapshot = encodeSnapshot(metadata, entries, this.#redactText);
      await this.#persistence.save(metadata.id, snapshot.value);
      this.#durableMetadata = metadata;
      this.#durableEntries = [...snapshot.durableEntries];
      if (replaceTransientStorage) {
        this.#storage = new InMemorySessionStorage({
          metadata,
          entries: snapshot.durableEntries,
        });
      }
      this.#dirty = false;
    } catch (error) {
      this.#storage = new InMemorySessionStorage({
        metadata: this.#durableMetadata,
        entries: this.#durableEntries,
      });
      this.#dirty = false;
      throw error;
    }
  }
}
