/*
 * Bounded USTAR command adapted from the tar command contract in just-bash
 * 3.2.0. It deliberately excludes platform codecs and special files.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Gunzip, gzipSync } from "fflate";

import { bytesToLatin1, stdinBytes } from "./bytes.ts";
import { assertByteLimit, assertNotAborted } from "./limits.ts";
import type {
  ExtraCommandContext,
  ExtraCommandResult,
  ProjectShellExtraCommand,
  ProjectShellExtraLimits,
} from "./types.ts";

const BLOCK_SIZE = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type TarMode = "create" | "extract" | "list";

type TarOptions = {
  mode: TarMode;
  file: string;
  gzip: boolean;
  autoCompress: boolean;
  verbose: boolean;
  toStdout: boolean;
  keepOldFiles: boolean;
  directory: string | null;
  stripComponents: number;
  excludes: string[];
  operands: string[];
  globBudget: { remaining: number };
};

type TarEntry = {
  name: string;
  type: "file" | "directory" | "symlink" | "unsupported";
  mode: number;
  size: number;
  data: Uint8Array;
};

type CreateEntry = {
  name: string;
  type: "file" | "directory";
  mode: number;
  data: Uint8Array;
};

type CreateBudget = {
  traversed: number;
  bytes: number;
};

export function createTarCommand(
  limits: ProjectShellExtraLimits,
): ProjectShellExtraCommand {
  return {
    name: "tar",
    trusted: false,
    async execute(args, context) {
      try {
        if (args.includes("--help")) return textResult(TAR_HELP);
        const parsed = parseTarArgs(args);
        if ("error" in parsed) return failure(parsed.error, 2);
        if (parsed.mode === "create")
          return await createArchive(parsed, context, limits);
        return await readArchive(parsed, context, limits);
      } catch (error) {
        if (context.signal?.aborted) return failure("tar: interrupted", 130);
        return failure(`tar: ${safeError(error)}`, 2);
      }
    },
  };
}

const TAR_HELP = `Usage: tar -c|-t|-x [-z] -f ARCHIVE [FILE...]
Create, list, or extract a bounded USTAR archive in the project filesystem.

  -c, --create                 create an archive
  -t, --list                   list an archive
  -x, --extract               extract an archive
  -f, --file ARCHIVE          archive path (or - for stdin/stdout)
  -z, --gzip                  gzip compression
  -a, --auto-compress         infer gzip from .gz/.tgz
  -C, --directory DIR         change source/destination directory
  -v, --verbose               list processed members
  -O, --to-stdout             write extracted file bytes to stdout
  -k, --keep-old-files        refuse to replace existing paths
      --strip-components=N    remove N leading member components
      --exclude=PATTERN       omit matching members (* and ?)

bzip2, xz, zstd, links, devices, PAX, and GNU sparse extensions are rejected.
`;

function parseTarArgs(rawArgs: string[]): TarOptions | { error: string } {
  const args = expandOldStyle(rawArgs);
  const modes: TarMode[] = [];
  let file = "";
  let gzip = false;
  let autoCompress = false;
  let verbose = false;
  let toStdout = false;
  let keepOldFiles = false;
  let directory: string | null = null;
  let stripComponents = 0;
  const excludes: string[] = [];
  const operands: string[] = [];
  let optionsEnded = false;

  const takeValue = (
    index: number,
    label: string,
  ): [string, number] | { error: string } => {
    const value = args[index + 1];
    return value === undefined
      ? { error: `tar: option '${label}' requires an argument` }
      : [value, index + 1];
  };

  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    if (optionsEnded || argument === "-" || !argument.startsWith("-")) {
      operands.push(argument);
      continue;
    }
    if (argument === "--") {
      optionsEnded = true;
      continue;
    }
    if (argument === "-c" || argument === "--create") modes.push("create");
    else if (argument === "-t" || argument === "--list") modes.push("list");
    else if (
      argument === "-x" ||
      argument === "--extract" ||
      argument === "--get"
    ) {
      modes.push("extract");
    } else if (
      argument === "-z" ||
      argument === "--gzip" ||
      argument === "--gunzip"
    ) {
      gzip = true;
    } else if (argument === "-a" || argument === "--auto-compress")
      autoCompress = true;
    else if (argument === "-v" || argument === "--verbose") verbose = true;
    else if (argument === "-O" || argument === "--to-stdout") toStdout = true;
    else if (argument === "-k" || argument === "--keep-old-files")
      keepOldFiles = true;
    else if (argument === "-f" || argument === "--file") {
      const next = takeValue(index, argument);
      if ("error" in next) return next;
      [file, index] = next;
    } else if (argument.startsWith("--file=")) file = argument.slice(7);
    else if (argument === "-C" || argument === "--directory") {
      const next = takeValue(index, argument);
      if ("error" in next) return next;
      [directory, index] = next;
    } else if (argument.startsWith("--directory="))
      directory = argument.slice(12);
    else if (argument.startsWith("--strip-components=")) {
      const raw = argument.slice(19);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        return { error: `tar: invalid --strip-components value '${raw}'` };
      }
      stripComponents = Number(raw);
    } else if (argument === "--strip-components") {
      const next = takeValue(index, argument);
      if ("error" in next) return next;
      const [raw, nextIndex] = next;
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        return { error: `tar: invalid --strip-components value '${raw}'` };
      }
      stripComponents = Number(raw);
      index = nextIndex;
    } else if (argument === "--exclude") {
      const next = takeValue(index, argument);
      if ("error" in next) return next;
      const [value, nextIndex] = next;
      excludes.push(value);
      index = nextIndex;
    } else if (argument.startsWith("--exclude="))
      excludes.push(argument.slice(10));
    else if (
      argument === "-j" ||
      argument === "--bzip2" ||
      argument === "-J" ||
      argument === "--xz" ||
      argument === "--zstd"
    ) {
      return {
        error: `tar: compression option '${argument}' is unavailable on mobile`,
      };
    } else if (
      argument.startsWith("-") &&
      !argument.startsWith("--") &&
      argument.length > 2
    ) {
      const expanded = expandShortBundle(argument);
      if ("error" in expanded) return expanded;
      args.splice(index, 1, ...expanded);
      index--;
    } else return { error: `tar: unrecognized option '${argument}'` };
  }

  if (new Set(modes).size !== 1 || modes.length !== 1) {
    return { error: "tar: exactly one of -c, -t, or -x is required" };
  }
  if (!file) return { error: "tar: -f ARCHIVE is required" };
  if (modes[0] === "create" && operands.length === 0) {
    return { error: "tar: refusing to create an empty archive" };
  }
  if (modes[0] === "create" && toStdout) {
    return { error: "tar: -O is only valid while extracting" };
  }
  if (
    excludes.length > 64 ||
    excludes.some((pattern) => pattern.length > 1_024) ||
    excludes.reduce((sum, pattern) => sum + pattern.length, 0) > 4_096
  ) {
    return { error: "tar: exclude pattern limit exceeded" };
  }
  if (
    operands.length > 256 ||
    operands.reduce((sum, operand) => sum + operand.length, 0) > 16_384
  ) {
    return { error: "tar: operand limit exceeded" };
  }
  return {
    mode: modes[0]!,
    file,
    gzip,
    autoCompress,
    verbose,
    toStdout,
    keepOldFiles,
    directory,
    stripComponents,
    excludes,
    operands,
    globBudget: { remaining: 5_000_000 },
  };
}

function expandOldStyle(args: string[]): string[] {
  const first = args[0];
  if (!first || first.startsWith("-") || !/^[ctxzavOkfC]+$/.test(first))
    return [...args];
  const expanded = expandShortBundle(`-${first}`);
  return "error" in expanded ? [...args] : [...expanded, ...args.slice(1)];
}

function expandShortBundle(bundle: string): string[] | { error: string } {
  const result: string[] = [];
  const letters = bundle.slice(1);
  for (let index = 0; index < letters.length; index++) {
    const letter = letters[index] ?? "";
    if ("ctxzavOk".includes(letter)) result.push(`-${letter}`);
    else if (letter === "f" || letter === "C") {
      result.push(`-${letter}`);
      const attached = letters.slice(index + 1);
      if (attached) result.push(attached);
      return result;
    } else return { error: `tar: unrecognized option '-${letter}'` };
  }
  return result;
}

async function createArchive(
  options: TarOptions,
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  assertNotAborted(context.signal);
  const base = options.directory
    ? context.fs.resolvePath(context.cwd, options.directory)
    : context.cwd;
  const entries: CreateEntry[] = [];
  const seen = new Set<string>();
  const budget: CreateBudget = { traversed: 0, bytes: 0 };

  for (const operand of options.operands) {
    if (!operand || operand.includes("\0"))
      throw new Error("invalid source path");
    const source = context.fs.resolvePath(base, operand);
    const member = normalizeCreateName(operand);
    await collectCreateEntries(
      source,
      member,
      options,
      context,
      limits,
      entries,
      seen,
      budget,
    );
  }

  entries.sort((left, right) => compareText(left.name, right.name));
  const raw = encodeTar(entries, limits);
  const useGzip =
    options.gzip || (options.autoCompress && isGzipName(options.file));
  const archive = useGzip ? gzipSync(raw, { level: 6, mtime: 0 }) : raw;
  assertByteLimit("tar archive", archive.byteLength, limits.maxArchiveBytes);
  assertNotAborted(context.signal);

  const verbose = options.verbose
    ? `${entries.map((entry) => entry.name).join("\n")}\n`
    : "";
  assertByteLimit(
    "tar output",
    encoder.encode(verbose).byteLength,
    limits.maxOutputBytes,
  );
  if (options.file === "-") {
    return {
      stdout: bytesToLatin1(archive, limits.maxOutputBytes),
      stderr: verbose,
      exitCode: 0,
      stdoutKind: "bytes",
      stdoutEncoding: "binary",
    };
  }
  const archivePath = context.fs.resolvePath(context.cwd, options.file);
  await context.fs.writeFile(archivePath, archive);
  return { stdout: verbose, stderr: "", exitCode: 0 };
}

async function collectCreateEntries(
  source: string,
  member: string,
  options: TarOptions,
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
  entries: CreateEntry[],
  seen: Set<string>,
  budget: CreateBudget,
): Promise<void> {
  assertNotAborted(context.signal);
  budget.traversed++;
  if (budget.traversed > limits.maxTraversalEntries) {
    throw new Error(
      `project traversal limit exceeded (${limits.maxTraversalEntries})`,
    );
  }
  if (entries.length >= limits.maxArchiveEntries) {
    throw new Error(
      `archive entry limit exceeded (${limits.maxArchiveEntries})`,
    );
  }
  const safeName = validateMemberName(member, limits);
  if (matchesAny(safeName, options.excludes, options.globBudget)) return;
  const stat = await context.fs.lstat(source);
  if (stat.isSymbolicLink)
    throw new Error(`symbolic links are unsupported: ${safeName}`);
  if (!stat.isFile && !stat.isDirectory)
    throw new Error(`special file is unsupported: ${safeName}`);

  const entryName =
    stat.isDirectory && safeName !== "." ? `${safeName}/` : safeName;
  if (!seen.has(entryName)) {
    seen.add(entryName);
    const data = stat.isFile
      ? await context.fs.readFileBuffer(source)
      : new Uint8Array();
    budget.bytes += data.byteLength;
    assertByteLimit("tar input", budget.bytes, limits.maxExtractedBytes);
    entries.push({
      name: entryName,
      type: stat.isDirectory ? "directory" : "file",
      mode: stat.mode & 0o777,
      data,
    });
  }

  if (!stat.isDirectory) return;
  const children = (await context.fs.readdir(source)).sort(compareText);
  for (const child of children) {
    if (child === "." || child === ".." || child.includes("/")) {
      throw new Error(`invalid directory entry '${child}'`);
    }
    const childSource = context.fs.resolvePath(source, child);
    const childMember = safeName === "." ? child : `${safeName}/${child}`;
    await collectCreateEntries(
      childSource,
      childMember,
      options,
      context,
      limits,
      entries,
      seen,
      budget,
    );
  }
}

function encodeTar(
  entries: readonly CreateEntry[],
  limits: ProjectShellExtraLimits,
): Uint8Array {
  let length = BLOCK_SIZE * 2;
  for (const entry of entries) {
    length +=
      BLOCK_SIZE + Math.ceil(entry.data.byteLength / BLOCK_SIZE) * BLOCK_SIZE;
    assertByteLimit("tar archive", length, limits.maxArchiveBytes);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const entry of entries) {
    const header = output.subarray(offset, offset + BLOCK_SIZE);
    writeTarName(header, entry.name);
    writeOctal(
      header,
      100,
      8,
      entry.mode || (entry.type === "directory" ? 0o755 : 0o644),
    );
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, entry.data.byteLength);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = entry.type === "directory" ? 0x35 : 0x30;
    writeAscii(header, 257, 6, "ustar\0");
    writeAscii(header, 263, 2, "00");
    writeAscii(header, 265, 32, "boltpocket");
    writeAscii(header, 297, 32, "boltpocket");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    const checksumText = checksum.toString(8).padStart(6, "0");
    writeAscii(header, 148, 8, `${checksumText}\0 `);
    offset += BLOCK_SIZE;
    output.set(entry.data, offset);
    offset += Math.ceil(entry.data.byteLength / BLOCK_SIZE) * BLOCK_SIZE;
  }
  return output;
}

async function readArchive(
  options: TarOptions,
  context: ExtraCommandContext,
  limits: ProjectShellExtraLimits,
): Promise<ExtraCommandResult> {
  const compressed =
    options.file === "-"
      ? stdinBytes(context.stdin, limits.maxArchiveBytes)
      : await context.fs.readFileBuffer(
          context.fs.resolvePath(context.cwd, options.file),
        );
  assertByteLimit("tar archive", compressed.byteLength, limits.maxArchiveBytes);
  assertNotAborted(context.signal);
  const gzip =
    options.gzip ||
    isGzipMagic(compressed) ||
    (options.autoCompress && isGzipName(options.file));
  const maximumTarBytes =
    limits.maxExtractedBytes +
    limits.maxArchiveEntries * BLOCK_SIZE +
    BLOCK_SIZE * 2;
  const raw = gzip
    ? boundedGunzip(compressed, maximumTarBytes, context.signal)
    : compressed;
  const entries = parseTar(raw, limits);
  const selected = selectEntries(entries, options, limits);

  if (options.mode === "list") {
    const stdout =
      selected.map((entry) => entry.name).join("\n") +
      (selected.length ? "\n" : "");
    assertByteLimit(
      "tar output",
      encoder.encode(stdout).byteLength,
      limits.maxOutputBytes,
    );
    return { stdout, stderr: "", exitCode: 0 };
  }

  if (options.toStdout) {
    const files = selected.filter((entry) => entry.type === "file");
    const total = files.reduce((sum, entry) => sum + entry.data.byteLength, 0);
    assertByteLimit("tar output", total, limits.maxOutputBytes);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const entry of files) {
      output.set(entry.data, offset);
      offset += entry.data.byteLength;
    }
    return {
      stdout: bytesToLatin1(output, limits.maxOutputBytes),
      stderr: "",
      exitCode: 0,
      stdoutKind: "bytes",
      stdoutEncoding: "binary",
    };
  }

  const destination = options.directory
    ? context.fs.resolvePath(context.cwd, options.directory)
    : context.cwd;
  validateArchiveHierarchy(selected);
  const planned = selected.map((entry) => ({
    entry,
    target: context.fs.resolvePath(
      destination,
      entry.name === "." ? "." : entry.name,
    ),
  }));
  for (const { entry, target } of planned) {
    assertNotAborted(context.signal);
    if (entry.type === "symlink" || entry.type === "unsupported") {
      throw new Error(`unsupported archive member type: ${entry.name}`);
    }
    if (options.keepOldFiles && (await context.fs.exists(target))) {
      throw new Error(`${entry.name}: file exists`);
    }
    await validateExtractionTarget(destination, target, entry.type, context);
  }

  const directories = planned
    .filter(({ entry }) => entry.type === "directory")
    .sort(
      (left, right) => pathDepth(left.entry.name) - pathDepth(right.entry.name),
    );
  for (const { target } of directories) {
    if (!(await context.fs.exists(target)))
      await context.fs.mkdir(target, { recursive: true });
  }
  for (const { entry, target } of planned) {
    if (entry.type !== "file") continue;
    const parent = target.slice(0, Math.max(1, target.lastIndexOf("/")));
    if (!(await context.fs.exists(parent)))
      await context.fs.mkdir(parent, { recursive: true });
    await context.fs.writeFile(target, entry.data);
  }
  const stdout = options.verbose
    ? planned.map(({ entry }) => entry.name).join("\n") +
      (planned.length ? "\n" : "")
    : "";
  assertByteLimit(
    "tar output",
    encoder.encode(stdout).byteLength,
    limits.maxOutputBytes,
  );
  return { stdout, stderr: "", exitCode: 0 };
}

function boundedGunzip(
  input: Uint8Array,
  maximum: number,
  signal: AbortSignal | undefined,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const gunzip = new Gunzip((chunk) => {
    total += chunk.byteLength;
    if (total > maximum) {
      throw new Error(`expanded archive limit exceeded (${maximum})`);
    }
    chunks.push(chunk.slice());
  });
  // A small feed bounds the largest transient inflation chunk before the
  // callback can reject a high-ratio compression bomb.
  const inputChunkSize = 1024;
  for (let offset = 0; offset < input.length; offset += inputChunkSize) {
    assertNotAborted(signal);
    const end = Math.min(offset + inputChunkSize, input.length);
    gunzip.push(input.subarray(offset, end), end === input.length);
  }
  const result = new Uint8Array(total);
  let outputOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }
  return result;
}

function parseTar(
  raw: Uint8Array,
  limits: ProjectShellExtraLimits,
): TarEntry[] {
  const entries: TarEntry[] = [];
  const names = new Set<string>();
  let totalExtracted = 0;
  let offset = 0;
  while (offset + BLOCK_SIZE <= raw.byteLength) {
    const header = raw.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break;
    if (entries.length >= limits.maxArchiveEntries) {
      throw new Error(
        `archive entry limit exceeded (${limits.maxArchiveEntries})`,
      );
    }
    verifyChecksum(header);
    const namePart = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const name = validateMemberName(
      prefix ? `${prefix}/${namePart}` : namePart,
      limits,
    );
    if (names.has(name)) throw new Error(`duplicate archive member '${name}'`);
    names.add(name);
    const size = readOctal(header, 124, 12, "size");
    totalExtracted += size;
    assertByteLimit(
      "tar extracted data",
      totalExtracted,
      limits.maxExtractedBytes,
    );
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > raw.byteLength)
      throw new Error(`truncated archive member '${name}'`);
    const typeFlag = header[156] ?? 0;
    const type =
      typeFlag === 0 || typeFlag === 0x30
        ? "file"
        : typeFlag === 0x35
          ? "directory"
          : typeFlag === 0x32
            ? "symlink"
            : "unsupported";
    if (type === "symlink" || type === "unsupported") {
      throw new Error(`unsupported archive member type for '${name}'`);
    }
    entries.push({
      name: type === "directory" ? name.replace(/\/$/, "") || "." : name,
      type,
      mode: readOctal(header, 100, 8, "mode"),
      size,
      data: raw.slice(dataStart, dataEnd),
    });
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }
  if (offset > raw.byteLength) throw new Error("truncated archive");
  return entries;
}

function selectEntries(
  entries: readonly TarEntry[],
  options: TarOptions,
  limits: ProjectShellExtraLimits,
): TarEntry[] {
  const selected: TarEntry[] = [];
  const seen = new Set<string>();
  const requested = options.operands.map((operand) =>
    validateMemberName(normalizeCreateName(operand).replace(/\/$/, ""), limits),
  );
  for (const entry of entries) {
    if (matchesAny(entry.name, options.excludes, options.globBudget)) continue;
    if (
      requested.length > 0 &&
      !requested.some((normalized) => {
        return (
          entry.name === normalized || entry.name.startsWith(`${normalized}/`)
        );
      })
    ) {
      continue;
    }
    const parts =
      entry.name === "." ? [] : entry.name.split("/").filter(Boolean);
    if (parts.length <= options.stripComponents) continue;
    const name = validateMemberName(
      parts.slice(options.stripComponents).join("/"),
      limits,
    );
    if (seen.has(name))
      throw new Error(`multiple members resolve to '${name}'`);
    seen.add(name);
    selected.push({ ...entry, name });
  }
  return selected;
}

function validateArchiveHierarchy(entries: readonly TarEntry[]): void {
  const types = new Map(
    entries.map((entry) => [entry.name, entry.type] as const),
  );
  for (const entry of entries) {
    const parts = entry.name.split("/");
    for (let end = 1; end < parts.length; end++) {
      const parent = parts.slice(0, end).join("/");
      const parentType = types.get(parent);
      if (parentType && parentType !== "directory") {
        throw new Error(
          `archive member '${entry.name}' is nested below non-directory '${parent}'`,
        );
      }
    }
  }
}

async function validateExtractionTarget(
  destination: string,
  target: string,
  memberType: TarEntry["type"],
  context: ExtraCommandContext,
): Promise<void> {
  const root = lexicalAbsolute(destination);
  const absolute = lexicalAbsolute(target);
  if (root !== "/" && absolute !== root && !absolute.startsWith(`${root}/`)) {
    throw new Error(`archive target escapes destination: '${absolute}'`);
  }
  const parts = absolute.split("/").filter(Boolean);
  let current = "";
  for (let index = 0; index < parts.length; index++) {
    current += `/${parts[index] ?? ""}`;
    if (!(await context.fs.exists(current))) continue;
    const stat = await context.fs.lstat(current);
    if (stat.isSymbolicLink)
      throw new Error(`refusing to traverse symbolic link '${current}'`);
    const isLeaf = index === parts.length - 1;
    if (!isLeaf && !stat.isDirectory)
      throw new Error(`non-directory extraction parent '${current}'`);
    if (isLeaf && memberType === "directory" && !stat.isDirectory) {
      throw new Error(`directory member conflicts with '${current}'`);
    }
    if (isLeaf && memberType === "file" && stat.isDirectory) {
      throw new Error(`file member conflicts with directory '${current}'`);
    }
  }
}

function lexicalAbsolute(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function validateMemberName(
  input: string,
  limits: ProjectShellExtraLimits,
): string {
  if (!input || input.includes("\0") || input.startsWith("/")) {
    throw new Error(`unsafe archive path '${cleanMessage(input)}'`);
  }
  const rawParts = input.replace(/\\/g, "/").split("/");
  const parts: string[] = [];
  for (const part of rawParts) {
    if (!part || part === ".") continue;
    if (part === "..")
      throw new Error(`unsafe archive path '${cleanMessage(input)}'`);
    parts.push(part);
  }
  if (parts.length > limits.maxPathDepth) {
    throw new Error(
      `archive path depth limit exceeded (${limits.maxPathDepth})`,
    );
  }
  const result = parts.join("/") || ".";
  assertByteLimit("archive path", encoder.encode(result).byteLength, 255);
  return result;
}

function normalizeCreateName(input: string): string {
  const normalized = input
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  return normalized || ".";
}

function writeTarName(header: Uint8Array, name: string): void {
  const bytes = encoder.encode(name);
  if (bytes.byteLength <= 100) {
    header.set(bytes, 0);
    return;
  }
  const slashIndexes: number[] = [];
  for (let index = 0; index < name.length; index++)
    if (name[index] === "/") slashIndexes.push(index);
  for (let index = slashIndexes.length - 1; index >= 0; index--) {
    const split = slashIndexes[index] ?? 0;
    const prefix = encoder.encode(name.slice(0, split));
    const suffix = encoder.encode(name.slice(split + 1));
    if (prefix.byteLength <= 155 && suffix.byteLength <= 100) {
      header.set(suffix, 0);
      header.set(prefix, 345);
      return;
    }
  }
  throw new Error(`archive path cannot be represented in USTAR: '${name}'`);
}

function writeOctal(
  target: Uint8Array,
  offset: number,
  length: number,
  value: number,
): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid tar numeric field");
  const text = value.toString(8);
  if (text.length > length - 1) throw new Error("tar numeric field overflow");
  writeAscii(target, offset, length, `${text.padStart(length - 1, "0")}\0`);
}

function writeAscii(
  target: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  const bytes = encoder.encode(value);
  if (bytes.byteLength > length) throw new Error("tar header field overflow");
  target.set(bytes, offset);
}

function readString(
  source: Uint8Array,
  offset: number,
  length: number,
): string {
  const end = source.indexOf(0, offset);
  const actualEnd = end < 0 || end > offset + length ? offset + length : end;
  try {
    return decoder.decode(source.subarray(offset, actualEnd));
  } catch {
    throw new Error("tar header contains invalid UTF-8");
  }
}

function readOctal(
  source: Uint8Array,
  offset: number,
  length: number,
  field: string,
): number {
  if ((source[offset] ?? 0) & 0x80)
    throw new Error(`base-256 tar ${field} is unsupported`);
  const raw = readString(source, offset, length)
    .trim()
    .replace(/\0+$/, "")
    .trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error(`invalid tar ${field}`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`invalid tar ${field}`);
  return value;
}

function verifyChecksum(header: Uint8Array): void {
  const expected = readOctal(header, 148, 8, "checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index++) {
    actual += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  if (actual !== expected) throw new Error("archive header checksum mismatch");
}

function isGzipMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isGzipName(path: string): boolean {
  return /(?:\.tar\.gz|\.tgz|\.gz)$/i.test(path);
}

function matchesAny(
  value: string,
  patterns: readonly string[],
  budget: { remaining: number },
): boolean {
  return patterns.some((pattern) => globMatches(value, pattern, budget));
}

function globMatches(
  value: string,
  pattern: string,
  budget: { remaining: number },
): boolean {
  const work = (value.length + 1) * Math.max(1, pattern.length);
  budget.remaining -= work;
  if (budget.remaining < 0) throw new Error("tar exclude work limit exceeded");
  const previous = new Uint8Array(value.length + 1);
  previous[0] = 1;
  for (const character of pattern) {
    const current = new Uint8Array(value.length + 1);
    if (character === "*") current[0] = previous[0] ?? 0;
    for (let index = 1; index <= value.length; index++) {
      if (character === "*")
        current[index] = previous[index] || current[index - 1] ? 1 : 0;
      else if (character === "?" || character === value[index - 1])
        current[index] = previous[index - 1] ?? 0;
    }
    previous.set(current);
  }
  return previous[value.length] === 1;
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeError(error: unknown): string {
  return cleanMessage(error instanceof Error ? error.message : String(error));
}

function cleanMessage(value: string): string {
  return value.replace(/[\r\n\0]/g, " ").slice(0, 512);
}

function failure(message: string, exitCode: number): ExtraCommandResult {
  return { stdout: "", stderr: `${message.replace(/\n+$/, "")}\n`, exitCode };
}

function textResult(stdout: string): ExtraCommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}
