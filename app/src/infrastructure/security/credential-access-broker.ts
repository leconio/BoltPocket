import type {
  AgentCredentialAccessDecision,
  AgentCredentialAccessPort,
  CredentialVaultItem,
  CredentialVaultPort,
  PendingCredentialAccess,
} from "@/application/ports/credential-vault";

type QueueEntry = {
  request: PendingCredentialAccess;
  resolve: (approved: boolean) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export class CredentialAccessBroker implements AgentCredentialAccessPort {
  readonly #vault: CredentialVaultPort;
  readonly #createRequestId: () => string;
  readonly #now: () => Date;
  readonly #queue: QueueEntry[] = [];
  readonly #listeners = new Set<
    (request: PendingCredentialAccess | null) => void
  >();

  constructor(
    vault: CredentialVaultPort,
    createRequestId: () => string,
    now: () => Date = () => new Date(),
  ) {
    this.#vault = vault;
    this.#createRequestId = createRequestId;
    this.#now = now;
  }

  async listAuthorized(projectId: string): Promise<CredentialVaultItem[]> {
    const items = await this.#vault.list();
    return items.filter(
      (item) =>
        item.agentAccess !== "internal-only" &&
        item.projectIds.includes(projectId),
    );
  }

  async requestAccess(
    input: {
      credentialId: string;
      projectId: string;
      projectName: string;
      conversationId: string;
      purpose: string;
    },
    signal?: AbortSignal,
  ): Promise<AgentCredentialAccessDecision> {
    if (signal?.aborted) return { approved: false };
    const authorized = await this.listAuthorized(input.projectId);
    const item = authorized.find(
      (candidate) => candidate.id === input.credentialId,
    );
    if (!item) {
      throw new Error("当前项目没有这条密码本记录的授权。");
    }
    if (item.kind === "ssh") {
      throw new Error(
        "SSH 凭据不能读取明文；只能由项目授权的内部 SSH 连接使用。",
      );
    }
    const purpose = input.purpose.trim();
    if (!purpose || purpose.length > 240 || purpose.includes("\0")) {
      throw new Error("Agent 必须说明本次读取密码本的具体用途。");
    }
    if (signal?.aborted) return { approved: false };
    const request: PendingCredentialAccess = {
      requestId: this.#createRequestId(),
      credentialId: item.id,
      credentialLabel: item.label,
      credentialKind: item.kind,
      ...(item.sshAuthentication
        ? { credentialSshAuthentication: item.sshAuthentication }
        : {}),
      ...(item.apiAuthentication
        ? { credentialApiAuthentication: item.apiAuthentication }
        : {}),
      projectId: input.projectId,
      projectName: input.projectName,
      conversationId: input.conversationId,
      purpose,
      requestedAt: this.#now().toISOString(),
    };
    const approved = await new Promise<boolean>((resolve) => {
      const entry: QueueEntry = { request, resolve, signal };
      if (signal) {
        entry.onAbort = () => this.deny(request.requestId);
        signal.addEventListener("abort", entry.onAbort, { once: true });
        if (signal.aborted) {
          signal.removeEventListener("abort", entry.onAbort);
          resolve(false);
          return;
        }
      }
      this.#queue.push(entry);
      if (this.#queue.length === 1) this.#emit();
    });
    if (!approved || signal?.aborted) return { approved: false };
    const value = await this.#vault.readForProject(
      input.credentialId,
      input.projectId,
    );
    return { approved: true, ...value };
  }

  subscribe(listener: (request: PendingCredentialAccess | null) => void) {
    this.#listeners.add(listener);
    listener(this.pending());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  pending() {
    return this.#queue[0]?.request ?? null;
  }

  approve(requestId: string) {
    this.#settle(requestId, true);
  }

  deny(requestId: string) {
    this.#settle(requestId, false);
  }

  denyCredential(credentialId: string) {
    for (const entry of [...this.#queue]) {
      if (entry.request.credentialId === credentialId) {
        this.#settle(entry.request.requestId, false);
      }
    }
  }

  denyAll() {
    for (const entry of [...this.#queue]) {
      this.#settle(entry.request.requestId, false);
    }
  }

  #settle(requestId: string, approved: boolean) {
    const index = this.#queue.findIndex(
      (entry) => entry.request.requestId === requestId,
    );
    if (index < 0) return;
    const [entry] = this.#queue.splice(index, 1);
    if (!entry) return;
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
    entry.resolve(approved);
    this.#emit();
  }

  #emit() {
    const pending = this.pending();
    for (const listener of this.#listeners) listener(pending);
  }
}
