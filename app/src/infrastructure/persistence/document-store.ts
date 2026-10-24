export type StoredDocument = {
  key: string;
  value: string;
};

export interface DurableDocumentStore {
  read(key: string): Promise<string | undefined>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<StoredDocument[]>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class InMemoryDurableDocumentStore implements DurableDocumentStore {
  readonly #documents = new Map<string, string>();

  async read(key: string) {
    return this.#documents.get(key);
  }

  async write(key: string, value: string) {
    this.#documents.set(key, value);
  }

  async remove(key: string) {
    this.#documents.delete(key);
  }

  async list(prefix: string) {
    return [...this.#documents]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value }))
      .sort((left, right) => left.key.localeCompare(right.key, "en"));
  }

  async flush() {}

  async close() {}
}
