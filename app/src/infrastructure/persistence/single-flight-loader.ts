/**
 * Shares one load/create operation across all callers in this process. A
 * successful value remains cached; a failed operation is cleared so an
 * explicit later operation can retry a transient device-storage failure.
 */
export function createSingleFlightLoader<T>(operation: () => Promise<T>) {
  let current: Promise<T> | undefined;

  return () => {
    if (current) return current;
    const started = Promise.resolve().then(operation);
    current = started;
    void started.catch(() => {
      if (current === started) current = undefined;
    });
    return started;
  };
}

export type MutableSingleFlightLoader<T> = Readonly<{
  load: () => Promise<T>;
  replace: (value: T) => void;
  invalidate: () => void;
}>;

/**
 * Adds explicit cache replacement and invalidation for repositories whose
 * durable value can change during the process lifetime.
 */
export function createMutableSingleFlightLoader<T>(
  operation: () => Promise<T>,
): MutableSingleFlightLoader<T> {
  let current: Promise<T> | undefined;

  return {
    load() {
      if (current) return current;
      const started = Promise.resolve().then(operation);
      current = started;
      void started.catch(() => {
        if (current === started) current = undefined;
      });
      return started;
    },
    replace(value) {
      current = Promise.resolve(value);
    },
    invalidate() {
      current = undefined;
    },
  };
}
