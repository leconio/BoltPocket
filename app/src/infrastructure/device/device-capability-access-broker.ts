import type {
  DeviceCapabilityAccessApprovalPort,
  PendingDeviceCapabilityAccess,
} from "@/application/ports/device-capabilities";

type QueueEntry = Readonly<{
  request: PendingDeviceCapabilityAccess;
  resolve: (approved: boolean) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}>;

const MAX_PENDING_REQUESTS = 32;

export class DeviceCapabilityAccessBroker implements DeviceCapabilityAccessApprovalPort {
  readonly #createRequestId: () => string;
  readonly #now: () => Date;
  readonly #queue: QueueEntry[] = [];
  readonly #listeners = new Set<
    (request: PendingDeviceCapabilityAccess | null) => void
  >();

  constructor(
    createRequestId: () => string,
    now: () => Date = () => new Date(),
  ) {
    this.#createRequestId = createRequestId;
    this.#now = now;
  }

  request(
    input: Omit<PendingDeviceCapabilityAccess, "requestId" | "requestedAt">,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    if (this.#queue.length >= MAX_PENDING_REQUESTS) {
      throw new Error("待处理的设备能力授权过多。");
    }
    const purpose = input.purpose.trim();
    if (!purpose || purpose.length > 240 || /[\0\r\n]/u.test(purpose)) {
      throw new Error("Agent 必须说明本次使用设备能力的具体用途。");
    }
    const request: PendingDeviceCapabilityAccess = Object.freeze({
      ...input,
      purpose,
      requestId: this.#createRequestId(),
      requestedAt: this.#now().toISOString(),
    });
    return new Promise<boolean>((resolve) => {
      const entry: QueueEntry = {
        request,
        resolve,
        signal,
        ...(signal ? { onAbort: () => this.deny(request.requestId) } : {}),
      };
      if (signal && entry.onAbort) {
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
  }

  subscribe(listener: (request: PendingDeviceCapabilityAccess | null) => void) {
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

  denyAll() {
    for (const entry of [...this.#queue])
      this.#settle(entry.request.requestId, false);
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
