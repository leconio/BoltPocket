import type {
  ProjectShellJavaScriptExecuteInput,
  ProjectShellJavaScriptExecuteResult,
  ProjectShellJavaScriptRuntime,
} from "@boltpocket/project-shell";

export type BoltPocketQuickJsExecutorPort = {
  readonly isAvailable: boolean;
  execute(input: {
    code: string;
    filename?: string;
    input?: unknown;
    timeoutMs?: number;
    memoryLimitBytes?: number;
    stackLimitBytes?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
  }): Promise<{
    stdout: string;
    stderr: string;
    result: string | null;
    exitCode: number;
  }>;
};

const NATIVE_LIMITS = Object.freeze({
  timeoutMs: { min: 10, max: 10_000 },
  memoryBytes: { min: 1024 * 1024, max: 64 * 1024 * 1024 },
  stackBytes: { min: 256 * 1024, max: 1024 * 1024 },
  outputBytes: { min: 1024, max: 1024 * 1024 },
});

/**
 * Adapts the separately isolated native QuickJS runtime to ProjectShell.
 * Only explicitly selected project files and piped text are copied into the
 * JSON-only `input` global; the sandbox has no direct filesystem, network,
 * module loader, or React Native bridge.
 */
export function adaptBoltPocketQuickJsExecutor(
  executor: BoltPocketQuickJsExecutorPort,
): ProjectShellJavaScriptRuntime {
  if (!executor || typeof executor !== "object") {
    throw new TypeError("An isolated QuickJS executor is required");
  }
  return Object.freeze({
    async execute(
      input: ProjectShellJavaScriptExecuteInput,
    ): Promise<ProjectShellJavaScriptExecuteResult> {
      if (!executor.isAvailable) {
        return failure("the isolated native runtime is unavailable");
      }
      if (!limitsFitNativeRuntime(input)) {
        return failure("the requested memory or stack limit is too small");
      }
      try {
        const result = await executor.execute({
          code: input.source,
          filename: input.filename,
          input: {
            args: [...input.args],
            cwd: input.cwd,
            stdin: input.stdin,
            files: input.files.map((file) => ({
              path: file.path,
              contents: file.contents,
            })),
          },
          timeoutMs: Math.min(
            input.limits.timeoutMs,
            NATIVE_LIMITS.timeoutMs.max,
          ),
          memoryLimitBytes: Math.min(
            input.limits.memoryBytes,
            NATIVE_LIMITS.memoryBytes.max,
          ),
          stackLimitBytes: Math.min(
            input.limits.stackBytes,
            NATIVE_LIMITS.stackBytes.max,
          ),
          maxOutputBytes: Math.min(
            input.limits.outputBytes,
            NATIVE_LIMITS.outputBytes.max,
          ),
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          result: result.result,
          exitCode: result.exitCode,
        };
      } catch (error) {
        if (isAbortError(error)) throw error;
        return failure(safeFailureReason(error));
      }
    },
  });
}

/** Lazily initializes Expo Modules only when `js-exec` is actually invoked. */
export function createBoltPocketQuickJsProjectShellRuntime(): ProjectShellJavaScriptRuntime {
  let runtime: Promise<ProjectShellJavaScriptRuntime> | undefined;
  return Object.freeze({
    async execute(input: ProjectShellJavaScriptExecuteInput) {
      runtime ??= import("@boltpocket/expo-quickjs").then(({ BoltPocketQuickJs }) =>
        adaptBoltPocketQuickJsExecutor(BoltPocketQuickJs),
      );
      return (await runtime).execute(input);
    },
  });
}

function limitsFitNativeRuntime(input: ProjectShellJavaScriptExecuteInput) {
  return (
    input.limits.timeoutMs >= NATIVE_LIMITS.timeoutMs.min &&
    input.limits.memoryBytes >= NATIVE_LIMITS.memoryBytes.min &&
    input.limits.stackBytes >= NATIVE_LIMITS.stackBytes.min &&
    input.limits.outputBytes >= NATIVE_LIMITS.outputBytes.min
  );
}

function failure(reason: string): ProjectShellJavaScriptExecuteResult {
  return {
    stdout: "",
    stderr: `js-exec: ${reason}\n`,
    exitCode: 1,
  };
}

function safeFailureReason(error: unknown) {
  if (!(error instanceof Error)) return "isolated execution failed";
  if (/input exceeds/iu.test(error.message)) {
    return "the selected input exceeds the bounded JSON input limit";
  }
  if (/code exceeds/iu.test(error.message)) {
    return "the script exceeds the bounded source limit";
  }
  if (/unavailable/iu.test(error.message)) {
    return "the isolated native runtime is unavailable";
  }
  return "isolated execution failed";
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}
