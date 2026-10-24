import { ProjectShellFileSystemError } from "./errors.ts";

/**
 * POSIX path normalization adapted from just-bash's fs/path-utils.ts. This
 * deliberately rejects traversal above the injected project root.
 */
export function resolveProjectPath(cwd: string, input: string): string {
  if (input.includes("\0")) {
    throw new ProjectShellFileSystemError("EINVAL", input, "NUL in path");
  }

  const source = input.startsWith("/") ? input : `${cwd}/${input}`;
  const parts: string[] = [];
  for (const part of source.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new ProjectShellFileSystemError(
          "EACCES",
          input,
          "path escapes project root",
        );
      }
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}

export function parentProjectPath(path: string): string {
  if (path === "/") return "/";
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

export function baseProjectName(path: string): string {
  return path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
}

export function joinProjectPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}
