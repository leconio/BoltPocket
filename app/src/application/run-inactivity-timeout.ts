type TimerHandle = ReturnType<typeof setTimeout>;

type RunInactivityTimeoutOptions = {
  timeoutMs: number;
  onTimeout: () => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancelScheduled?: (handle: TimerHandle) => void;
};

/**
 * Keeps an inactivity deadline without clearing and recreating a native timer
 * for every streamed model delta. A busy stream updates one number; the timer
 * only wakes at the previous deadline and, when necessary, once more at the
 * latest deadline.
 */
export function createRunInactivityTimeout({
  timeoutMs,
  onTimeout,
  now = Date.now,
  schedule = setTimeout,
  cancelScheduled = clearTimeout,
}: RunInactivityTimeoutOptions) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Run inactivity timeout must be positive.");
  }

  let deadline: number | undefined;
  let scheduled: TimerHandle | undefined;

  const arm = () => {
    if (scheduled || deadline === undefined) return;
    scheduled = schedule(checkDeadline, Math.max(0, deadline - now()));
  };

  const checkDeadline = () => {
    scheduled = undefined;
    if (deadline === undefined) return;
    const remaining = deadline - now();
    if (remaining > 0) {
      scheduled = schedule(checkDeadline, remaining);
      return;
    }
    deadline = undefined;
    onTimeout();
  };

  return {
    touch() {
      deadline = now() + timeoutMs;
      arm();
    },
    cancel() {
      deadline = undefined;
      if (!scheduled) return;
      cancelScheduled(scheduled);
      scheduled = undefined;
    },
  };
}
