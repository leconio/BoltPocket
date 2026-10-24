import {
  type RuntimeTool,
  type RuntimeToolResult,
} from "@boltpocket/agent-runtime";
import type { ProjectShellJavaScriptExecuteResult } from "@boltpocket/project-shell";
import { type Static, Type } from "typebox";

export const AGENT_JAVASCRIPT_MAX_FILES = 8;
export const AGENT_JAVASCRIPT_MAX_INPUT_BYTES = 240 * 1024;

const agentJavaScriptParameters = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 64 * 1024 }),
    stdin: Type.Optional(Type.String({ maxLength: 128 * 1024 })),
    files: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 1_024 }), {
        maxItems: AGENT_JAVASCRIPT_MAX_FILES,
        uniqueItems: true,
      }),
    ),
    args: Type.Optional(
      Type.Array(Type.String({ maxLength: 4_096 }), { maxItems: 32 }),
    ),
  },
  { additionalProperties: false },
);

export type AgentJavaScriptToolInput = Static<typeof agentJavaScriptParameters>;

export type AgentJavaScriptExecutor = (
  input: AgentJavaScriptToolInput,
  signal?: AbortSignal,
) => Promise<ProjectShellJavaScriptExecuteResult>;

type AgentJavaScriptToolDetails = {
  exitCode: number;
  fileCount: number;
  hasResult: boolean;
};

export function createAgentJavaScriptTool(
  executeJavaScript: AgentJavaScriptExecutor,
): RuntimeTool<typeof agentJavaScriptParameters, AgentJavaScriptToolDetails> {
  return {
    name: "js_exec",
    label: "运行计算",
    description:
      "Run bounded isolated JavaScript for exact non-trivial calculations and in-memory JSON or text transformations, including grouping, sorting, deduplication, statistics, date operations, and regular-expression processing. Prefer this over mental arithmetic when correctness matters. For integer arithmetic where an operand or result may exceed Number.MAX_SAFE_INTEGER, use BigInt literals and return the exact decimal with .toString(); never use Number for that calculation. The final expression is returned automatically. stdin is exposed as input.stdin; only the explicit project paths in files are copied into input.files. Use project_context_read to discover project paths. It has no network, imports, filesystem bridge, native APIs, credentials, persistence, or direct writes.",
    risk: "read",
    parameters: agentJavaScriptParameters,
    executionMode: "sequential",
    execute: async (input, context) => {
      const result = validateAgentJavaScriptResult(
        await executeJavaScript(input, context.signal),
      );
      return {
        content: JSON.stringify({
          exitCode: result.exitCode,
          result: result.result,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
        details: {
          exitCode: result.exitCode,
          fileCount: input.files?.length ?? 0,
          hasResult: result.result !== null,
        },
      } satisfies RuntimeToolResult<AgentJavaScriptToolDetails>;
    },
  };
}

function validateAgentJavaScriptResult(
  value: ProjectShellJavaScriptExecuteResult,
): Required<
  Pick<
    ProjectShellJavaScriptExecuteResult,
    "stdout" | "stderr" | "result" | "exitCode"
  >
> {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.stdout !== "string" ||
    typeof value.stderr !== "string" ||
    (value.result !== undefined &&
      value.result !== null &&
      typeof value.result !== "string") ||
    !Number.isSafeInteger(value.exitCode) ||
    value.exitCode < 0 ||
    value.exitCode > 255
  ) {
    throw new TypeError("js_exec returned an invalid isolated-runtime result");
  }
  if ((value.changes?.length ?? 0) > 0) {
    throw new Error("js_exec is read-only and rejected runtime file changes");
  }
  return {
    stdout: value.stdout,
    stderr: value.stderr,
    result: value.result ?? null,
    exitCode: value.exitCode,
  };
}
