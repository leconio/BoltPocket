import { LOCAL_MODELS, localModelById, type LocalModelId } from "./local-model-catalog.ts";

export type DownloadPhase = "missing" | "downloading" | "cancelling" | "verifying" | "ready" | "error";
export type DownloadState = Readonly<{ phase: DownloadPhase; received: number; error?: string }>;
export type ArtifactInfo = { ready: boolean; partialUri: string; freeBytes: number };
type Transfer = { run(): Promise<{ status: number } | undefined>; cancel(): Promise<void> };
type ActiveDownload = { id: LocalModelId; cancelled: boolean; transfer?: Transfer };
export type DownloadPort = {
  info(id: LocalModelId): Promise<ArtifactInfo>;
  removePartial(id: LocalModelId): Promise<void>;
  commit(id: LocalModelId): Promise<void>;
  transfer(id: LocalModelId, uri: string, progress: (bytes: number) => void): Transfer;
};
export type DownloadFailure = "network" | "storage" | "integrity";

/** One foreground transfer at a time. UI lifetime does not own the transfer. */
export class LocalDownloadController {
  private state = Object.fromEntries(LOCAL_MODELS.map((m) =>
    [m.id, { phase: "missing", received: 0 }])) as Record<LocalModelId, DownloadState>;
  private listeners = new Set<() => void>();
  private active?: ActiveDownload;
  constructor(private port: DownloadPort) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(id: LocalModelId, value: DownloadState) {
    this.state = { ...this.state, [id]: value };
    this.listeners.forEach((fn) => fn());
  }
  async refresh() {
    // Read-only refreshes may finish after a transfer started; never overwrite it.
    await Promise.all(LOCAL_MODELS.map(async (model) => {
      const info = await this.port.info(model.id);
      if (this.active?.id !== model.id) this.update(model.id, {
        phase: info.ready ? "ready" : "missing", received: info.ready ? model.bytes : 0,
      });
    }));
  }
  async download(id: LocalModelId) {
    if (this.active || this.state[id].phase === "ready") return;
    const model = localModelById(id);
    const operation: ActiveDownload = { id, cancelled: false };
    this.active = operation;
    this.update(id, { phase: "downloading", received: 0 });
    let failure: DownloadFailure = "network";
    try {
      let info = await this.port.info(id);
      if (operation.cancelled) return;
      if (info.ready) { this.update(id, { phase: "ready", received: model.bytes }); return; }
      await this.port.removePartial(id);
      if (operation.cancelled) return;
      // A previous process may have left gigabytes of partial data on disk.
      // Recheck capacity after removing it, before deciding a retry cannot fit.
      info = await this.port.info(id);
      if (operation.cancelled) return;
      failure = "storage";
      if (info.freeBytes < model.bytes + 256 * 1024 * 1024) throw new Error("storage");
      failure = "network";
      operation.transfer = this.port.transfer(id, info.partialUri, (received) => {
        if (operation.cancelled) return;
        this.update(id, { phase: "downloading", received: Math.max(0, Math.min(received, model.bytes)) });
      });
      const response = await operation.transfer.run();
      if (operation.cancelled) return;
      if (!response || response.status !== 200) throw new Error("http");
      failure = "integrity";
      this.update(id, { phase: "verifying", received: model.bytes });
      await this.port.commit(id);
      this.update(id, { phase: "ready", received: model.bytes });
    } catch {
      if (!operation.cancelled) this.update(id, { phase: "error", received: 0, error: failure });
    } finally {
      // Cancellation first awaits the native writer. A retry cannot race cleanup.
      try { await this.port.removePartial(id); } catch { /* An orphan is removed before retry. */ }
      if (operation.cancelled) this.update(id, { phase: "missing", received: 0 });
      this.active = undefined;
      this.listeners.forEach((fn) => fn());
    }
  }
  async cancel(id: LocalModelId) {
    const operation = this.active;
    if (!operation || operation.id !== id || this.state[id].phase === "verifying") return;
    operation.cancelled = true;
    this.update(id, { phase: "cancelling", received: this.state[id].received });
    await operation.transfer?.cancel();
  }
}
