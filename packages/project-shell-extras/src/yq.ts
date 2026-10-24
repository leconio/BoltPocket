/*
 * yq format handling follows just-bash 3.2.0. Query evaluation is delegated to
 * the already-registered bounded jq command via argv-safe ctx.exec.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { byteLength, stdinText } from "./bytes.ts";
import { assertByteLimit, assertNotAborted } from "./limits.ts";
import type {
  ExtraCommandContext,
  ExtraCommandResult,
  ProjectShellExtraCommand,
  ProjectShellExtraLimits,
} from "./types.ts";
import {
  detectStructuredFormat,
  extractFrontMatter,
  formatStructuredOutput,
  isStructuredFormat,
  parseStructuredInput,
  parseYamlDocuments,
  type StructuredFormat,
  type YqFormatOptions,
} from "./yq-formats.ts";

type YqOptions = YqFormatOptions & {
  exitStatus: boolean;
  slurp: boolean;
  nullInput: boolean;
  joinOutput: boolean;
  inplace: boolean;
  frontMatter: boolean;
  inputFormatExplicit: boolean;
  outputFormatExplicit: boolean;
  filter: string;
  files: string[];
};

const YQ_HELP = `Usage: yq [OPTIONS] [FILTER] [FILE]
Process YAML, JSON, XML, INI, CSV, or TOML with the registered jq engine.

  -p, --input-format FMT     yaml|json|xml|ini|csv|toml
  -o, --output-format FMT    yaml|json|xml|ini|csv|toml
  -i, --inplace              stage the result over one input file
  -r, --raw-output           output JSON strings without quotes
  -c, --compact              compact JSON output
  -e, --exit-status          fail for no/null/false results
  -s, --slurp                evaluate all YAML documents as an array
  -n, --null-input           evaluate against null
  -j, --join-output          omit separators and final newline
  -f, --front-matter         evaluate front matter only
  -I, --indent N             output indentation, 0..32
`;

export function createYqCommand(
  limits: ProjectShellExtraLimits,
): ProjectShellExtraCommand {
  return {
    name: "yq",
    trusted: false,
    async execute(args, context) {
      if (args.includes("--help")) return success(YQ_HELP);
      const parsed = parseYqArgs(args);
      if ("error" in parsed) return failure(parsed.error, 2);
      try {
        return await executeYq(parsed, context, limits);
      } catch (error) {
        if (context.signal?.aborted) return failure("yq: interrupted", 130);
        return failure(`yq: ${safeError(error)}`, 5);
      }
    },
  };
}

function parseYqArgs(args: readonly string[]): YqOptions | { error: string } {
  const options: YqOptions = {
    inputFormat: "yaml",
    outputFormat: "yaml",
    raw: false,
    compact: false,
    pretty: false,
    indent: 2,
    xmlAttributePrefix: "+@",
    xmlContentName: "+content",
    csvDelimiter: "",
    csvHeader: true,
    exitStatus: false,
    slurp: false,
    nullInput: false,
    joinOutput: false,
    inplace: false,
    frontMatter: false,
    inputFormatExplicit: false,
    outputFormatExplicit: false,
    filter: ".",
    files: [],
  };
  let filterSet = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    const nextValue = (): string | undefined => args[++index];
    if (argument === "-p" || argument === "--input-format") {
      const value = nextValue();
      if (!isStructuredFormat(value))
        return { error: `yq: invalid input format '${value ?? ""}'` };
      options.inputFormat = value;
      options.inputFormatExplicit = true;
    } else if (argument.startsWith("--input-format=")) {
      const value = argument.slice(15);
      if (!isStructuredFormat(value))
        return { error: `yq: invalid input format '${value}'` };
      options.inputFormat = value;
      options.inputFormatExplicit = true;
    } else if (argument === "-o" || argument === "--output-format") {
      const value = nextValue();
      if (!isStructuredFormat(value))
        return { error: `yq: invalid output format '${value ?? ""}'` };
      options.outputFormat = value;
      options.outputFormatExplicit = true;
    } else if (argument.startsWith("--output-format=")) {
      const value = argument.slice(16);
      if (!isStructuredFormat(value))
        return { error: `yq: invalid output format '${value}'` };
      options.outputFormat = value;
      options.outputFormatExplicit = true;
    } else if (argument === "-I" || argument === "--indent") {
      const value = nextValue();
      if (!value || !/^\d+$/.test(value) || Number(value) > 32) {
        return {
          error: `yq: invalid indent '${value ?? ""}' (expected integer 0..32)`,
        };
      }
      options.indent = Number(value);
    } else if (argument.startsWith("--indent=")) {
      const value = argument.slice(9);
      if (!/^\d+$/.test(value) || Number(value) > 32) {
        return {
          error: `yq: invalid indent '${value}' (expected integer 0..32)`,
        };
      }
      options.indent = Number(value);
    } else if (argument.startsWith("--xml-attribute-prefix=")) {
      options.xmlAttributePrefix = argument.slice(23);
    } else if (argument.startsWith("--xml-content-name=")) {
      options.xmlContentName = argument.slice(19);
    } else if (argument.startsWith("--csv-delimiter=")) {
      const delimiter = argument.slice(16);
      if ([...delimiter].length !== 1)
        return { error: "yq: CSV delimiter must be one character" };
      options.csvDelimiter = delimiter;
    } else if (argument === "--csv-header") options.csvHeader = true;
    else if (argument === "--no-csv-header") options.csvHeader = false;
    else if (argument === "-r" || argument === "--raw-output")
      options.raw = true;
    else if (argument === "-c" || argument === "--compact")
      options.compact = true;
    else if (argument === "-e" || argument === "--exit-status")
      options.exitStatus = true;
    else if (argument === "-s" || argument === "--slurp") options.slurp = true;
    else if (argument === "-n" || argument === "--null-input")
      options.nullInput = true;
    else if (argument === "-j" || argument === "--join-output")
      options.joinOutput = true;
    else if (argument === "-i" || argument === "--inplace")
      options.inplace = true;
    else if (argument === "-f" || argument === "--front-matter")
      options.frontMatter = true;
    else if (argument === "-P" || argument === "--prettyPrint")
      options.pretty = true;
    else if (argument === "-") options.files.push(argument);
    else if (argument.startsWith("--"))
      return { error: `yq: unknown option '${argument}'` };
    else if (argument.startsWith("-")) {
      for (const flag of argument.slice(1)) {
        if (flag === "r") options.raw = true;
        else if (flag === "c") options.compact = true;
        else if (flag === "e") options.exitStatus = true;
        else if (flag === "s") options.slurp = true;
        else if (flag === "n") options.nullInput = true;
        else if (flag === "j") options.joinOutput = true;
        else if (flag === "i") options.inplace = true;
        else if (flag === "f") options.frontMatter = true;
        else if (flag === "P") options.pretty = true;
        else return { error: `yq: unknown option '-${flag}'` };
      }
    } else if (!filterSet) {
      options.filter = argument;
      filterSet = true;
    } else options.files.push(argument);
  }
  if (options.files.length > 1)
    return { error: "yq: this mobile command accepts at most one file" };
  if (
    options.inplace &&
    (options.files.length !== 1 || options.files[0] === "-")
  ) {
    return { error: "yq: -i/--inplace requires one file argument" };
  }
  return options;
}

async function executeYq(
  options: YqOptions,
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  assertNotAborted(context.signal);
  if (options.filter.length > 4_096)
    throw new Error("query expression limit exceeded (4096)");
  assertByteLimit(
    "yq query expression",
    byteLength(options.filter),
    limits.maxCellBytes,
  );
  const file = options.files[0];
  if (!options.inputFormatExplicit && file && file !== "-") {
    options.inputFormat = detectStructuredFormat(file) ?? options.inputFormat;
  }
  if (options.inplace && !options.outputFormatExplicit)
    options.outputFormat = options.inputFormat;

  let input = "";
  let filePath: string | null = null;
  if (!options.nullInput) {
    if (!file || file === "-")
      input = stdinText(context.stdin, limits.maxInputBytes);
    else {
      filePath = context.fs.resolvePath(context.cwd, file);
      try {
        input = await context.fs.readFile(filePath);
      } catch {
        return failure(`yq: ${file}: No such file or directory`, 2);
      }
      assertByteLimit("yq input", byteLength(input), limits.maxInputBytes);
    }
  }

  let value: unknown;
  if (options.nullInput) value = null;
  else if (options.frontMatter) {
    value = extractFrontMatter(input, limits);
    if (value === null) return failure("yq: no front-matter found", 1);
  } else if (options.slurp) {
    value =
      options.inputFormat === "yaml"
        ? parseYamlDocuments(input, limits)
        : [parseStructuredInput(input, options, limits)];
  } else value = parseStructuredInput(input, options, limits);

  const evaluated = await evaluateWithJq(
    value,
    options.filter,
    context,
    limits,
  );
  if ("error" in evaluated) return evaluated.error;
  const separator = options.joinOutput ? "" : "\n";
  const chunks: string[] = [];
  let outputBytes = 0;
  for (const result of evaluated.values) {
    assertNotAborted(context.signal);
    const separatorBytes = chunks.length ? byteLength(separator) : 0;
    const finalNewlineBytes = options.joinOutput ? 0 : 1;
    const remaining =
      limits.maxOutputBytes - outputBytes - separatorBytes - finalNewlineBytes;
    if (remaining <= 0) throw new Error("yq output: byte limit exceeded");
    const formatted = formatStructuredOutput(result, options, {
      ...limits,
      maxOutputBytes: remaining,
    });
    if (!formatted) continue;
    outputBytes += byteLength(formatted) + separatorBytes;
    assertByteLimit(
      "yq output",
      outputBytes + (options.joinOutput ? 0 : 1),
      limits.maxOutputBytes,
    );
    chunks.push(formatted);
  }
  const output =
    chunks.join(separator) + (chunks.length && !options.joinOutput ? "\n" : "");
  if (options.inplace && filePath) {
    await context.fs.writeFile(filePath, output);
    return success("");
  }
  const exitCode =
    options.exitStatus &&
    (evaluated.values.length === 0 ||
      evaluated.values.every(
        (item) => item === null || item === false || item === undefined,
      ))
      ? 1
      : 0;
  return { stdout: output, stderr: "", exitCode };
}

async function evaluateWithJq(
  value: unknown,
  filter: string,
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<{ values: unknown[] } | { error: ExtraCommandResult }> {
  if (!context.exec) {
    const fallback = evaluateSimplePath(value, filter);
    return "error" in fallback
      ? { error: failure(`yq: ${fallback.error}`, 3) }
      : { values: fallback.values };
  }
  const input = JSON.stringify(value);
  assertByteLimit("yq query input", byteLength(input), limits.maxInputBytes);
  const result = await context.exec("jq", {
    cwd: context.cwd,
    stdin: input,
    stdinKind: "text",
    signal: context.signal,
    args: ["-c", filter],
  });
  if (result.exitCode !== 0) {
    return {
      error: {
        stdout: "",
        stderr: result.stderr || "yq: jq query failed\n",
        exitCode: result.exitCode,
      },
    };
  }
  assertByteLimit(
    "yq query output",
    byteLength(result.stdout),
    limits.maxOutputBytes,
  );
  const values: unknown[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    values.push(JSON.parse(line));
    if (values.length > limits.maxStructuredNodes)
      throw new Error("too many query results");
  }
  return { values };
}

function evaluateSimplePath(
  value: unknown,
  filter: string,
): { values: unknown[] } | { error: string } {
  if (filter === ".") return { values: [value] };
  if (
    !/^\.(?:[A-Za-z_][\w-]*|\[\d+\])(?:\.[A-Za-z_][\w-]*|\[\d+\])*$/.test(
      filter,
    )
  ) {
    return { error: "the jq command capability is required for this filter" };
  }
  let current = value;
  const tokens = filter.slice(1).match(/[A-Za-z_][\w-]*|\[\d+\]/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("[")) {
      const index = Number(token.slice(1, -1));
      current = Array.isArray(current) ? current[index] : undefined;
    } else {
      current =
        current !== null && typeof current === "object"
          ? (current as Record<string, unknown>)[token]
          : undefined;
    }
  }
  return { values: current === undefined ? [] : [current] };
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\0]/g, " ")
    .slice(0, 512);
}

function success(stdout: string): ExtraCommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function failure(message: string, exitCode: number): ExtraCommandResult {
  return { stdout: "", stderr: `${message.replace(/\n+$/, "")}\n`, exitCode };
}

export const YQ_FORMATS: readonly StructuredFormat[] = [
  "yaml",
  "json",
  "xml",
  "ini",
  "csv",
  "toml",
];
