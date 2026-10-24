import type {
  BuiltInProjectResourceFile,
  BuiltInProjectResourcePack,
} from "@/domain/builtin-project-resources";

export type ProjectResourceExplorerEntry =
  | Readonly<{ kind: "directory"; name: string; path: string }>
  | Readonly<{
      kind: "file";
      name: string;
      path: string;
      fileIndex: number;
      file: BuiltInProjectResourceFile;
    }>;

function normalizedDirectory(directory: string) {
  return directory.split("/").filter(Boolean).join("/");
}

export function parentProjectResourceDirectory(directory: string) {
  const normalized = normalizedDirectory(directory);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

export function listProjectResourceDirectory(
  pack: BuiltInProjectResourcePack,
  directory = "",
): ProjectResourceExplorerEntry[] {
  const normalized = normalizedDirectory(directory);
  const prefix = normalized ? `${normalized}/` : "";
  const directories = new Map<string, ProjectResourceExplorerEntry>();
  const files: ProjectResourceExplorerEntry[] = [];
  pack.files.forEach((file, fileIndex) => {
    if (!file.path.startsWith(prefix)) return;
    const remainder = file.path.slice(prefix.length);
    if (!remainder) return;
    const separator = remainder.indexOf("/");
    if (separator >= 0) {
      const name = remainder.slice(0, separator);
      const path = prefix ? `${prefix}${name}` : name;
      directories.set(path, { kind: "directory", name, path });
      return;
    }
    files.push({
      kind: "file",
      name: remainder,
      path: file.path,
      fileIndex,
      file,
    });
  });
  return [
    ...[...directories.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    ),
    ...files.sort((left, right) => left.name.localeCompare(right.name, "en")),
  ];
}
