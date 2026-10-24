import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

import { ConnectorError } from "@boltpocket/connector-core";
import type {
  LocalTextStorageEntry,
  LocalTextStoragePort,
  StoredRecoveryPoint,
} from "@boltpocket/connector-local";

import type {
  ProjectResourceBundle,
  ProjectSourceKind,
  ProjectSourceSnapshotService,
} from "@/application/ports/project-source-snapshots";
import type { WorkspaceResource } from "@/domain/models";
import { translateMessage } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/translate";

import {
  PUBLIC_GITHUB_SOURCE_LIMITS,
  PublicGitHubSourceAdapter,
  type PublicGitHubSourceDigest,
  type PublicGitHubSourceHttp,
} from "./public-github-source";
import {
  PROJECT_SOURCE_SNAPSHOT_LIMITS,
  type ProjectSourceSnapshotDraft,
  type ProjectSourceSnapshotStore,
} from "./project-source-snapshot-store";

// Provider-neutral persistence; network-specific behavior lives in adapters.
const MANIFEST_VERSION = 1;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const idSchema = Type.String({ minLength: 1, maxLength: 240 });
const pathSchema = Type.String({ minLength: 1, maxLength: 4_000 });
const sourceKindSchema = Type.Union([
  Type.Literal("github-public"),
  Type.Literal("local-file"),
  Type.Literal("local-archive"),
  Type.Literal("pasted-text"),
  Type.Literal("public-archive"),
]);

const storedFileSchema = Type.Object(
  {
    id: idSchema,
    path: pathSchema,
    version: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    byteLength: Type.Integer({
      minimum: 0,
      maximum: PROJECT_SOURCE_SNAPSHOT_LIMITS.maxFileBytes,
    }),
  },
  { additionalProperties: false },
);

const storedSnapshotSchema = Type.Object(
  {
    id: idSchema,
    directoryName: idSchema,
    projectId: idSchema,
    connectionId: idSchema,
    reportConnectionId: idSchema,
    reportResourceId: idSchema,
    reportPath: pathSchema,
    sourceKind: sourceKindSchema,
    sourceKey: Type.String({ minLength: 1, maxLength: 2_048 }),
    sourceLabel: Type.String({ minLength: 1, maxLength: 240 }),
    mountPath: pathSchema,
    revision: Type.String({ minLength: 1, maxLength: 512 }),
    versionLabel: Type.String({ minLength: 1, maxLength: 512 }),
    contentSha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    importedAt: Type.String({ minLength: 20, maxLength: 64 }),
    manifestPath: pathSchema,
    files: Type.Array(storedFileSchema, {
      minItems: 1,
      maxItems: PROJECT_SOURCE_SNAPSHOT_LIMITS.maxFiles,
    }),
  },
  { additionalProperties: false },
);

const sourceManifestSchema = Type.Object(
  {
    version: Type.Literal(MANIFEST_VERSION),
    snapshots: Type.Array(storedSnapshotSchema, {
      maxItems: PROJECT_SOURCE_SNAPSHOT_LIMITS.maxSnapshots,
    }),
  },
  { additionalProperties: false },
);

type StoredSourceSnapshot = Static<typeof storedSnapshotSchema>;
type SourceManifest = Static<typeof sourceManifestSchema>;

function byteHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const expoDigest: PublicGitHubSourceDigest = {
  text: (value) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  bytes: async (value) => {
    const copied = new Uint8Array(value.byteLength);
    copied.set(value);
    return byteHex(
      await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, copied),
    );
  },
};

function safeRelativePath(value: string) {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) =>
        Boolean(segment) &&
        segment !== "." &&
        segment !== ".." &&
        segment === segment.normalize("NFC"),
    );
}

function safeStorageName(value: string) {
  return (
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function safeDisplayText(value: string) {
  return !/[\u0000-\u001f\u007f]/u.test(value);
}

function validImportedAt(value: string) {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function snapshotValidationFailure(snapshot: StoredSourceSnapshot) {
  const storageNames = [
    snapshot.id,
    snapshot.directoryName,
    snapshot.connectionId,
    snapshot.reportConnectionId,
    snapshot.reportResourceId,
    ...snapshot.files.map((file) => file.id),
  ];
  const filePaths = new Set(snapshot.files.map((file) => file.path));
  if (/[\u0000-\u001f\u007f]/u.test(snapshot.sourceKey)) return "source-key";
  if (!safeDisplayText(snapshot.sourceLabel)) return "source-label";
  if (!safeDisplayText(snapshot.revision)) return "revision";
  if (!safeDisplayText(snapshot.versionLabel)) return "version-label";
  if (!validImportedAt(snapshot.importedAt)) return "imported-at";
  if (!safeRelativePath(snapshot.reportPath)) return "report-path";
  if (!safeRelativePath(snapshot.mountPath)) return "mount-path";
  if (!safeRelativePath(snapshot.manifestPath)) return "manifest-path";
  if (!storageNames.every(safeStorageName)) return "storage-name";
  if (snapshot.connectionId === snapshot.reportConnectionId) {
    return "connection-identity";
  }
  if (
    new Set(snapshot.files.map((file) => file.id)).size !==
    snapshot.files.length
  ) {
    return "duplicate-file-id";
  }
  if (filePaths.size !== snapshot.files.length) return "duplicate-file-path";
  if (!filePaths.has(snapshot.manifestPath)) return "missing-source-manifest";
  if (!snapshot.files.every((file) => safeRelativePath(file.path))) {
    return "file-path";
  }
  if (
    !snapshot.files.every(
      (file) => `${snapshot.mountPath}/${file.path}`.length <= 4_000,
    )
  ) {
    return "mounted-path-length";
  }
  if (
    snapshot.files.reduce((total, file) => total + file.byteLength, 0) >
    PROJECT_SOURCE_SNAPSHOT_LIMITS.maxTextBytes
  ) {
    return "text-byte-limit";
  }
  return null;
}

function parseManifest(value: unknown): SourceManifest {
  if (!Value.Check(sourceManifestSchema, value)) {
    const firstError = Value.Errors(sourceManifestSchema, value)[0];
    const location = firstError?.instancePath || "/";
    const keyword = firstError?.keyword ?? "unknown";
    throw new Error(`项目来源快照清单格式无效（${location}:${keyword}）。`);
  }
  const manifest = value as SourceManifest;
  const snapshotKeys = new Set<string>();
  const snapshotIds = new Set<string>();
  const directoryNames = new Set<string>();
  const connectionOwners = new Map<string, string>();
  const resourceIds = new Set<string>();
  for (const snapshot of manifest.snapshots) {
    const key = `${snapshot.projectId}\0${snapshot.sourceKind}\0${snapshot.sourceKey}`;
    const sourceOwner = `source:${key}`;
    const reportOwner = `report:${snapshot.projectId}`;
    const sourceConnectionOwner = connectionOwners.get(snapshot.connectionId);
    const reportConnectionOwner = connectionOwners.get(
      snapshot.reportConnectionId,
    );
    const currentResourceIds = [
      snapshot.reportResourceId,
      ...snapshot.files.map((file) => file.id),
    ];
    const invalidSnapshot = snapshotValidationFailure(snapshot);
    if (invalidSnapshot) {
      throw new Error(`项目来源快照清单包含不安全字段（${invalidSnapshot}）。`);
    }
    if (snapshotKeys.has(key)) {
      throw new Error("项目来源快照清单包含重复来源。");
    }
    if (snapshotIds.has(snapshot.id)) {
      throw new Error("项目来源快照清单包含重复快照标识。");
    }
    if (directoryNames.has(snapshot.directoryName)) {
      throw new Error("项目来源快照清单包含重复快照目录。");
    }
    if (
      (sourceConnectionOwner !== undefined &&
        sourceConnectionOwner !== sourceOwner) ||
      (reportConnectionOwner !== undefined &&
        reportConnectionOwner !== reportOwner)
    ) {
      throw new Error("项目来源快照清单包含跨项目连接冲突。");
    }
    if (
      new Set(currentResourceIds).size !== currentResourceIds.length ||
      currentResourceIds.some((id) => resourceIds.has(id))
    ) {
      throw new Error("项目来源快照清单包含重复资源标识。");
    }
    snapshotKeys.add(key);
    snapshotIds.add(snapshot.id);
    directoryNames.add(snapshot.directoryName);
    connectionOwners.set(snapshot.connectionId, sourceOwner);
    connectionOwners.set(snapshot.reportConnectionId, reportOwner);
    currentResourceIds.forEach((id) => resourceIds.add(id));
  }
  return manifest;
}

function sourceConnection(snapshot: StoredSourceSnapshot, connected: boolean) {
  return {
    id: snapshot.connectionId,
    projectId: snapshot.projectId,
    name: "项目 Source Snapshot",
    account: snapshot.sourceLabel,
    scope: snapshot.versionLabel,
    status: connected ? ("connected" as const) : ("attention" as const),
    resourceCount: connected ? snapshot.files.length : 0,
    access: "persistent" as const,
    writeMode: "read-only" as const,
    verification: `${snapshot.sourceKind} · SHA256:${snapshot.contentSha256}`,
  };
}

function reportTemplate(
  snapshot: ProjectSourceSnapshotDraft,
  locale: AppLocale,
) {
  return translateMessage("project.sourceReport.template", locale, {
    source: snapshot.sourceLabel,
    version: snapshot.versionLabel,
  });
}

class ExpoPublicGitHubSourceHttp implements PublicGitHubSourceHttp {
  readonly #fetch: typeof fetch;
  readonly #downloads = new Directory(
    Paths.cache,
    "boltpocket",
    "public-source-downloads",
  );

  constructor(fetchImplementation: typeof fetch = fetch) {
    this.#fetch = fetchImplementation;
  }

  async getJson(
    url: string,
    headers: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ) {
    const response = await this.#fetch(url, {
      method: "GET",
      headers,
      credentials: "omit",
      signal,
    });
    const responseUrl = new URL(response.url || url);
    if (
      responseUrl.protocol !== "https:" ||
      responseUrl.hostname !== "api.github.com"
    ) {
      throw new Error("GitHub 元数据响应离开了允许的主机。");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
      throw new Error("GitHub 元数据响应超过安全上限。");
    }
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new Error("GitHub 元数据响应不是有效 JSON。");
      }
    }
    return { status: response.status, body };
  }

  async download(
    url: string,
    headers: Readonly<Record<string, string>>,
    maxBytes: number,
    signal?: AbortSignal,
  ) {
    const requestUrl = new URL(url);
    if (
      requestUrl.protocol !== "https:" ||
      requestUrl.hostname !== "api.github.com" ||
      !requestUrl.pathname.startsWith("/repos/")
    ) {
      throw new Error("公共源码下载地址不在允许范围内。");
    }
    this.#downloads.create({ idempotent: true, intermediates: true });
    const destination = new File(
      this.#downloads,
      `github-${Crypto.randomUUID()}.zip`,
    );
    const controller = new AbortController();
    let exceeded = false;
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const downloaded = await File.downloadFileAsync(url, destination, {
        headers: { ...headers },
        signal: controller.signal,
        onProgress(progress) {
          if (
            progress.bytesWritten > maxBytes ||
            (progress.totalBytes >= 0 && progress.totalBytes > maxBytes)
          ) {
            exceeded = true;
            controller.abort("download limit exceeded");
          }
        },
      });
      if (downloaded.size > maxBytes) {
        throw new Error("GitHub 源码归档超过移动端下载上限。");
      }
      return await downloaded.bytes();
    } catch (error) {
      if (exceeded) {
        throw new Error("GitHub 源码归档超过移动端下载上限。");
      }
      if (signal?.aborted) {
        const aborted = new Error("公共仓库导入已取消。");
        aborted.name = "AbortError";
        throw aborted;
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
      if (destination.exists) destination.delete();
    }
  }
}

class ExpoProjectSourceSnapshotStore implements ProjectSourceSnapshotStore {
  readonly #root = new Directory(Paths.document, "boltpocket", "public-sources");
  readonly #snapshots = new Directory(this.#root, "snapshots");
  readonly #reports = new Directory(this.#root, "reports");
  readonly #manifest = new File(this.#root, "manifest.json");

  async load() {
    return this.#bundles(await this.#readManifest());
  }

  async find(
    projectId: string,
    sourceKind: ProjectSourceKind,
    sourceKey: string,
    revision: string,
  ) {
    const manifest = await this.#readManifest();
    const snapshot = manifest.snapshots.find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.sourceKind === sourceKind &&
        candidate.sourceKey === sourceKey &&
        candidate.revision === revision,
    );
    if (
      !snapshot ||
      !this.#snapshotFilesExist(snapshot) ||
      !this.#reportFile(snapshot).exists
    ) {
      return null;
    }
    return this.#bundles(manifest, projectId);
  }

  async store(draft: ProjectSourceSnapshotDraft, locale: AppLocale = "zh-CN") {
    const directoryName = `${draft.id}-${Crypto.randomUUID()}`;
    const stored: StoredSourceSnapshot = {
      id: draft.id,
      directoryName,
      projectId: draft.projectId,
      connectionId: draft.connectionId,
      reportConnectionId: draft.reportConnectionId,
      reportResourceId: draft.reportResourceId,
      reportPath: draft.reportPath,
      sourceKind: draft.sourceKind,
      sourceKey: draft.sourceKey,
      sourceLabel: draft.sourceLabel,
      mountPath: draft.mountPath,
      revision: draft.revision,
      versionLabel: draft.versionLabel,
      contentSha256: draft.contentSha256,
      importedAt: draft.importedAt,
      manifestPath: draft.manifestPath,
      files: draft.files.map(({ content: _content, ...file }) => file),
    };
    const current = await this.#readManifest();
    const replacedSnapshots = current.snapshots.filter(
      (candidate) =>
        candidate.projectId === draft.projectId &&
        candidate.sourceKind === draft.sourceKind &&
        candidate.sourceKey === draft.sourceKey,
    );
    const next: SourceManifest = {
      version: MANIFEST_VERSION,
      snapshots: [
        ...current.snapshots.filter(
          (candidate) =>
            candidate.projectId !== draft.projectId ||
            candidate.sourceKind !== draft.sourceKind ||
            candidate.sourceKey !== draft.sourceKey,
        ),
        stored,
      ],
    };
    parseManifest(next);
    for (const source of draft.files) {
      const bytes = new TextEncoder().encode(source.content).byteLength;
      if (
        bytes !== source.byteLength ||
        (await expoDigest.text(source.content)) !== source.version
      ) {
        throw new Error("项目来源快照包含不匹配的文件校验信息。");
      }
    }

    const snapshotDirectory = new Directory(this.#snapshots, directoryName);
    const fileDirectory = new Directory(snapshotDirectory, "files");
    const reportDirectory = new Directory(
      this.#reports,
      draft.reportConnectionId,
    );
    const reportFile = new File(
      reportDirectory,
      `${draft.reportResourceId}.md`,
    );
    let reportCreated = false;
    try {
      this.#root.create({ idempotent: true, intermediates: true });
      this.#snapshots.create({ idempotent: true, intermediates: true });
      this.#reports.create({ idempotent: true, intermediates: true });
      fileDirectory.create({ intermediates: true });
      for (const source of draft.files) {
        const file = new File(fileDirectory, `${source.id}.txt`);
        file.create();
        file.write(source.content);
      }
      reportDirectory.create({ idempotent: true, intermediates: true });
      if (!reportFile.exists) {
        reportFile.create();
        reportCreated = true;
        reportFile.write(reportTemplate(draft, locale));
      }
      await this.#writeManifest(next);
      for (const replaced of replacedSnapshots) {
        try {
          const replacedDirectory = new Directory(
            this.#snapshots,
            replaced.directoryName,
          );
          if (replacedDirectory.exists) replacedDirectory.delete();
        } catch {
          // The new manifest is already durable. Orphan cleanup is best-effort.
        }
      }
    } catch (error) {
      if (snapshotDirectory.exists) snapshotDirectory.delete();
      if (reportCreated && reportFile.exists) reportFile.delete();
      throw error;
    }
    return this.#bundles(next, draft.projectId);
  }

  async #readManifest(): Promise<SourceManifest> {
    if (!this.#manifest.exists) {
      return { version: MANIFEST_VERSION, snapshots: [] };
    }
    if (this.#manifest.size > MAX_MANIFEST_BYTES) {
      throw new Error("项目来源快照清单超过安全上限。");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.#manifest.text()) as unknown;
    } catch {
      throw new Error("项目来源快照清单无法读取。");
    }
    return parseManifest(parsed);
  }

  async #writeManifest(manifest: SourceManifest) {
    parseManifest(manifest);
    const serialized = JSON.stringify(manifest);
    if (new TextEncoder().encode(serialized).byteLength > MAX_MANIFEST_BYTES) {
      throw new Error("项目来源快照清单超过安全上限。");
    }
    this.#root.create({ idempotent: true, intermediates: true });
    const temporary = new File(
      this.#root,
      `manifest-${Crypto.randomUUID()}.tmp`,
    );
    temporary.create();
    try {
      temporary.write(serialized);
      await temporary.move(this.#manifest, { overwrite: true });
    } catch (error) {
      if (temporary.exists) temporary.delete();
      throw error;
    }
  }

  #sourceFile(snapshot: StoredSourceSnapshot, resourceId: string) {
    return new File(
      this.#snapshots,
      snapshot.directoryName,
      "files",
      `${resourceId}.txt`,
    );
  }

  #reportFile(snapshot: StoredSourceSnapshot) {
    return new File(
      this.#reports,
      snapshot.reportConnectionId,
      `${snapshot.reportResourceId}.md`,
    );
  }

  #snapshotFilesExist(snapshot: StoredSourceSnapshot) {
    return snapshot.files.every((file) => {
      const stored = this.#sourceFile(snapshot, file.id);
      return stored.exists && stored.size === file.byteLength;
    });
  }

  async #bundles(manifest: SourceManifest, projectId?: string) {
    const snapshots = manifest.snapshots.filter(
      (snapshot) => !projectId || snapshot.projectId === projectId,
    );
    const sourceBundles: ProjectResourceBundle[] = snapshots.map((snapshot) => {
      const connected = this.#snapshotFilesExist(snapshot);
      return {
        connection: sourceConnection(snapshot, connected),
        resources: connected
          ? snapshot.files.map<WorkspaceResource>((file) => ({
              id: file.id,
              projectId: snapshot.projectId,
              connectionId: snapshot.connectionId,
              path: `${snapshot.mountPath}/${file.path}`,
              content: "",
              version: file.version,
              storage: {
                kind: "source-file",
                locator: this.#sourceFile(snapshot, file.id).uri,
                snapshotId: snapshot.id,
                sourceKind: snapshot.sourceKind,
                sourceLabel: snapshot.sourceLabel,
                mountPath: snapshot.mountPath,
                revision: snapshot.revision,
                versionLabel: snapshot.versionLabel,
                manifestPath: snapshot.manifestPath,
                access: "persistent",
              },
            }))
          : [],
      };
    });

    const byProject = new Map<string, StoredSourceSnapshot[]>();
    for (const snapshot of snapshots) {
      const group = byProject.get(snapshot.projectId) ?? [];
      group.push(snapshot);
      byProject.set(snapshot.projectId, group);
    }
    const reportBundles: ProjectResourceBundle[] = [];
    for (const [currentProjectId, projectSnapshots] of byProject) {
      const resources: WorkspaceResource[] = [];
      for (const snapshot of projectSnapshots) {
        const report = this.#reportFile(snapshot);
        if (!report.exists) continue;
        const content = await report.text();
        if (content.includes("\0") || content.length > 100_000) continue;
        resources.push({
          id: snapshot.reportResourceId,
          projectId: snapshot.projectId,
          connectionId: snapshot.reportConnectionId,
          path: snapshot.reportPath,
          content,
          version: await expoDigest.text(content),
          storage: {
            kind: "native-file",
            locator: report.uri,
            access: "persistent",
          },
        });
      }
      const connectionId = projectSnapshots[0]!.reportConnectionId;
      reportBundles.push({
        connection: {
          id: connectionId,
          projectId: currentProjectId,
          name: "项目分析报告",
          account: "BoltPocket本机",
          scope: "reports",
          status: resources.length > 0 ? "connected" : "attention",
          resourceCount: resources.length,
          access: "persistent",
          writeMode: "recoverable",
          verification: "统一文字 Diff + 本机恢复点",
        },
        resources,
      });
    }
    return [...sourceBundles, ...reportBundles];
  }
}

class ExpoSourceTextStorage implements LocalTextStoragePort {
  readonly #resources = new Map<string, WorkspaceResource>();

  constructor(resources: readonly WorkspaceResource[]) {
    for (const resource of resources) {
      if (resource.storage.kind !== "source-file") {
        throw new ConnectorError(
          "unsupported",
          "Source storage accepts only source-file resources.",
        );
      }
      this.#resources.set(resource.storage.locator, resource);
    }
  }

  async read(locator: string): Promise<LocalTextStorageEntry> {
    const resource = this.#resources.get(locator);
    if (!resource) {
      throw new ConnectorError(
        "permission_denied",
        "Source file is outside the imported snapshot.",
      );
    }
    const text = await new File(locator).text();
    if (
      text.includes("\0") ||
      new TextEncoder().encode(text).byteLength >
        PUBLIC_GITHUB_SOURCE_LIMITS.maxSourceFileBytes
    ) {
      throw new ConnectorError(
        "io_failure",
        "Imported source file is invalid.",
      );
    }
    const version = await expoDigest.text(text);
    if (version !== resource.version) {
      throw new ConnectorError(
        "conflict",
        "Imported source snapshot no longer matches its recorded checksum.",
      );
    }
    return { locator, text, version };
  }

  async createRecoveryPoint(
    _locator: string,
    _snapshot: LocalTextStorageEntry,
  ): Promise<StoredRecoveryPoint> {
    throw new ConnectorError("unsupported", "Imported source is read-only.");
  }

  async replaceWithRecovery(
    _locator: string,
    _expectedVersion: string,
    _text: string,
  ): Promise<LocalTextStorageEntry> {
    throw new ConnectorError("unsupported", "Imported source is read-only.");
  }
}

export function createExpoSourceTextStorage(
  resources: readonly WorkspaceResource[],
) {
  return new ExpoSourceTextStorage(resources);
}

export class ExpoProjectSourceSnapshotService implements ProjectSourceSnapshotService {
  readonly #store: ProjectSourceSnapshotStore;
  readonly #publicGitHub: PublicGitHubSourceAdapter;

  constructor(fetchImplementation: typeof fetch = fetch) {
    const store = new ExpoProjectSourceSnapshotStore();
    this.#store = store;
    this.#publicGitHub = new PublicGitHubSourceAdapter({
      http: new ExpoPublicGitHubSourceHttp(fetchImplementation),
      digest: expoDigest,
      store,
    });
  }

  load() {
    return this.#store.load();
  }

  importSource(
    input: Parameters<ProjectSourceSnapshotService["importSource"]>[0],
  ) {
    switch (input.source.kind) {
      case "github-public":
        return this.#publicGitHub.import({
          project: input.project,
          url: input.source.url,
          locale: input.locale,
          signal: input.signal,
          onProgress: input.onProgress,
        });
    }
  }
}
