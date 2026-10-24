import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { recordEncryptedStorageWrite } from "@boltpocket/expo-performance-diagnostics";

import type { DurableDocumentStore, StoredDocument } from "./document-store";
import { createSingleFlightLoader } from "./single-flight-loader";

const DATABASE_NAME = "boltpocket-state-v1.db";
const DATABASE_KEY_ITEM = "boltpocket.database.key.v1";
const DATABASE_KEYCHAIN_SERVICE = "dev.boltpocket.app.database";
const MAX_KEY_LENGTH = 512;
const MAX_VALUE_BYTES = 16 * 1024 * 1024;
const DATABASE_KEY_PATTERN = /^[a-f0-9]{64}$/u;
const DATABASE_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/u;

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: DATABASE_KEYCHAIN_SERVICE,
};

export class EncryptedStateStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EncryptedStateStorageError";
  }
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function assertDocumentKey(key: string) {
  if (!key.trim() || key.length > MAX_KEY_LENGTH || key.includes("\0")) {
    throw new EncryptedStateStorageError("Invalid local document key.");
  }
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadOrCreateDatabaseKeyValue() {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new EncryptedStateStorageError(
      "Secure device storage is unavailable.",
    );
  }
  let key: string | null;
  try {
    key = await SecureStore.getItemAsync(DATABASE_KEY_ITEM, secureStoreOptions);
  } catch (error) {
    throw new EncryptedStateStorageError(
      "The encrypted local database key could not be read.",
      { cause: error },
    );
  }
  if (key !== null) {
    if (!DATABASE_KEY_PATTERN.test(key)) {
      throw new EncryptedStateStorageError(
        "The encrypted local database key is invalid.",
      );
    }
    return key;
  }
  const generated = bytesToHex(await Crypto.getRandomBytesAsync(32));
  try {
    await SecureStore.setItemAsync(
      DATABASE_KEY_ITEM,
      generated,
      secureStoreOptions,
    );
  } catch (error) {
    throw new EncryptedStateStorageError(
      "The encrypted local database key could not be saved.",
      { cause: error },
    );
  }
  return generated;
}

// App state and browser repositories open this database independently during
// startup. Without a shared first-run operation, every caller can observe a
// missing Keychain item and generate a different SQLCipher key. Only the last
// key would remain in Keychain, making the database unreadable after restart.
const loadOrCreateDatabaseKey = createSingleFlightLoader(
  loadOrCreateDatabaseKeyValue,
);

export function encryptedStateDatabaseName(namespace?: string) {
  if (!namespace) return DATABASE_NAME;
  if (!DATABASE_NAMESPACE_PATTERN.test(namespace)) {
    throw new EncryptedStateStorageError(
      "Invalid encrypted database namespace.",
    );
  }
  return `boltpocket-state-v1-${namespace}.db`;
}

async function openEncryptedDatabase(databaseName: string) {
  const key = await loadOrCreateDatabaseKey();
  const database = await SQLite.openDatabaseAsync(databaseName);
  try {
    // The key is generated locally as exactly 64 lowercase hexadecimal bytes.
    await database.execAsync(`PRAGMA key = "x'${key}'"`);
    const cipher = await database.getFirstAsync<Record<string, unknown>>(
      "PRAGMA cipher_version",
    );
    if (
      !cipher ||
      !Object.values(cipher).some(
        (value) => typeof value === "string" && value.length > 0,
      )
    ) {
      throw new EncryptedStateStorageError(
        "This build does not include encrypted SQLite support.",
      );
    }
    await database.execAsync(`
      PRAGMA cipher_memory_security = ON;
      PRAGMA secure_delete = ON;
      PRAGMA temp_store = MEMORY;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS durable_documents (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    if (error instanceof EncryptedStateStorageError) throw error;
    throw new EncryptedStateStorageError(
      "The encrypted local database could not be opened.",
      { cause: error },
    );
  }
}

export class ExpoEncryptedSqliteDocumentStore implements DurableDocumentStore {
  #database?: Promise<SQLite.SQLiteDatabase>;
  readonly #databaseName: string;
  #writeQueue: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(options: { namespace?: string } = {}) {
    this.#databaseName = encryptedStateDatabaseName(options.namespace);
  }

  async read(key: string) {
    assertDocumentKey(key);
    await this.#writeQueue;
    const row = await (
      await this.#getDatabase()
    ).getFirstAsync<{
      value: string;
    }>("SELECT value FROM durable_documents WHERE key = ?", key);
    return row?.value;
  }

  write(key: string, value: string) {
    assertDocumentKey(key);
    const valueBytes = byteLength(value);
    if (valueBytes > MAX_VALUE_BYTES) {
      throw new EncryptedStateStorageError(
        "Local state exceeds the encrypted document size limit.",
      );
    }
    return this.#enqueue(async () => {
      const startedAt = performance.now();
      let succeeded = false;
      try {
        const database = await this.#getDatabase();
        await database.runAsync(
          `INSERT INTO durable_documents (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at`,
          key,
          value,
          new Date().toISOString(),
        );
        succeeded = true;
      } finally {
        recordEncryptedStorageWrite({
          durationMs: performance.now() - startedAt,
          bytes: valueBytes,
          succeeded,
        });
      }
    });
  }

  remove(key: string) {
    assertDocumentKey(key);
    return this.#enqueue(async () => {
      await (
        await this.#getDatabase()
      ).runAsync("DELETE FROM durable_documents WHERE key = ?", key);
    });
  }

  async list(prefix: string): Promise<StoredDocument[]> {
    assertDocumentKey(prefix);
    await this.#writeQueue;
    return (await this.#getDatabase()).getAllAsync<StoredDocument>(
      `SELECT key, value FROM durable_documents
       WHERE substr(key, 1, ?) = ?
       ORDER BY key ASC`,
      prefix.length,
      prefix,
    );
  }

  async flush() {
    await this.#writeQueue;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#writeQueue;
    if (!this.#database) return;
    const database = await this.#database;
    await database.closeAsync();
  }

  #getDatabase() {
    if (this.#closed) {
      throw new EncryptedStateStorageError("Local state storage is closed.");
    }
    if (this.#database) return this.#database;
    const opening = openEncryptedDatabase(this.#databaseName);
    this.#database = opening;
    void opening.catch(() => {
      if (this.#database === opening) {
        // A later explicit operation may retry temporary SecureStore or device
        // unlock failures. openEncryptedDatabase always reuses the same key and
        // never replaces an unreadable database, so retries remain fail-closed.
        this.#database = undefined;
      }
    });
    return opening;
  }

  #enqueue(operation: () => Promise<void>) {
    if (this.#closed) {
      return Promise.reject(
        new EncryptedStateStorageError("Local state storage is closed."),
      );
    }
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.catch(() => undefined);
    return result;
  }
}
