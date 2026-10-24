import type {
  McpToolApprovalDecision,
  McpToolApprovalPort,
  McpToolApprovalRequest,
} from "@boltpocket/mcp-client";

import type { PendingMcpToolApproval } from "@/application/ports/mcp-tool-approval";

type QueueEntry = {
  pending: PendingMcpToolApproval;
  resolve: (decision: McpToolApprovalDecision) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type McpToolApprovalBrokerOptions = Readonly<{
  createRequestId: () => string;
  hashPatch?: (patch: string) => Promise<string>;
  now?: () => Date;
}>;

const MAX_PENDING_APPROVALS = 64;
const MAX_SESSION_GRANTS = 512;

export class McpToolApprovalBroker implements McpToolApprovalPort {
  readonly #createRequestId: () => string;
  readonly #hashPatch: (patch: string) => Promise<string>;
  readonly #listeners = new Set<
    (request: PendingMcpToolApproval | null) => void
  >();
  readonly #now: () => Date;
  readonly #queue: QueueEntry[] = [];
  readonly #sessionGrants = new Set<string>();

  constructor(options: McpToolApprovalBrokerOptions) {
    this.#createRequestId = options.createRequestId;
    this.#hashPatch = options.hashPatch ?? sha256Hex;
    this.#now = options.now ?? (() => new Date());
  }

  async authorize(
    request: McpToolApprovalRequest,
    signal?: AbortSignal,
  ): Promise<McpToolApprovalDecision> {
    if (signal?.aborted) return { approved: false };
    const sessionKey = approvalSessionKey(request);
    if (sessionKey && this.#sessionGrants.has(sessionKey)) {
      return { approved: true, scope: "session" };
    }
    const argumentsPreview = canonicalJson(request.arguments);
    const patch = invocationPatch(request, argumentsPreview);
    const patchHash = await this.#hashPatch(patch);
    if (!/^[a-f0-9]{64}$/u.test(patchHash)) {
      throw new Error("MCP 审批补丁哈希无效。");
    }
    if (signal?.aborted) return { approved: false };
    const pending: PendingMcpToolApproval = {
      argumentsPreview,
      patch,
      patchHash,
      request,
      requestId: this.#createRequestId(),
      requestedAt: this.#now().toISOString(),
      risk: request.risk,
    };
    if (this.#queue.length >= MAX_PENDING_APPROVALS) {
      throw new Error("待处理的 MCP 工具审批过多。");
    }
    return new Promise<McpToolApprovalDecision>((resolve) => {
      const entry: QueueEntry = { pending, resolve, signal };
      if (signal) {
        entry.onAbort = () => this.deny(pending.requestId);
        signal.addEventListener("abort", entry.onAbort, { once: true });
        if (signal.aborted) {
          signal.removeEventListener("abort", entry.onAbort);
          resolve({ approved: false });
          return;
        }
      }
      this.#queue.push(entry);
      if (this.#queue.length === 1) this.#emit();
    });
  }

  subscribe(listener: (request: PendingMcpToolApproval | null) => void) {
    this.#listeners.add(listener);
    listener(this.pending());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  pending() {
    return this.#queue[0]?.pending ?? null;
  }

  approve(requestId: string, scope: "once" | "session" = "once") {
    const entry = this.#queue.find(
      (candidate) => candidate.pending.requestId === requestId,
    );
    if (!entry) return;
    const sessionKey = approvalSessionKey(entry.pending.request);
    const effectiveScope =
      scope === "session" && sessionKey ? "session" : "once";
    if (effectiveScope === "session") {
      if (this.#sessionGrants.size >= MAX_SESSION_GRANTS) {
        const oldest = this.#sessionGrants.values().next().value as
          string | undefined;
        if (oldest) this.#sessionGrants.delete(oldest);
      }
      this.#sessionGrants.add(sessionKey!);
    }
    this.#settle(requestId, { approved: true, scope: effectiveScope });
  }

  deny(requestId: string) {
    this.#settle(requestId, { approved: false });
  }

  clearSession(approvalSessionId: string) {
    const prefix = `${approvalSessionId}\0`;
    for (const key of this.#sessionGrants) {
      if (key.startsWith(prefix)) this.#sessionGrants.delete(key);
    }
    for (const entry of [...this.#queue]) {
      if (entry.pending.request.approvalSessionId === approvalSessionId) {
        this.deny(entry.pending.requestId);
      }
    }
  }

  denyAll() {
    this.#sessionGrants.clear();
    for (const entry of [...this.#queue]) this.deny(entry.pending.requestId);
  }

  #settle(requestId: string, decision: McpToolApprovalDecision) {
    const index = this.#queue.findIndex(
      (entry) => entry.pending.requestId === requestId,
    );
    if (index < 0) return;
    const [entry] = this.#queue.splice(index, 1);
    if (!entry) return;
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
    entry.resolve(decision);
    this.#emit();
  }

  #emit() {
    const pending = this.pending();
    for (const listener of this.#listeners) listener(pending);
  }
}

function approvalSessionKey(request: McpToolApprovalRequest) {
  return request.risk === "read" && request.approvalSessionId
    ? `${request.approvalSessionId}\0${request.serverId}\0${request.serverRevision}\0${request.toolName}\0${request.toolDefinitionRevision}`
    : undefined;
}

function invocationPatch(
  request: McpToolApprovalRequest,
  argumentsJson: string,
) {
  const target = `mcp://${request.serverId}/${request.toolName}`;
  const invocation = canonicalJson({
    arguments: JSON.parse(argumentsJson) as unknown,
    serverRevision: request.serverRevision,
    tool: request.toolName,
  });
  return [
    `--- ${target}`,
    `+++ ${target}`,
    "@@ external tool invocation @@",
    '-{"state":"not-invoked"}',
    `+${invocation}`,
    "",
  ].join("\n");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("MCP 参数包含非有限数字。");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    throw new Error("MCP 参数必须是确定性的 JSON。");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function sha256Hex(value: string) {
  const Crypto = await import("expo-crypto");
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}
