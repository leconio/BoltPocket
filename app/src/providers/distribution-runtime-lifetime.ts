function abortError() {
  const error = new Error("Distribution runtime is no longer active.");
  error.name = "AbortError";
  return error;
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal) return init.signal;
  return typeof Request !== "undefined" && input instanceof Request
    ? input.signal
    : undefined;
}

function fallbackCombinedSignal(
  lifetimeSignal: AbortSignal,
  operationSignal: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  lifetimeSignal.addEventListener("abort", abort, { once: true });
  operationSignal.addEventListener("abort", abort, { once: true });
  if (lifetimeSignal.aborted || operationSignal.aborted) controller.abort();
  return {
    signal: controller.signal,
    release() {
      lifetimeSignal.removeEventListener("abort", abort);
      operationSignal.removeEventListener("abort", abort);
    },
  };
}

export function createDistributionRuntimeLifetime(
  baseFetch: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const scopedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const operationSignal = requestSignal(input, init);
    if (controller.signal.aborted || operationSignal?.aborted) {
      throw abortError();
    }
    if (!operationSignal || operationSignal === controller.signal) {
      return baseFetch(input, { ...init, signal: controller.signal });
    }
    if (typeof AbortSignal.any === "function") {
      return baseFetch(input, {
        ...init,
        signal: AbortSignal.any([controller.signal, operationSignal]),
      });
    }
    const combined = fallbackCombinedSignal(controller.signal, operationSignal);
    try {
      return await baseFetch(input, { ...init, signal: combined.signal });
    } finally {
      combined.release();
    }
  }) as typeof fetch;

  return {
    abort() {
      controller.abort();
    },
    fetch: scopedFetch,
    signal: controller.signal,
  };
}
