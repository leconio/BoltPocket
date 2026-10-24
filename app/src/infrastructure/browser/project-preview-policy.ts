import type {
  CreateProjectPreviewInput,
  ProjectPreviewFile,
} from "@/application/ports/project-preview";
import {
  builtInProjectResourceFile,
  isBuiltInProjectResourcePackId,
  projectResourceH5Path,
} from "@/domain/builtin-project-resources";
import {
  createDefaultProjectH5Manifest,
  parseProjectH5Manifest,
  projectH5NetworkDeclarations,
  PROJECT_H5_MANIFEST_FILE,
  type ProjectH5Manifest,
} from "@/domain/project-h5-manifest";
import { normalizeProjectShellPath } from "@/infrastructure/agent/workspace-project-shell";
import { unsupportedMiniAppNetworkOrigins } from "@/config/distribution";

import { h5RuntimeHtmlInjection } from "./h5-runtime-registry";

export const PROJECT_PREVIEW_LIMITS = Object.freeze({
  files: 512,
  bytes: 8 * 1024 * 1024,
  fileBytes: 1024 * 1024,
});

export function createProjectPreviewCsp(manifest?: ProjectH5Manifest) {
  const declaredOrigins = projectH5NetworkDeclarations(
    manifest ?? createDefaultProjectH5Manifest("index.html"),
  );
  const httpsOrigins = [
    ...new Set(
      declaredOrigins
        .map(({ origin }) => origin)
        .filter((origin) => origin.startsWith("https://")),
    ),
  ].sort();
  const connectionOrigins = [
    ...new Set(declaredOrigins.map(({ origin }) => origin)),
  ].sort();
  const withOrigins = (base: string, origins: readonly string[]) =>
    [base, ...origins].join(" ");
  return [
    "default-src 'self' data: blob:",
    "script-src 'self'",
    withOrigins("style-src 'self' 'unsafe-inline'", httpsOrigins),
    withOrigins("connect-src 'self'", connectionOrigins),
    withOrigins("img-src 'self' data: blob:", httpsOrigins),
    withOrigins("font-src 'self' data:", httpsOrigins),
    withOrigins("media-src 'self' data: blob:", httpsOrigins),
    "worker-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "manifest-src 'self'",
  ].join("; ");
}

export const PROJECT_PREVIEW_CSP = createProjectPreviewCsp();

const PREVIEWABLE_EXTENSIONS = new Set([
  "css",
  "csv",
  "html",
  "htm",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "map",
  "mjs",
  "png",
  "svg",
  "ttf",
  "txt",
  "webp",
  "webmanifest",
  "woff",
  "woff2",
  "xml",
]);

const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".gitignore",
  "agents.md",
  "memory.md",
  "notes.md",
  "skill.md",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);

const SENSITIVE_SEGMENTS = new Set([
  ".git",
  ".ssh",
  "memory",
  "memories",
  "skills",
]);

const utf8 = new TextEncoder();

export type PreparedProjectPreview = Readonly<{
  entryPath: string;
  rootPath: string;
  displayPath: string;
  manifest: ProjectH5Manifest;
  files: readonly Readonly<{
    path: string;
    relativePath: string;
    content: string;
    byteLength: number;
    encoding?: "base64";
    mimeType?: string;
    sha256?: string;
    source?: NonNullable<ProjectPreviewFile["source"]>;
  }>[];
  byteLength: number;
}>;

function parentPath(path: string) {
  const separator = path.lastIndexOf("/");
  return separator <= 0 ? "/" : path.slice(0, separator);
}

function relativePath(root: string, path: string) {
  if (path === root) return "";
  const prefix = root === "/" ? "/" : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

function extension(path: string) {
  const fileName = path.split("/").at(-1) ?? "";
  const separator = fileName.lastIndexOf(".");
  return separator > 0 ? fileName.slice(separator + 1).toLowerCase() : "";
}

function isSensitivePath(path: string) {
  const segments = path.split("/").filter(Boolean);
  const fileName = segments.at(-1)?.toLowerCase() ?? "";
  if (fileName.startsWith(".env")) return true;
  if (SENSITIVE_FILE_NAMES.has(fileName)) return true;
  if (/\.(?:key|keystore|p12|pfx|pem)$/u.test(fileName)) return true;
  return segments.some((segment) =>
    SENSITIVE_SEGMENTS.has(segment.toLowerCase()),
  );
}

export function isProjectPreviewCandidatePath(
  entryPath: string,
  candidatePath: string,
) {
  const entry = normalizeProjectShellPath(entryPath);
  const candidate = normalizeProjectShellPath(candidatePath);
  const relative = relativePath(parentPath(entry), candidate);
  return Boolean(
    relative &&
    !isSensitivePath(relative) &&
    PREVIEWABLE_EXTENSIONS.has(extension(relative)),
  );
}

function assertProjectId(projectId: string) {
  if (!/^[a-zA-Z0-9._-]{1,120}$/u.test(projectId)) {
    throw new Error("项目编号不能用于本地预览。");
  }
}

function prepareFile(
  file: ProjectPreviewFile,
  rootPath: string,
): PreparedProjectPreview["files"][number] | null {
  const path = normalizeProjectShellPath(file.path);
  const relative = relativePath(rootPath, path);
  if (relative === undefined || !relative || isSensitivePath(relative)) {
    return null;
  }
  if (!PREVIEWABLE_EXTENSIONS.has(extension(relative))) return null;
  if (file.encoding === "base64") {
    const source = file.source;
    if (
      !source ||
      source.kind !== "builtin-h5-resource" ||
      !isBuiltInProjectResourcePackId(source.packId)
    ) {
      throw new Error(`H5 二进制资源缺少可信来源：${path}`);
    }
    const descriptor = builtInProjectResourceFile(source.packId, source.path);
    const expectedRelative = projectResourceH5Path(
      source.packId,
      source.path,
    ).slice(2);
    const padding = file.content.endsWith("==")
      ? 2
      : file.content.endsWith("=")
        ? 1
        : 0;
    const decodedByteLength =
      file.content.length > 0 &&
      file.content.length % 4 === 0 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        file.content,
      )
        ? (file.content.length / 4) * 3 - padding
        : -1;
    if (
      !descriptor ||
      relative !== expectedRelative ||
      file.mimeType !== descriptor.mimeType ||
      file.byteLength !== descriptor.byteLength ||
      file.sha256 !== descriptor.sha256 ||
      decodedByteLength !== descriptor.byteLength
    ) {
      throw new Error(`H5 二进制资源副本校验失败：${path}`);
    }
    if (descriptor.byteLength > PROJECT_PREVIEW_LIMITS.fileBytes) {
      throw new Error(`H5 预览文件超过 1 MiB：${path}`);
    }
    return {
      path,
      relativePath: relative,
      content: file.content,
      byteLength: descriptor.byteLength,
      encoding: "base64",
      mimeType: descriptor.mimeType,
      sha256: descriptor.sha256,
      source: { ...source },
    };
  }
  if (file.content.includes("\0")) {
    throw new Error(`H5 预览只支持文本资源：${path}`);
  }
  const byteLength = utf8.encode(file.content).byteLength;
  if (byteLength > PROJECT_PREVIEW_LIMITS.fileBytes) {
    throw new Error(`H5 预览文件超过 1 MiB：${path}`);
  }
  return { path, relativePath: relative, content: file.content, byteLength };
}

export function injectProjectPreviewPolicy(
  html: string,
  options: Readonly<{
    manifest?: ProjectH5Manifest;
    runtimeBasePath?: string;
  }> = {},
) {
  const runtime = options.manifest
    ? h5RuntimeHtmlInjection(
        options.manifest,
        options.runtimeBasePath ?? "/runtime/",
      )
    : { headStart: "", headEnd: "" };
  const viewport = /<meta\b[^>]*\bname\s*=\s*["']?viewport["']?[^>]*>/iu.test(
    html,
  )
    ? ""
    : '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
  const meta = `${viewport}<meta http-equiv="Content-Security-Policy" content="${createProjectPreviewCsp(options.manifest)}">${runtime.headStart}`;
  let result: string;
  const head = /<head(?:\s[^>]*)?>/iu.exec(html);
  if (head?.index !== undefined) {
    const insertion = head.index + head[0].length;
    result = `${html.slice(0, insertion)}${meta}${html.slice(insertion)}`;
  } else {
    const htmlTag = /<html(?:\s[^>]*)?>/iu.exec(html);
    if (htmlTag?.index !== undefined) {
      const insertion = htmlTag.index + htmlTag[0].length;
      result = `${html.slice(0, insertion)}<head>${meta}</head>${html.slice(insertion)}`;
    } else {
      result = `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
    }
  }
  if (!runtime.headEnd) return result;
  const closingHead = /<\/head\s*>/iu.exec(result);
  if (closingHead?.index === undefined) {
    throw new Error("H5 预览无法注入运行时。");
  }
  return `${result.slice(0, closingHead.index)}${runtime.headEnd}${result.slice(closingHead.index)}`;
}

function assertProjectPreviewDistributionPolicy(manifest: ProjectH5Manifest) {
  const unsupported = unsupportedMiniAppNetworkOrigins(
    projectH5NetworkDeclarations(manifest).map(({ origin }) => origin),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `当前大陆发行配置未登记这些小程序联网接收方：${unsupported.join("、")}。请改为离线使用或完成登记后随 App 发版。`,
    );
  }
}

export function prepareProjectPreview(
  input: CreateProjectPreviewInput,
  options: Readonly<{
    runtimeBasePath?: string;
  }> = {},
): PreparedProjectPreview {
  assertProjectId(input.projectId);
  const entryPath = normalizeProjectShellPath(input.entryPath);
  if (!/\.html?$/iu.test(entryPath)) {
    throw new Error("H5 预览入口必须是 HTML 文件。");
  }
  if (isSensitivePath(entryPath)) {
    throw new Error("这个项目文件不能用于 H5 预览。");
  }
  const rootPath = parentPath(entryPath);
  const byPath = new Map<string, PreparedProjectPreview["files"][number]>();
  for (const file of input.files) {
    const prepared = prepareFile(file, rootPath);
    if (!prepared) continue;
    if (byPath.has(prepared.path)) {
      throw new Error(`H5 预览包含重复路径：${prepared.path}`);
    }
    byPath.set(prepared.path, prepared);
  }
  const entry = byPath.get(entryPath);
  if (!entry) throw new Error("H5 预览入口不在当前项目资源中。");
  const manifestFile = [...byPath.values()].find(
    (file) => file.relativePath === PROJECT_H5_MANIFEST_FILE,
  );
  const defaultTitle =
    rootPath.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/gu, " ") ||
    "H5 小程序";
  const manifest = manifestFile
    ? parseProjectH5Manifest(manifestFile.content, entry.relativePath)
    : createDefaultProjectH5Manifest(entry.relativePath, defaultTitle);
  assertProjectPreviewDistributionPolicy(manifest);
  const copiedPackIds = new Set(
    [...byPath.values()].flatMap((file) =>
      file.source?.kind === "builtin-h5-resource" ? [file.source.packId] : [],
    ),
  );
  const declaredPackIds = new Set(manifest.resources ?? []);
  const undeclaredCopies = [...copiedPackIds].filter(
    (packId) => !declaredPackIds.has(packId),
  );
  const missingCopies = [...declaredPackIds].filter(
    (packId) => !copiedPackIds.has(packId),
  );
  if (undeclaredCopies.length > 0) {
    throw new Error(`H5 项目资源未在清单声明：${undeclaredCopies.join("、")}`);
  }
  if (missingCopies.length > 0) {
    throw new Error(`H5 清单资源尚未复制到项目：${missingCopies.join("、")}`);
  }
  for (const [path, file] of byPath) {
    if (file.encoding === "base64" || !/\.html?$/iu.test(file.relativePath)) {
      continue;
    }
    byPath.set(path, {
      ...file,
      content: injectProjectPreviewPolicy(file.content, {
        manifest,
        runtimeBasePath: options.runtimeBasePath,
      }),
    });
  }
  for (const [path, file] of byPath) {
    if (file.encoding === "base64") continue;
    byPath.set(path, {
      ...file,
      byteLength: utf8.encode(file.content).byteLength,
    });
  }
  const files = [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en"),
  );
  if (files.length > PROJECT_PREVIEW_LIMITS.files) {
    throw new Error(`H5 预览最多包含 ${PROJECT_PREVIEW_LIMITS.files} 个文件。`);
  }
  const byteLength = files.reduce((total, file) => total + file.byteLength, 0);
  if (byteLength > PROJECT_PREVIEW_LIMITS.bytes) {
    throw new Error("H5 预览快照超过 8 MiB。请缩小预览目录。");
  }
  return {
    entryPath,
    rootPath,
    displayPath: entry.relativePath,
    manifest,
    files,
    byteLength,
  };
}

export function encodeProjectPreviewPath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
