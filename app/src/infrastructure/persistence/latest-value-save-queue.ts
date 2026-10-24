type PendingValue<Value> = Readonly<{ value: Value; version: number }>;
type Waiter = Readonly<{
  version: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}>;

/**
 * Serializes writes while replacing not-yet-started values with the newest one.
 * A waiter for a replaced value resolves only after that newer value is saved.
 */
export class LatestValueSaveQueue<Value> {
  readonly #beforeSave: () => Promise<void>;
  readonly #save: (value: Value) => Promise<void>;
  #latest: PendingValue<Value> | null = null;
  #nextVersion = 0;
  #runner: Promise<void> | null = null;
  #waiters: Waiter[] = [];

  constructor(input: {
    beforeSave?: () => Promise<void>;
    save: (value: Value) => Promise<void>;
  }) {
    this.#beforeSave = input.beforeSave ?? (() => Promise.resolve());
    this.#save = input.save;
  }

  enqueue(value: Value) {
    const version = (this.#nextVersion += 1);
    this.#latest = { value, version };
    const completion = this.#waitFor(version);
    this.#ensureRunner();
    return completion;
  }

  flush() {
    if (!this.#latest && !this.#runner) return Promise.resolve();
    const completion = this.#waitFor(this.#nextVersion);
    this.#ensureRunner();
    return completion;
  }

  #waitFor(version: number) {
    return new Promise<void>((resolve, reject) => {
      this.#waiters.push({ version, resolve, reject });
    });
  }

  #ensureRunner() {
    if (this.#runner) return;
    this.#runner = this.#drain().finally(() => {
      this.#runner = null;
      if (this.#latest) this.#ensureRunner();
    });
  }

  async #drain() {
    while (this.#latest) {
      try {
        await this.#beforeSave();
      } catch (error) {
        const failed = this.#latest;
        this.#latest = null;
        if (failed) this.#settleThrough(failed.version, error);
        continue;
      }
      const pending = this.#latest;
      this.#latest = null;
      try {
        await this.#save(pending.value);
        this.#settleThrough(pending.version);
      } catch (error) {
        if (!this.#latest) this.#settleThrough(pending.version, error);
      }
    }
  }

  #settleThrough(version: number, error?: unknown) {
    const remaining: Waiter[] = [];
    for (const waiter of this.#waiters) {
      if (waiter.version > version) {
        remaining.push(waiter);
      } else if (error === undefined) {
        waiter.resolve();
      } else {
        waiter.reject(error);
      }
    }
    this.#waiters = remaining;
  }
}
