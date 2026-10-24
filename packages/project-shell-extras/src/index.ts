import { resolveExtraLimits } from "./limits.ts";
import { createSqlite3Command } from "./sqlite3.ts";
import { createTarCommand } from "./tar.ts";
import type {
  ProjectShellExtraCommand,
  ProjectShellExtrasOptions,
} from "./types.ts";
import { createXanCommand } from "./xan.ts";
import { createYqCommand } from "./yq.ts";

export { DEFAULT_EXTRA_LIMITS, resolveExtraLimits } from "./limits.ts";
export { createSqlite3Command } from "./sqlite3.ts";
export { createTarCommand } from "./tar.ts";
export type {
  ExtraCommandContext,
  ExtraCommandResult,
  ExtraFileSystem,
  ExtraFsStat,
  ProjectShellExtraCommand,
  ProjectShellExtraLimits,
  ProjectShellExtrasOptions,
  ProjectShellSqliteAdapter,
  SqliteExecutionInput,
  SqliteExecutionResult,
  SqliteResultSet,
  SqliteValue,
} from "./types.ts";
export { createXanCommand, supportedXanSubcommands } from "./xan.ts";
export { createYqCommand, YQ_FORMATS } from "./yq.ts";
export {
  decodeZipTextEntry,
  extractBoundedZipArchive,
  type BoundedZipArchiveEntry,
  type BoundedZipArchiveLimits,
} from "./zip.ts";

/** Build the four custom-command objects expected by just-bash's Bash options. */
export function createProjectShellExtraCommands(
  options: ProjectShellExtrasOptions = {},
): readonly ProjectShellExtraCommand[] {
  const limits = resolveExtraLimits(options.limits);
  return [
    createTarCommand(limits),
    createYqCommand(limits),
    createXanCommand(limits),
    createSqlite3Command(limits, options.sqlite),
  ];
}

export const PROJECT_SHELL_EXTRA_CAPABILITIES = [
  {
    name: "tar",
    status: "available",
    detail:
      "bounded deterministic USTAR create/list/extract with streaming gzip decode",
  },
  {
    name: "yq",
    status: "available",
    detail:
      "YAML/JSON/XML/INI/CSV/TOML conversion using the registered bounded jq command",
  },
  {
    name: "xan",
    status: "partial",
    detail:
      "bounded common CSV operations; Moonblade and multi-output-file commands fail closed",
  },
  {
    name: "sqlite3",
    status: "adapter-required",
    detail:
      "bounded read-only native adapter; never claims availability without injection",
  },
] as const;
