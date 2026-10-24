import { ConnectorError } from "@boltpocket/connector-core";

import type {
  LocalTextStorageEntry,
  LocalTextStoragePort,
  StoredRecoveryPoint,
} from "./storage.ts";

export class InMemoryLocalTextStorage implements LocalTextStoragePort {
  readonly #entries = new Map<string, LocalTextStorageEntry>();
  readonly recoveries = new Map<string, LocalTextStorageEntry>();
  failRecovery = false;
  failWrite = false;

  constructor(entries: LocalTextStorageEntry[]) {
    for (const entry of entries) this.#entries.set(entry.locator, { ...entry });
  }

  async read(locator: string) {
    const entry = this.#entries.get(locator);
    if (!entry) throw new ConnectorError("not_found", "Resource not found.");
    return { ...entry };
  }

  async createRecoveryPoint(
    locator: string,
    snapshot: LocalTextStorageEntry,
  ): Promise<StoredRecoveryPoint> {
    if (this.failRecovery) throw new Error("fixture recovery failure");
    const storageRef = `${locator}.recovery.${this.recoveries.size + 1}`;
    this.recoveries.set(storageRef, { ...snapshot });
    return { storageRef, version: snapshot.version };
  }

  async replaceWithRecovery(
    locator: string,
    expectedVersion: string,
    text: string,
  ) {
    if (this.failWrite) throw new Error("fixture write failure");
    const current = await this.read(locator);
    if (current.version !== expectedVersion) {
      throw new ConnectorError("conflict", "Version changed before write.");
    }
    const numericVersion = Number(current.version);
    const version = Number.isSafeInteger(numericVersion)
      ? String(numericVersion + 1)
      : `${current.version}:next`;
    const next = { locator, text, version };
    this.#entries.set(locator, next);
    return { ...next };
  }
}
