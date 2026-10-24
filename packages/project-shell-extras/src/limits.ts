import type { ProjectShellExtraLimits } from "./types.ts";

export const DEFAULT_EXTRA_LIMITS: Readonly<ProjectShellExtraLimits> = {
  maxInputBytes: 4 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxArchiveBytes: 8 * 1024 * 1024,
  maxArchiveEntries: 2_048,
  maxExtractedBytes: 16 * 1024 * 1024,
  maxTraversalEntries: 4_096,
  maxPathDepth: 64,
  maxStructuredDepth: 64,
  maxStructuredNodes: 100_000,
  maxCsvRows: 10_000,
  maxCsvCells: 200_000,
  maxCellBytes: 64 * 1024,
  maxSqlRows: 1_000,
  maxSqlColumns: 128,
  maxSqlCellBytes: 64 * 1024,
  maxSqlTimeMs: 3_000,
  maxDatabaseBytes: 8 * 1024 * 1024,
};

export function resolveExtraLimits(
  overrides: Partial<ProjectShellExtraLimits> | undefined,
): ProjectShellExtraLimits {
  const limits = { ...DEFAULT_EXTRA_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

export function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("command execution aborted");
  }
}

export function assertByteLimit(
  label: string,
  byteLength: number,
  maximum: number,
): void {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > maximum
  ) {
    throw new Error(`${label}: byte limit exceeded (${maximum})`);
  }
}
