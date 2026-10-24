export const QUICK_JS_LIMITS = Object.freeze({
  codeBytes: 512 * 1024,
  inputBytes: 256 * 1024,
  timeoutMs: { default: 1_000, min: 10, max: 10_000 },
  memoryLimitBytes: {
    default: 16 * 1024 * 1024,
    min: 1024 * 1024,
    max: 64 * 1024 * 1024,
  },
  stackLimitBytes: {
    default: 512 * 1024,
    min: 256 * 1024,
    max: 1024 * 1024,
  },
  maxOutputBytes: { default: 64 * 1024, min: 1024, max: 1024 * 1024 },
});

export type QuickJsExecutionInput = {
  code: string;
  filename?: string;
  input?: unknown;
  timeoutMs?: number;
  memoryLimitBytes?: number;
  stackLimitBytes?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
};

export type QuickJsExecutionResult = {
  stdout: string;
  stderr: string;
  result: string | null;
  exitCode: number;
};

export type QuickJsAvailability = Readonly<{
  available: boolean;
  engine: "quickjs";
  isolation: "native-runtime-per-execution";
}>;

export type QuickJsNativeAdapter = {
  execute(
    executionId: number,
    code: string,
    filename: string,
    inputJson: string | null,
    timeoutMs: number,
    memoryLimitBytes: number,
    stackLimitBytes: number,
    maxOutputBytes: number,
  ): Promise<unknown>;
  cancel?(executionId: number): void | Promise<void>;
};

export type QuickJsExecutor = {
  readonly availability: QuickJsAvailability;
  readonly isAvailable: boolean;
  execute(input: QuickJsExecutionInput): Promise<QuickJsExecutionResult>;
};

const utf8 = new TextEncoder();
let nextExecutionId = 1;

function newExecutionId(): number {
  const current = nextExecutionId;
  nextExecutionId = nextExecutionId >= 2_147_483_647 ? 1 : nextExecutionId + 1;
  return current;
}

function abortError(): Error {
  const error = new Error("js-exec was cancelled.");
  error.name = "AbortError";
  return error;
}

function byteLength(value: string): number {
  return utf8.encode(value).byteLength;
}

function boundedInteger(
  name: string,
  value: number | undefined,
  limits: { default: number; min: number; max: number },
): number {
  const normalized = value ?? limits.default;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < limits.min ||
    normalized > limits.max
  ) {
    throw new RangeError(
      `${name} must be an integer between ${limits.min} and ${limits.max}.`,
    );
  }
  return normalized;
}

function safeFilename(value: string | undefined): string {
  const leaf = (value ?? "js-exec.js")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/gu, "_")
    .trim();
  if (!leaf) return "js-exec.js";
  let result = "";
  for (const point of Array.from(leaf).slice(0, 80)) {
    if (byteLength(result + point) > 128) break;
    result += point;
  }
  return result || "js-exec.js";
}

function serializeInput(value: unknown): string | null {
  if (value === undefined) return null;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("js-exec input must be JSON-serializable.");
  }
  if (serialized === undefined) {
    throw new TypeError("js-exec input must be JSON-serializable.");
  }
  if (byteLength(serialized) > QUICK_JS_LIMITS.inputBytes) {
    throw new RangeError(
      `js-exec input exceeds ${QUICK_JS_LIMITS.inputBytes} UTF-8 bytes.`,
    );
  }
  return serialized;
}

function consumeUtf8Budget(value: string, budget: number): number {
  let remaining = budget;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    let width: number;
    if (codeUnit <= 0x7f) {
      width = 1;
    } else if (codeUnit <= 0x7ff) {
      width = 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        width = 4;
        index += 1;
      } else {
        width = 3;
      }
    } else {
      width = 3;
    }
    if (width > remaining) return -1;
    remaining -= width;
  }
  return remaining;
}

function validateResult(
  value: unknown,
  maxOutputBytes: number,
): QuickJsExecutionResult {
  if (!value || typeof value !== "object") {
    throw new Error("The native js-exec runtime returned an invalid result.");
  }
  const candidate = value as Record<string, unknown>;
  const stdout = candidate.stdout;
  const stderr = candidate.stderr;
  const result = candidate.result;
  const exitCode = candidate.exitCode;
  if (
    typeof stdout !== "string" ||
    typeof stderr !== "string" ||
    (result !== null && typeof result !== "string") ||
    !Number.isSafeInteger(exitCode) ||
    (exitCode as number) < 0 ||
    (exitCode as number) > 255
  ) {
    throw new Error("The native js-exec runtime returned an invalid result.");
  }
  let remaining = consumeUtf8Budget(stdout, maxOutputBytes);
  if (remaining >= 0) remaining = consumeUtf8Budget(stderr, remaining);
  if (remaining >= 0 && result !== null) {
    remaining = consumeUtf8Budget(result, remaining);
  }
  if (remaining < 0) {
    throw new Error(
      "The native js-exec runtime exceeded the requested UTF-8 output limit.",
    );
  }
  return {
    stdout,
    stderr,
    result,
    exitCode: exitCode as number,
  };
}

export function createQuickJsExecutor(
  adapter: QuickJsNativeAdapter | null,
): QuickJsExecutor {
  const availability: QuickJsAvailability = Object.freeze({
    available: adapter !== null,
    engine: "quickjs",
    isolation: "native-runtime-per-execution",
  });

  return Object.freeze({
    availability,
    isAvailable: availability.available,
    async execute(input: QuickJsExecutionInput) {
      if (!adapter) {
        throw new Error(
          "The isolated js-exec runtime is unavailable in this build. Create a new Expo development build.",
        );
      }
      if (!input || typeof input !== "object") {
        throw new TypeError("js-exec options are required.");
      }
      if (typeof input.code !== "string" || input.code.length === 0) {
        throw new TypeError("js-exec code must be a non-empty string.");
      }
      if (byteLength(input.code) > QUICK_JS_LIMITS.codeBytes) {
        throw new RangeError(
          `js-exec code exceeds ${QUICK_JS_LIMITS.codeBytes} UTF-8 bytes.`,
        );
      }
      if (input.filename !== undefined && typeof input.filename !== "string") {
        throw new TypeError("js-exec filename must be a string.");
      }

      const timeoutMs = boundedInteger(
        "timeoutMs",
        input.timeoutMs,
        QUICK_JS_LIMITS.timeoutMs,
      );
      const memoryLimitBytes = boundedInteger(
        "memoryLimitBytes",
        input.memoryLimitBytes,
        QUICK_JS_LIMITS.memoryLimitBytes,
      );
      const maxOutputBytes = boundedInteger(
        "maxOutputBytes",
        input.maxOutputBytes,
        QUICK_JS_LIMITS.maxOutputBytes,
      );
      const stackLimitBytes = boundedInteger(
        "stackLimitBytes",
        input.stackLimitBytes,
        QUICK_JS_LIMITS.stackLimitBytes,
      );
      if (input.signal?.aborted) throw abortError();
      const executionId = newExecutionId();
      const onAbort = () => {
        try {
          void adapter.cancel?.(executionId);
        } catch {
          // The hard native deadline remains the final cancellation bound.
        }
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const result = await adapter.execute(
          executionId,
          input.code,
          safeFilename(input.filename),
          serializeInput(input.input),
          timeoutMs,
          memoryLimitBytes,
          stackLimitBytes,
          maxOutputBytes,
        );
        if (input.signal?.aborted) throw abortError();
        return validateResult(result, maxOutputBytes);
      } finally {
        input.signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}
