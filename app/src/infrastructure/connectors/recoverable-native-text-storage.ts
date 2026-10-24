import { ConnectorError } from "@boltpocket/connector-core";
import type {
  LocalTextStorageEntry,
  LocalTextStoragePort,
  StoredRecoveryPoint,
} from "@boltpocket/connector-local";

export interface NativeTextFilePort {
  readText(locator: string): Promise<string>;
  writeText(locator: string, text: string): Promise<void>;
  persistRecovery(
    locator: string,
    snapshot: LocalTextStorageEntry,
  ): Promise<string>;
}

export type TextVersioner = (text: string) => Promise<string>;

type StoredRecovery = StoredRecoveryPoint & LocalTextStorageEntry;

export class RecoverableNativeTextStorage implements LocalTextStoragePort {
  readonly #allowedLocators: Set<string>;
  readonly #files: NativeTextFilePort;
  readonly #versionText: TextVersioner;
  readonly #latestRecovery = new Map<string, StoredRecovery>();

  constructor(input: {
    allowedLocators: string[];
    files: NativeTextFilePort;
    versionText: TextVersioner;
  }) {
    this.#allowedLocators = new Set(input.allowedLocators);
    this.#files = input.files;
    this.#versionText = input.versionText;
  }

  async read(locator: string): Promise<LocalTextStorageEntry> {
    this.#assertAllowed(locator);
    try {
      const text = await this.#files.readText(locator);
      return { locator, text, version: await this.#versionText(text) };
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        "Native text resource could not be read. Reconnect the source if its permission changed.",
        { cause: error, retryable: true },
      );
    }
  }

  async createRecoveryPoint(
    locator: string,
    snapshot: LocalTextStorageEntry,
  ): Promise<StoredRecoveryPoint> {
    this.#assertAllowed(locator);
    if (snapshot.locator !== locator) {
      throw new ConnectorError(
        "recovery_failed",
        "Recovery snapshot does not belong to this resource.",
      );
    }
    const current = await this.read(locator);
    if (
      current.version !== snapshot.version ||
      current.text !== snapshot.text
    ) {
      throw new ConnectorError(
        "conflict",
        "Resource changed before its recovery point was created.",
        { retryable: true },
      );
    }
    try {
      const storageRef = await this.#files.persistRecovery(locator, snapshot);
      this.#latestRecovery.set(locator, { ...snapshot, storageRef });
      return { storageRef, version: snapshot.version };
    } catch (error) {
      throw new ConnectorError(
        "recovery_failed",
        "Durable recovery data could not be stored; write was cancelled.",
        { cause: error, retryable: true },
      );
    }
  }

  async replaceWithRecovery(
    locator: string,
    expectedVersion: string,
    text: string,
  ): Promise<LocalTextStorageEntry> {
    const current = await this.read(locator);
    if (current.version !== expectedVersion) {
      throw new ConnectorError(
        "conflict",
        "Resource changed immediately before replacement.",
        { retryable: true },
      );
    }
    const recovery = this.#latestRecovery.get(locator);
    if (
      !recovery ||
      recovery.version !== current.version ||
      recovery.text !== current.text
    ) {
      throw new ConnectorError(
        "recovery_failed",
        "A matching durable recovery point is required before replacement.",
      );
    }

    try {
      await this.#files.writeText(locator, text);
      const written = await this.read(locator);
      if (written.text !== text) {
        throw new Error("Provider returned different text after replacement.");
      }
      return written;
    } catch (writeError) {
      try {
        await this.#files.writeText(locator, recovery.text);
        const restored = await this.read(locator);
        if (
          restored.text !== recovery.text ||
          restored.version !== recovery.version
        ) {
          throw new Error("Recovery verification failed.");
        }
      } catch (recoveryError) {
        throw new ConnectorError(
          "io_failure",
          "Replacement and automatic recovery both failed. The durable recovery point was preserved for manual repair.",
          { cause: recoveryError, retryable: false },
        );
      }
      throw new ConnectorError(
        "io_failure",
        "Replacement failed and the previous content was restored.",
        { cause: writeError, retryable: true },
      );
    }
  }

  #assertAllowed(locator: string) {
    if (!this.#allowedLocators.has(locator)) {
      throw new ConnectorError(
        "permission_denied",
        "Resource is outside the selected native connector scope.",
      );
    }
  }
}
