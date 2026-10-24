import type {
  AiDataCategory,
  AiDataConsentGrant,
  AiDataConsentPort,
  AiDataConsentStore,
  AiDataRecipient,
  PendingAiDataConsent,
} from "@/application/ports/ai-data-consent";
import { AI_CONSENT_POLICY_VERSION } from "@/config/compliance";

type QueueEntry = {
  consentKey: string;
  request: PendingAiDataConsent;
  resolve: (approved: boolean) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

function consentKey(recipient: AiDataRecipient) {
  return JSON.stringify([
    recipient.providerId,
    recipient.baseUrl,
    recipient.modelId,
  ]);
}

function normalizedCategories(input: readonly AiDataCategory[]) {
  return [...new Set(input)].sort() as AiDataCategory[];
}

function covers(
  grant: AiDataConsentGrant,
  requested: readonly AiDataCategory[],
) {
  return (
    grant.policyVersion === AI_CONSENT_POLICY_VERSION &&
    requested.every((category) => grant.categories.includes(category))
  );
}

export class AiDataConsentBroker implements AiDataConsentPort {
  readonly #store: AiDataConsentStore;
  readonly #createRequestId: () => string;
  readonly #now: () => Date;
  readonly #queue: QueueEntry[] = [];
  readonly #listeners = new Set<
    (request: PendingAiDataConsent | null) => void
  >();

  constructor(
    store: AiDataConsentStore,
    createRequestId: () => string,
    now: () => Date = () => new Date(),
  ) {
    this.#store = store;
    this.#createRequestId = createRequestId;
    this.#now = now;
  }

  async requestConsent(
    recipient: AiDataRecipient,
    requestedCategories: readonly AiDataCategory[],
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) return false;
    const requested = normalizedCategories(requestedCategories);
    if (requested.length === 0) throw new Error("AI 数据授权范围不能为空。");
    const key = consentKey(recipient);
    const existing = await this.#store.find(key);
    if (existing && covers(existing, requested)) return true;
    const request: PendingAiDataConsent = {
      ...recipient,
      requestId: this.#createRequestId(),
      categories: requested,
      requestedAt: this.#now().toISOString(),
    };
    return new Promise<boolean>((resolve) => {
      const entry: QueueEntry = { consentKey: key, request, resolve, signal };
      if (signal) {
        entry.onAbort = () => this.deny(request.requestId);
        signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this.#queue.push(entry);
      if (this.#queue.length === 1) this.#emit();
      if (signal?.aborted) this.deny(request.requestId);
    });
  }

  subscribe(listener: (request: PendingAiDataConsent | null) => void) {
    this.#listeners.add(listener);
    listener(this.pending());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  pending() {
    return this.#queue[0]?.request ?? null;
  }

  async approve(requestId: string) {
    const entry = this.#queue.find(
      (candidate) => candidate.request.requestId === requestId,
    );
    if (!entry) return;
    const {
      requestId: _requestId,
      requestedAt: _requestedAt,
      ...recipient
    } = entry.request;
    await this.#store.save({
      ...recipient,
      consentKey: entry.consentKey,
      consentedAt: this.#now().toISOString(),
      policyVersion: AI_CONSENT_POLICY_VERSION,
    });
    this.#settle(requestId, true);
  }

  deny(requestId: string) {
    this.#settle(requestId, false);
  }

  denyAll() {
    for (const entry of [...this.#queue])
      this.#settle(entry.request.requestId, false);
  }

  listGrants() {
    return this.#store.list();
  }

  async withdrawAll() {
    this.denyAll();
    await this.#store.withdrawAll();
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
