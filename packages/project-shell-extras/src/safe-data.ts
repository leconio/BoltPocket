import { byteLength } from "./bytes.ts";
import type { ProjectShellExtraLimits } from "./types.ts";

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function sanitizeStructuredData(
  input: unknown,
  limits: ProjectShellExtraLimits,
): unknown {
  let nodes = 0;

  const visit = (value: unknown, depth: number): unknown => {
    nodes++;
    if (nodes > limits.maxStructuredNodes) {
      throw new Error(
        `structured data node limit exceeded (${limits.maxStructuredNodes})`,
      );
    }
    if (depth > limits.maxStructuredDepth) {
      throw new Error(
        `structured data depth limit exceeded (${limits.maxStructuredDepth})`,
      );
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") {
      if (byteLength(value) > limits.maxCellBytes) {
        throw new Error(
          `structured string limit exceeded (${limits.maxCellBytes})`,
        );
      }
      return value;
    }
    if (Array.isArray(value))
      return value.map((item) => visit(item, depth + 1));
    if (typeof value === "object") {
      if (value instanceof Date) {
        if (!Number.isFinite(value.getTime()))
          throw new Error("invalid date value");
        return value.toISOString();
      }
      const result = Object.create(null) as Record<string, unknown>;
      for (const [key, child] of Object.entries(value)) {
        if (BLOCKED_KEYS.has(key))
          throw new Error(`unsafe object key '${key}'`);
        if (byteLength(key) > limits.maxCellBytes)
          throw new Error("object key is too large");
        result[key] = visit(child, depth + 1);
      }
      return result;
    }
    throw new Error(`unsupported structured value '${typeof value}'`);
  };

  return visit(input, 0);
}
