function abortError() {
  const error = new Error("Operation cancelled before its lease started.");
  error.name = "AbortError";
  return error;
}

export class SerializedOperationCoordinator {
  #queue: Promise<void> = Promise.resolve();
  readonly #activeSignals = new WeakSet<AbortSignal>();

  run<T>(operation: () => Promise<T>, signal?: AbortSignal) {
    if (signal && this.#activeSignals.has(signal)) {
      return Promise.resolve().then(() => {
        if (signal.aborted) throw abortError();
        return operation();
      });
    }
    const result = this.#queue.then(async () => {
      if (signal?.aborted) throw abortError();
      if (signal) this.#activeSignals.add(signal);
      try {
        return await operation();
      } finally {
        if (signal) this.#activeSignals.delete(signal);
      }
    });
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class SshCommandOperationCoordinator extends SerializedOperationCoordinator {}
