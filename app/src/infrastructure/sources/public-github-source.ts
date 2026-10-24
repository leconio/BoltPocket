import {
  decodeZipTextEntry,
  extractBoundedZipArchive,
  type BoundedZipArchiveEntry,
} from "@boltpocket/project-shell-extras";

import type {
  ProjectSourceImportProgress,
  ProjectSourceImportResult,
} from "@/application/ports/project-source-snapshots";
import type { Project } from "@/domain/models";
import { translateMessage } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/translate";

import {
  PROJECT_SOURCE_SNAPSHOT_LIMITS,
  type ProjectSourceFileDraft,
  type ProjectSourceSnapshotDraft,
  type ProjectSourceSnapshotStore,
} from "./project-source-snapshot-store";

export const PUBLIC_GITHUB_SOURCE_LIMITS = Object.freeze({
  maxArchiveBytes: 12 * 1024 * 1024,
  maxArchiveEntries: 3_000,
  maxArchiveExtractedBytes: 32 * 1024 * 1024,
  maxArchivePathBytes: 1_024,
  maxSourceFileBytes: PROJECT_SOURCE_SNAPSHOT_LIMITS.maxFileBytes,
  maxSourceFiles: PROJECT_SOURCE_SNAPSHOT_LIMITS.maxFiles - 1,
  maxSourceTextBytes:
    PROJECT_SOURCE_SNAPSHOT_LIMITS.maxTextBytes -
    PROJECT_SOURCE_SNAPSHOT_LIMITS.maxFileBytes,
});

const ignoredDirectoryNames = new Set([
  ".git",
  ".gradle",
  ".next",
  ".nuxt",
  ".turbo",
  "DerivedData",
  "Pods",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const apiHeaders = Object.freeze({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

export type PublicGitHubRepositoryRef = {
  owner: string;
  name: string;
  repository: string;
  url: string;
};

export type PublicGitHubSourceHttp = {
  getJson(
    url: string,
    headers: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<{ status: number; body: unknown }>;
  download(
    url: string,
    headers: Readonly<Record<string, string>>,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
};

export type PublicGitHubSourceDigest = {
  text(value: string): Promise<string>;
  bytes(value: Uint8Array): Promise<string>;
};

type PublicGitHubSourceAdapterOptions = {
  http: PublicGitHubSourceHttp;
  digest: PublicGitHubSourceDigest;
  store: ProjectSourceSnapshotStore;
  now?: () => Date;
  extractArchive?: (
    archive: Uint8Array,
    signal?: AbortSignal,
  ) => BoundedZipArchiveEntry[];
};

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("公共仓库导入已取消。");
  error.name = "AbortError";
  throw error;
}

function trimUrlPunctuation(value: string) {
  return value.replace(/[.,;:!?，。；：！？\])}＞》」』】]+$/gu, "");
}

export function parsePublicGitHubRepositoryUrl(
  value: string,
): PublicGitHubRepositoryRef {
  if (!value || value.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("GitHub 仓库地址无效。");
  }
  let url: URL;
  try {
    url = new URL(trimUrlPunctuation(value.trim()));
  } catch {
    throw new Error("GitHub 仓库地址无效。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLocaleLowerCase() !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("只支持无凭证的 HTTPS GitHub 公共仓库首页地址。");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new Error(
      "请粘贴 https://github.com/owner/repo 形式的仓库首页地址。",
    );
  }
  const owner = segments[0]!;
  const rawName = segments[1]!;
  const name = rawName.toLocaleLowerCase().endsWith(".git")
    ? rawName.slice(0, -4)
    : rawName;
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,38})$/iu.test(owner) ||
    !/^[a-z0-9._-]{1,100}$/iu.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Error("GitHub 仓库 owner 或名称无效。");
  }
  const repository = `${owner}/${name}`;
  return {
    owner,
    name,
    repository,
    url: `https://github.com/${repository}`,
  };
}

export function findPublicGitHubRepositoryUrl(value: string) {
  const repositories = new Map<string, PublicGitHubRepositoryRef>();
  for (const match of value.matchAll(
    /https:\/\/github\.com\/[^\s<>"'，。；：！？)\]}＞》」』】]+/giu,
  )) {
    try {
      const parsed = parsePublicGitHubRepositoryUrl(match[0]);
      repositories.set(parsed.repository.toLocaleLowerCase(), parsed);
    } catch {
      // Non-root GitHub links remain ordinary prompt text. They never broaden
      // the downloader's host or path scope.
    }
  }
  if (repositories.size > 1) {
    throw new Error("一次消息只能导入一个 GitHub 公共仓库。");
  }
  return repositories.values().next().value as
    PublicGitHubRepositoryRef | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function apiFailure(status: number) {
  if (status === 404) return new Error("GitHub 公共仓库不存在或不可公开读取。");
  if (status === 403 || status === 429) {
    return new Error("GitHub 公共接口当前受限，请稍后重试。");
  }
  return new Error(`GitHub 公共接口请求失败（HTTP ${status}）。`);
}

function validatedRepositoryMetadata(
  body: unknown,
  expected: PublicGitHubRepositoryRef,
) {
  if (!isRecord(body)) throw new Error("GitHub 返回了无效仓库元数据。");
  const fullName = body.full_name;
  const defaultBranch = body.default_branch;
  if (
    typeof fullName !== "string" ||
    fullName.toLocaleLowerCase() !== expected.repository.toLocaleLowerCase() ||
    body.private !== false ||
    typeof defaultBranch !== "string" ||
    !defaultBranch ||
    defaultBranch.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(defaultBranch)
  ) {
    throw new Error("GitHub 仓库不是可导入的公共源码仓库。");
  }
  return { defaultBranch, repository: fullName };
}

function validatedCommitSha(body: unknown) {
  if (
    !isRecord(body) ||
    typeof body.sha !== "string" ||
    !/^[0-9a-f]{40,64}$/u.test(body.sha)
  ) {
    throw new Error("GitHub 返回了无效提交版本。");
  }
  return body.sha;
}

function apiRepositoryPath(reference: PublicGitHubRepositoryRef) {
  return `${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.name)}`;
}

function stripGitHubArchiveRoot(entries: readonly BoundedZipArchiveEntry[]) {
  const roots = new Set(entries.map((entry) => entry.name.split("/")[0]));
  if (roots.size !== 1) {
    throw new Error("GitHub 源码归档缺少唯一仓库根目录。");
  }
  const root = roots.values().next().value;
  if (!root) throw new Error("GitHub 源码归档为空。");
  return entries.flatMap((entry) => {
    const segments = entry.name.split("/");
    const path = segments.slice(1).join("/");
    return path ? [{ path, data: entry.data }] : [];
  });
}

function ignoredSourcePath(path: string) {
  return path
    .split("/")
    .slice(0, -1)
    .some((segment) => ignoredDirectoryNames.has(segment));
}

function bytesInText(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function snapshotSummary(input: {
  repository: string;
  defaultBranch: string;
  commitSha: string;
  fetchedAt: string;
  fileCount: number;
  totalBytes: number;
  skippedBinaryFiles: number;
  skippedOversizedFiles: number;
  locale: AppLocale;
}) {
  return translateMessage("project.sourceSnapshot.manifest", input.locale, {
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    commitSha: input.commitSha,
    fetchedAt: input.fetchedAt,
    fileCount: input.fileCount,
    totalBytes: input.totalBytes,
    skippedBinaryFiles: input.skippedBinaryFiles,
    skippedOversizedFiles: input.skippedOversizedFiles,
  });
}

async function stableId(
  digest: PublicGitHubSourceDigest,
  prefix: string,
  value: string,
  length = 24,
) {
  return `${prefix}-${(await digest.text(value)).slice(0, length)}`;
}

function stableIdentity(...parts: readonly string[]) {
  return JSON.stringify(parts);
}

export class PublicGitHubSourceAdapter {
  readonly #options: PublicGitHubSourceAdapterOptions;

  constructor(options: PublicGitHubSourceAdapterOptions) {
    this.#options = options;
  }

  async import(input: {
    project: Project;
    url: string;
    locale?: AppLocale;
    signal?: AbortSignal;
    onProgress?: (progress: ProjectSourceImportProgress) => void;
  }): Promise<ProjectSourceImportResult> {
    const reference = parsePublicGitHubRepositoryUrl(input.url);
    throwIfAborted(input.signal);
    input.onProgress?.("inspect");
    const path = apiRepositoryPath(reference);
    const metadataResponse = await this.#options.http.getJson(
      `https://api.github.com/repos/${path}`,
      apiHeaders,
      input.signal,
    );
    if (metadataResponse.status !== 200) {
      throw apiFailure(metadataResponse.status);
    }
    const metadata = validatedRepositoryMetadata(
      metadataResponse.body,
      reference,
    );
    const commitResponse = await this.#options.http.getJson(
      `https://api.github.com/repos/${path}/commits/${encodeURIComponent(metadata.defaultBranch)}`,
      apiHeaders,
      input.signal,
    );
    if (commitResponse.status !== 200) throw apiFailure(commitResponse.status);
    const commitSha = validatedCommitSha(commitResponse.body);
    const sourceKey = `https://github.com/${metadata.repository.toLocaleLowerCase()}`;
    const cached = await this.#options.store.find(
      input.project.id,
      "github-public",
      sourceKey,
      commitSha,
    );
    if (cached) {
      return {
        sourceKind: "github-public",
        sourceLabel: metadata.repository,
        revision: commitSha,
        versionLabel: `${metadata.defaultBranch}@${commitSha.slice(0, 12)}`,
        cached: true,
        bundles: cached,
      };
    }

    throwIfAborted(input.signal);
    input.onProgress?.("acquire");
    const archive = await this.#options.http.download(
      `https://api.github.com/repos/${path}/zipball/${commitSha}`,
      apiHeaders,
      PUBLIC_GITHUB_SOURCE_LIMITS.maxArchiveBytes,
      input.signal,
    );
    if (archive.byteLength > PUBLIC_GITHUB_SOURCE_LIMITS.maxArchiveBytes) {
      throw new Error("GitHub 源码归档超过移动端下载上限。");
    }
    const archiveSha256 = await this.#options.digest.bytes(archive);

    throwIfAborted(input.signal);
    input.onProgress?.("extract");
    const extractArchive =
      this.#options.extractArchive ??
      ((bytes: Uint8Array, signal?: AbortSignal) =>
        extractBoundedZipArchive(
          bytes,
          {
            maxArchiveBytes: PUBLIC_GITHUB_SOURCE_LIMITS.maxArchiveBytes,
            maxEntries: PUBLIC_GITHUB_SOURCE_LIMITS.maxArchiveEntries,
            maxEntryBytes: PUBLIC_GITHUB_SOURCE_LIMITS.maxArchiveExtractedBytes,
            maxExtractedBytes:
              PUBLIC_GITHUB_SOURCE_LIMITS.maxArchiveExtractedBytes,
            maxPathBytes: PUBLIC_GITHUB_SOURCE_LIMITS.maxArchivePathBytes,
          },
          signal,
        ));
    const entries = stripGitHubArchiveRoot(
      extractArchive(archive, input.signal),
    );
    const sourceFiles: { path: string; content: string; byteLength: number }[] =
      [];
    let totalTextBytes = 0;
    let skippedBinaryFiles = 0;
    let skippedOversizedFiles = 0;
    const seenPaths = new Set<string>();
    for (const entry of entries) {
      throwIfAborted(input.signal);
      if (ignoredSourcePath(entry.path)) continue;
      if (seenPaths.has(entry.path)) {
        throw new Error(`GitHub 源码归档包含重复路径：${entry.path}`);
      }
      seenPaths.add(entry.path);
      if (
        entry.data.byteLength > PUBLIC_GITHUB_SOURCE_LIMITS.maxSourceFileBytes
      ) {
        skippedOversizedFiles += 1;
        continue;
      }
      let content: string;
      try {
        content = decodeZipTextEntry({ name: entry.path, data: entry.data });
      } catch {
        skippedBinaryFiles += 1;
        continue;
      }
      if (content.includes("\0")) {
        skippedBinaryFiles += 1;
        continue;
      }
      const byteLength = bytesInText(content);
      totalTextBytes += byteLength;
      if (totalTextBytes > PUBLIC_GITHUB_SOURCE_LIMITS.maxSourceTextBytes) {
        throw new Error(
          `公共仓库可分析文本超过 ${PUBLIC_GITHUB_SOURCE_LIMITS.maxSourceTextBytes} 字节，请选择更小的仓库。`,
        );
      }
      sourceFiles.push({ path: entry.path, content, byteLength });
      if (sourceFiles.length > PUBLIC_GITHUB_SOURCE_LIMITS.maxSourceFiles) {
        throw new Error(
          `公共仓库文本文件超过 ${PUBLIC_GITHUB_SOURCE_LIMITS.maxSourceFiles} 项，请选择更小的仓库。`,
        );
      }
    }
    if (sourceFiles.length === 0) {
      throw new Error("GitHub 公共仓库中没有可安全分析的 UTF-8 文本源码。");
    }

    const canonicalRepository = metadata.repository;
    const identity = stableIdentity(
      input.project.id,
      canonicalRepository.toLocaleLowerCase(),
    );
    const connectionId = await stableId(
      this.#options.digest,
      "github-source",
      identity,
      20,
    );
    const reportConnectionId = await stableId(
      this.#options.digest,
      "project-reports",
      input.project.id,
      20,
    );
    const reportResourceId = await stableId(
      this.#options.digest,
      "github-report",
      identity,
      20,
    );
    const snapshotId = await stableId(
      this.#options.digest,
      "github-snapshot",
      stableIdentity(identity, commitSha),
      24,
    );
    const fetchedAt = (this.#options.now?.() ?? new Date()).toISOString();
    const manifestRelativePath = `.boltpocket-source-${commitSha.slice(0, 12)}.md`;
    const summary = snapshotSummary({
      repository: canonicalRepository,
      defaultBranch: metadata.defaultBranch,
      commitSha,
      fetchedAt,
      fileCount: sourceFiles.length,
      totalBytes: totalTextBytes,
      skippedBinaryFiles,
      skippedOversizedFiles,
      locale: input.locale ?? "zh-CN",
    });
    sourceFiles.push({
      path: manifestRelativePath,
      content: summary,
      byteLength: bytesInText(summary),
    });

    const files: ProjectSourceFileDraft[] = [];
    for (const file of sourceFiles) {
      files.push({
        id: await stableId(
          this.#options.digest,
          "github-file",
          stableIdentity(identity, file.path),
          24,
        ),
        path: file.path,
        content: file.content,
        version: await this.#options.digest.text(file.content),
        byteLength: file.byteLength,
      });
    }

    throwIfAborted(input.signal);
    input.onProgress?.("store");
    const draft: ProjectSourceSnapshotDraft = {
      id: snapshotId,
      projectId: input.project.id,
      connectionId,
      reportConnectionId,
      reportResourceId,
      reportPath: `reports/${reference.owner}-${reference.name}-analysis.md`,
      sourceKind: "github-public",
      sourceKey,
      sourceLabel: canonicalRepository,
      mountPath: canonicalRepository,
      revision: commitSha,
      versionLabel: `${metadata.defaultBranch}@${commitSha.slice(0, 12)}`,
      contentSha256: archiveSha256,
      importedAt: fetchedAt,
      manifestPath: manifestRelativePath,
      files,
    };
    const bundles = await this.#options.store.store(draft, input.locale);
    return {
      sourceKind: "github-public",
      sourceLabel: canonicalRepository,
      revision: commitSha,
      versionLabel: draft.versionLabel,
      cached: false,
      bundles,
    };
  }
}
