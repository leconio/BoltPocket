import type { WorkspaceResource } from "./models.ts";
import {
  createDefaultProjectH5Manifest,
  parseProjectH5Manifest,
  PROJECT_H5_MANIFEST_FILE,
  type ProjectH5Manifest,
} from "./project-h5-manifest.ts";
import {
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
} from "./project-workspace.ts";

export type ProjectH5App = Readonly<{
  resourceId: string;
  title: string;
  path: string;
  address: string;
  manifest: ProjectH5Manifest | null;
  manifestStatus: "valid" | "missing" | "invalid";
}>;

function cleanTitle(value: string) {
  return [
    ...value
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  ]
    .slice(0, 80)
    .join("");
}

function decodeHtmlTitle(value: string) {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(nbsp|amp|lt|gt|quot|apos));/giu,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      if (decimal) {
        const point = Number.parseInt(decimal, 10);
        return Number.isSafeInteger(point) && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      if (hexadecimal) {
        const point = Number.parseInt(hexadecimal, 16);
        return Number.isSafeInteger(point) && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      switch (named.toLocaleLowerCase()) {
        case "nbsp":
          return " ";
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return entity;
      }
    },
  );
}

function fallbackTitle(path: string) {
  const segments = path.split("/");
  const fileName = segments.at(-1) ?? path;
  const stem = fileName.replace(/\.[^.]+$/u, "");
  const parent = segments.at(-2);
  const candidate =
    stem.toLocaleLowerCase() === "index" && parent ? parent : stem;
  return cleanTitle(candidate.replace(/[-_]+/gu, " ")) || "H5 小程序";
}

function h5Manifest(
  resource: WorkspaceResource,
  resources: readonly WorkspaceResource[],
): Readonly<{
  manifest: ProjectH5Manifest | null;
  status: "valid" | "missing" | "invalid";
}> {
  const parent = resource.path.slice(0, resource.path.lastIndexOf("/"));
  const manifestResource = resources.find(
    (candidate) =>
      candidate.projectId === resource.projectId &&
      candidate.connectionId === resource.connectionId &&
      candidate.path === `${parent}/${PROJECT_H5_MANIFEST_FILE}`,
  );
  if (manifestResource) {
    try {
      return {
        manifest: parseProjectH5Manifest(
          manifestResource.content,
          "index.html",
        ),
        status: "valid",
      };
    } catch {
      return { manifest: null, status: "invalid" };
    }
  }
  return { manifest: null, status: "missing" };
}

function h5Title(resource: WorkspaceResource) {
  const documentTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(
    resource.content,
  )?.[1];
  if (documentTitle) {
    const title = cleanTitle(decodeHtmlTitle(documentTitle));
    if (title) return title;
  }
  return fallbackTitle(resource.path);
}

function isH5Entry(resource: WorkspaceResource, projectId: string) {
  if (
    resource.projectId !== projectId ||
    !isProjectWorkspaceResource(resource) ||
    !isSafeProjectWorkspacePath(resource.path)
  ) {
    return false;
  }
  return /^apps\/[^/]+\/index\.html$/u.test(resource.path);
}

export function getProjectH5Apps(
  resources: readonly WorkspaceResource[],
  projectId: string,
): ProjectH5App[] {
  return resources
    .filter((resource) => isH5Entry(resource, projectId))
    .map((resource) => {
      const metadata = h5Manifest(resource, resources);
      const fallback = h5Title(resource);
      const title = metadata.manifest?.title ?? fallback;
      return {
        resourceId: resource.id,
        title,
        path: resource.path,
        address: `/project/${resource.path}`,
        manifest:
          metadata.manifest ??
          (metadata.status === "missing"
            ? createDefaultProjectH5Manifest("index.html", title)
            : null),
        manifestStatus: metadata.status,
      };
    })
    .sort(
      (left, right) =>
        left.title.localeCompare(right.title, "zh-CN") ||
        left.path.localeCompare(right.path, "en") ||
        left.resourceId.localeCompare(right.resourceId, "en"),
    );
}
