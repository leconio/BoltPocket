import type { SshHostKey } from "../../application/ports/ssh-command-sessions.ts";
import {
  normalizeRemoteRoot,
  normalizeSshCommandAlias,
} from "./ssh-command-path.ts";

const INDEX_KEY = "boltpocket.ssh.command-profile.index.v3";
const RECORD_KEY_PREFIX = "boltpocket.ssh.command-profile.v3.";
const MAX_PROFILES = 32;
const MAX_INDEX_BYTES = 16 * 1024;
const MAX_RECORD_BYTES = 32 * 1024;
const PROFILE_ID_PATTERN = /^ssh-[a-f0-9]{16}$/u;
const CREDENTIAL_ID_PATTERN = /^credential-[a-zA-Z0-9-]{16,80}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

const recordKeys = new Set([
  "version",
  "profileId",
  "projectId",
  "alias",
  "host",
  "port",
  "username",
  "root",
  "expectedHostKey",
  "credentialId",
]);
const hostKeyKeys = new Set(["algorithm", "fingerprint"]);

export type PersistedSshCommandProfile = {
  version: 3;
  profileId: string;
  projectId: string;
  alias: string;
  host: string;
  port: number;
  username: string;
  root: string;
  expectedHostKey: SshHostKey;
  credentialId: string;
};

export interface SecureStringStore {
  isAvailable(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class SshCommandProfileStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SshCommandProfileStorageError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function validIdentifier(value: unknown, maxLength: number) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function validHostKey(value: unknown): value is SshHostKey {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, hostKeyKeys) &&
    validIdentifier(value.algorithm, 128) &&
    validIdentifier(value.fingerprint, 512)
  );
}

function decodeRecord(value: string): PersistedSshCommandProfile {
  if (byteLength(value) > MAX_RECORD_BYTES) {
    throw new SshCommandProfileStorageError(
      "Saved SSH command profile exceeds its size limit.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SshCommandProfileStorageError(
      "Saved SSH command profile is corrupt.",
    );
  }
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, recordKeys) ||
    parsed.version !== 3 ||
    typeof parsed.profileId !== "string" ||
    !PROFILE_ID_PATTERN.test(parsed.profileId) ||
    !validIdentifier(parsed.projectId, 240) ||
    typeof parsed.alias !== "string" ||
    !validIdentifier(parsed.host, 1_000) ||
    typeof parsed.port !== "number" ||
    !Number.isInteger(parsed.port) ||
    parsed.port < 1 ||
    parsed.port > 65_535 ||
    !validIdentifier(parsed.username, 1_000) ||
    typeof parsed.root !== "string" ||
    parsed.root.length > 4_000 ||
    !validHostKey(parsed.expectedHostKey) ||
    typeof parsed.credentialId !== "string" ||
    !CREDENTIAL_ID_PATTERN.test(parsed.credentialId)
  ) {
    throw new SshCommandProfileStorageError(
      "Saved SSH command profile is invalid.",
    );
  }
  try {
    if (
      normalizeSshCommandAlias(parsed.alias) !== parsed.alias ||
      normalizeRemoteRoot(parsed.root) !== parsed.root
    ) {
      throw new Error("SSH command profile was not normalized.");
    }
  } catch {
    throw new SshCommandProfileStorageError(
      "Saved SSH command profile has an invalid alias or root.",
    );
  }
  return parsed as PersistedSshCommandProfile;
}

function encodeRecord(record: PersistedSshCommandProfile) {
  return JSON.stringify(decodeRecord(JSON.stringify(record)));
}

function decodeIndex(value: string | null) {
  if (value === null) return [];
  if (byteLength(value) > MAX_INDEX_BYTES) {
    throw new SshCommandProfileStorageError(
      "Saved SSH command profile index exceeds its size limit.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SshCommandProfileStorageError(
      "Saved SSH command profile index is corrupt.",
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_PROFILES ||
    parsed.some(
      (item) => typeof item !== "string" || !PROFILE_ID_PATTERN.test(item),
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new SshCommandProfileStorageError(
      "Saved SSH command profile index is invalid.",
    );
  }
  return parsed as string[];
}

export class SshCommandProfileVault {
  #operationQueue: Promise<void> = Promise.resolve();

  constructor(readonly store: SecureStringStore) {}

  list() {
    return this.#enqueue(() => this.#list());
  }

  save(record: PersistedSshCommandProfile) {
    return this.#enqueue(() => this.#save(record));
  }

  remove(profileId: string) {
    return this.#enqueue(() => this.#remove(profileId));
  }

  async #list() {
    await this.#assertAvailable();
    const ids = decodeIndex(await this.store.get(INDEX_KEY));
    const records: PersistedSshCommandProfile[] = [];
    for (const id of ids) {
      const value = await this.store.get(this.#recordKey(id));
      if (value === null) continue;
      const record = decodeRecord(value);
      if (record.profileId !== id) {
        throw new SshCommandProfileStorageError(
          "Saved SSH command profile ID does not match its index.",
        );
      }
      records.push(record);
    }
    return records;
  }

  async #save(record: PersistedSshCommandProfile) {
    await this.#assertAvailable();
    const encoded = encodeRecord(record);
    const recordKey = this.#recordKey(record.profileId);
    const [previousRecord, indexValue] = await Promise.all([
      this.store.get(recordKey),
      this.store.get(INDEX_KEY),
    ]);
    const index = decodeIndex(indexValue);
    const nextIndex = index.includes(record.profileId)
      ? index
      : [...index, record.profileId].sort((left, right) =>
          left.localeCompare(right, "en"),
        );
    if (nextIndex.length > MAX_PROFILES) {
      throw new SshCommandProfileStorageError(
        "Too many saved SSH command profiles on this device.",
      );
    }
    if (index.includes(record.profileId)) {
      try {
        await this.store.set(recordKey, encoded);
      } catch (error) {
        throw new SshCommandProfileStorageError(
          "SSH command profile could not be updated.",
          { cause: error },
        );
      }
      return;
    }
    try {
      await this.store.set(INDEX_KEY, JSON.stringify(nextIndex));
      await this.store.set(recordKey, encoded);
    } catch (error) {
      try {
        await this.store.set(INDEX_KEY, JSON.stringify(index));
        if (previousRecord === null) await this.store.remove(recordKey);
        else await this.store.set(recordKey, previousRecord);
      } catch {
        throw new SshCommandProfileStorageError(
          "SSH command profile save failed and could not be restored.",
        );
      }
      throw new SshCommandProfileStorageError(
        "SSH command profile could not be saved.",
        { cause: error },
      );
    }
  }

  async #remove(profileId: string) {
    await this.#assertAvailable();
    const recordKey = this.#recordKey(profileId);
    const [previousRecord, indexValue] = await Promise.all([
      this.store.get(recordKey),
      this.store.get(INDEX_KEY),
    ]);
    const index = decodeIndex(indexValue);
    const nextIndex = index.filter((id) => id !== profileId);
    await this.store.remove(recordKey);
    try {
      await this.store.set(INDEX_KEY, JSON.stringify(nextIndex));
    } catch (error) {
      if (previousRecord !== null) {
        try {
          await this.store.set(recordKey, previousRecord);
        } catch {
          throw new SshCommandProfileStorageError(
            "SSH command profile removal failed and could not be restored.",
          );
        }
      }
      throw new SshCommandProfileStorageError(
        "SSH command profile index could not be updated.",
        { cause: error },
      );
    }
  }

  #recordKey(profileId: string) {
    if (!PROFILE_ID_PATTERN.test(profileId)) {
      throw new SshCommandProfileStorageError(
        "SSH command profile ID is invalid.",
      );
    }
    return `${RECORD_KEY_PREFIX}${profileId}`;
  }

  async #assertAvailable() {
    if (!(await this.store.isAvailable())) {
      throw new SshCommandProfileStorageError(
        "Secure device storage is unavailable for SSH command profiles.",
      );
    }
  }

  #enqueue<T>(operation: () => Promise<T>) {
    const result = this.#operationQueue.then(operation);
    this.#operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
