export class SshCommandPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshCommandPathError";
  }
}

function invalidPath(message: string): never {
  throw new SshCommandPathError(message);
}

export function normalizeRemotePath(value: string): string {
  if (!value.startsWith("/")) {
    invalidPath("SSH start directory and paths must be absolute.");
  }
  if (value.includes("\0") || value.includes("\\")) {
    invalidPath("SSH path contains unsupported characters.");
  }

  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      // Match POSIX path resolution: `..` at `/` remains `/`. Authorization
      // belongs to the remote SSH account, not an app-defined directory scope.
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

export function normalizeRemoteRoot(value: string): string {
  return normalizeRemotePath(value);
}

export function requireRemotePath(root: string, candidate: string): string {
  normalizeRemoteRoot(root);
  return normalizeRemotePath(candidate);
}

export function joinRemotePath(root: string, child: string): string {
  if (child.startsWith("/")) return requireRemotePath(root, child);
  return normalizeRemotePath(`${normalizeRemoteRoot(root)}/${child}`);
}

export function normalizeSshCommandAlias(alias: string) {
  const normalized = alias.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(normalized)) {
    throw new Error(
      "SSH 命令别名必须为 1–32 个小写字母、数字、点、下划线或连字符。",
    );
  }
  return normalized;
}
