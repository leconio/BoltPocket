export type ProjectShellFileSystemErrorCode =
  "EACCES" | "EISDIR" | "EINVAL" | "ENOENT" | "ENOTDIR";

export class ProjectShellFileSystemError extends Error {
  readonly code: ProjectShellFileSystemErrorCode;
  readonly path: string;

  constructor(
    code: ProjectShellFileSystemErrorCode,
    path: string,
    message: string,
  ) {
    super(`${code}: ${message}: ${path}`);
    this.name = "ProjectShellFileSystemError";
    this.code = code;
    this.path = path;
  }
}
