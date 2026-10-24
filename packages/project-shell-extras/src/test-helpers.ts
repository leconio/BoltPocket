// Shared in-memory fixtures for command contract tests.

import type {
  ExtraCommandContext,
  ExtraFileSystem,
  ExtraFsStat,
} from "./types.ts";

type Entry =
  | { type: "file"; data: Uint8Array }
  | { type: "directory" }
  | { type: "symlink"; target: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class FakeExtraFileSystem implements ExtraFileSystem {
  readonly entries = new Map<string, Entry>([["/", { type: "directory" }]]);

  constructor(files: Readonly<Record<string, string | Uint8Array>> = {}) {
    for (const [path, content] of Object.entries(files))
      this.seed(path, content);
  }

  seed(path: string, content: string | Uint8Array): void {
    const normalized = normalize(path);
    this.ensureParents(normalized);
    this.entries.set(normalized, {
      type: "file",
      data:
        typeof content === "string" ? encoder.encode(content) : content.slice(),
    });
  }

  seedSymlink(path: string, target: string): void {
    const normalized = normalize(path);
    this.ensureParents(normalized);
    this.entries.set(normalized, { type: "symlink", target });
  }

  async readFile(path: string): Promise<string> {
    return decoder.decode(await this.readFileBuffer(path));
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(normalize(path));
    if (!entry || entry.type !== "file") throw new Error("ENOENT");
    return entry.data.slice();
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.seed(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.entries.has(normalize(path));
  }

  async stat(path: string): Promise<ExtraFsStat> {
    return this.lstat(path);
  }

  async lstat(path: string): Promise<ExtraFsStat> {
    const entry = this.entries.get(normalize(path));
    if (!entry) throw new Error("ENOENT");
    return {
      isFile: entry.type === "file",
      isDirectory: entry.type === "directory",
      isSymbolicLink: entry.type === "symlink",
      mode: entry.type === "directory" ? 0o755 : 0o644,
      size:
        entry.type === "file"
          ? entry.data.byteLength
          : entry.type === "symlink"
            ? entry.target.length
            : 0,
      mtime: new Date(0),
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalize(path);
    if (options?.recursive) this.ensureParents(`${normalized}/child`);
    this.entries.set(normalized, { type: "directory" });
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry || entry.type !== "directory") throw new Error("ENOTDIR");
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    return [
      ...new Set(
        [...this.entries.keys()]
          .filter(
            (candidate) =>
              candidate.startsWith(prefix) && candidate !== normalized,
          )
          .map((candidate) => candidate.slice(prefix.length).split("/")[0])
          .filter((name): name is string => Boolean(name)),
      ),
    ];
  }

  resolvePath(base: string, path: string): string {
    return normalize(path.startsWith("/") ? path : `${base}/${path}`);
  }

  private ensureParents(path: string): void {
    const parts = normalize(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts.slice(0, -1)) {
      current += `/${part}`;
      this.entries.set(current, { type: "directory" });
    }
  }
}

export function testContext(
  fileSystem: FakeExtraFileSystem,
  stdin = "",
  overrides: Partial<ExtraCommandContext> = {},
): ExtraCommandContext {
  return {
    fs: fileSystem,
    cwd: "/project",
    env: new Map(),
    stdin: pipelineBytes(stdin),
    ...overrides,
  };
}

export function pipelineBytes(input: string): string {
  const bytes = encoder.encode(input);
  return String.fromCharCode(...bytes);
}

function normalize(input: string): string {
  const parts: string[] = [];
  for (const part of input.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}
