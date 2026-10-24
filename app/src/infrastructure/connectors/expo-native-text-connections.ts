import * as Crypto from "expo-crypto";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { Platform } from "react-native";

import type {
  NativeTextConnectionBundle,
  NativeTextConnectionService,
} from "@/application/ports/native-text-connections";
import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";
import {
  RecoverableNativeTextStorage,
  type NativeTextFilePort,
} from "@/infrastructure/connectors/recoverable-native-text-storage";

const MAX_TEXT_LENGTH = 100_000;
const SUPPORTED_FILE_NAME = /\.(?:txt|md|markdown|json|csv|ya?ml)$/iu;
const MANIFEST_VERSION = 1;

type PersistedResource = Omit<WorkspaceResource, "content" | "version">;

type PersistedBundle = {
  connection: ConnectionItem;
  resources: PersistedResource[];
};

type NativeConnectionManifest = {
  version: typeof MANIFEST_VERSION;
  bundles: PersistedBundle[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isConnection(value: unknown): value is ConnectionItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.name === "string" &&
    typeof value.account === "string" &&
    typeof value.scope === "string" &&
    (value.status === "connected" || value.status === "attention") &&
    typeof value.resourceCount === "number" &&
    (value.access === "persistent" || value.access === "session") &&
    value.writeMode === "recoverable"
  );
}

function isPersistedResource(value: unknown): value is PersistedResource {
  if (!isRecord(value) || !isRecord(value.storage)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.connectionId === "string" &&
    typeof value.path === "string" &&
    value.storage.kind === "native-file" &&
    typeof value.storage.locator === "string" &&
    (value.storage.access === "persistent" ||
      value.storage.access === "session")
  );
}

function parseManifest(value: unknown): NativeConnectionManifest {
  if (
    !isRecord(value) ||
    value.version !== MANIFEST_VERSION ||
    !Array.isArray(value.bundles)
  ) {
    return { version: MANIFEST_VERSION, bundles: [] };
  }
  const bundles = value.bundles.flatMap<PersistedBundle>((candidate) => {
    if (!isRecord(candidate) || !isConnection(candidate.connection)) return [];
    if (
      !Array.isArray(candidate.resources) ||
      !candidate.resources.every(isPersistedResource)
    ) {
      return [];
    }
    return [
      {
        connection: candidate.connection,
        resources: candidate.resources,
      },
    ];
  });
  return { version: MANIFEST_VERSION, bundles };
}

function decodedLeaf(uri: string, fallback: string) {
  try {
    const decoded = decodeURIComponent(uri.split(/[?#]/u)[0] ?? uri);
    return decoded.split("/").filter(Boolean).at(-1) ?? fallback;
  } catch {
    return fallback;
  }
}

async function versionText(text: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}

class ExpoNativeTextFiles implements NativeTextFilePort {
  readonly #recoveryDirectory = new Directory(
    Paths.document,
    "boltpocket",
    "recoveries",
  );

  async readText(locator: string) {
    return new File(locator).text();
  }

  async writeText(locator: string, text: string) {
    const handle = new File(locator).open(FileMode.Truncate);
    try {
      handle.writeBytes(new TextEncoder().encode(text));
    } finally {
      handle.close();
    }
  }

  async persistRecovery(
    locator: string,
    snapshot: { text: string; version: string },
  ) {
    this.#recoveryDirectory.create({ idempotent: true, intermediates: true });
    const recovery = new File(
      this.#recoveryDirectory,
      `${Crypto.randomUUID()}.json`,
    );
    recovery.create();
    recovery.write(
      JSON.stringify({
        locator,
        version: snapshot.version,
        text: snapshot.text,
        createdAt: new Date().toISOString(),
      }),
    );
    return recovery.uri;
  }
}

const nativeFiles = new ExpoNativeTextFiles();

export function createExpoNativeTextStorage(resources: WorkspaceResource[]) {
  const locators = resources.flatMap((resource) =>
    resource.storage.kind === "native-file" ? [resource.storage.locator] : [],
  );
  return new RecoverableNativeTextStorage({
    allowedLocators: locators,
    files: nativeFiles,
    versionText,
  });
}

export class ExpoNativeTextConnectionService implements NativeTextConnectionService {
  readonly #manifestDirectory = new Directory(Paths.document, "boltpocket");
  readonly #manifestFile = new File(
    this.#manifestDirectory,
    "connections.json",
  );

  async load(): Promise<NativeTextConnectionBundle[]> {
    const manifest = await this.#readManifest();
    const bundles: NativeTextConnectionBundle[] = [];
    for (const bundle of manifest.bundles) {
      if (bundle.connection.access === "session") {
        bundles.push({
          connection: { ...bundle.connection, status: "attention" },
          resources: [],
        });
        continue;
      }
      try {
        const resources = await this.#hydrateResources(bundle.resources);
        bundles.push({
          connection: { ...bundle.connection, status: "connected" },
          resources,
        });
      } catch {
        bundles.push({
          connection: { ...bundle.connection, status: "attention" },
          resources: [],
        });
      }
    }
    return bundles;
  }

  async connect(project: Project): Promise<NativeTextConnectionBundle | null> {
    let directory: Directory;
    try {
      directory = await Directory.pickDirectoryAsync();
    } catch (error) {
      if (
        error instanceof Error &&
        /cancelled|canceled|取消/iu.test(error.message)
      ) {
        return null;
      }
      throw error;
    }

    const files = directory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => ({
        file,
        name: decodedLeaf(file.uri, file.name),
      }))
      .filter(({ name }) => SUPPORTED_FILE_NAME.test(name));
    if (files.length === 0) {
      throw new Error(
        "所选文件夹没有可连接的 TXT、Markdown、JSON、CSV 或 YAML 文件。",
      );
    }

    const access = Platform.OS === "android" ? "persistent" : "session";
    const directoryKey = await versionText(`${project.id}\0${directory.uri}`);
    const connectionId = `device-text-${directoryKey.slice(0, 16)}`;
    const scope = decodedLeaf(directory.uri, "已选文件夹");
    const resources: WorkspaceResource[] = [];
    for (const { file, name } of files) {
      const content = await file.text();
      if (content.length > MAX_TEXT_LENGTH) {
        throw new Error(`${name} 超过当前 100,000 字符的安全读取上限。`);
      }
      if (content.includes("\0")) {
        throw new Error(`${name} 看起来不是纯文本资源。`);
      }
      const resourceKey = await versionText(`${project.id}\0${file.uri}`);
      resources.push({
        id: `native-text-${resourceKey.slice(0, 20)}`,
        projectId: project.id,
        connectionId,
        path: `${scope}/${name}`,
        content,
        version: await versionText(content),
        storage: {
          kind: "native-file",
          locator: file.uri,
          access,
        },
      });
    }

    const bundle: NativeTextConnectionBundle = {
      connection: {
        id: connectionId,
        projectId: project.id,
        name: "设备文本资源",
        account: Platform.OS === "android" ? "Android SAF" : "iOS Files",
        scope,
        status: "connected",
        resourceCount: resources.length,
        access,
        writeMode: "recoverable",
      },
      resources,
    };
    await this.#persistBundle(bundle);
    return bundle;
  }

  async refresh(resources: WorkspaceResource[]) {
    return Promise.all(
      resources.map(async (resource) => {
        if (resource.storage.kind !== "native-file") return resource;
        const content = await nativeFiles.readText(resource.storage.locator);
        if (content.length > MAX_TEXT_LENGTH || content.includes("\0")) {
          throw new Error(`${resource.path} 不再是受支持的文本资源。`);
        }
        return { ...resource, content, version: await versionText(content) };
      }),
    );
  }

  async #hydrateResources(resources: PersistedResource[]) {
    return this.refresh(
      resources.map((resource) => ({
        ...resource,
        content: "",
        version: "",
      })),
    );
  }

  async #readManifest(): Promise<NativeConnectionManifest> {
    if (!this.#manifestFile.exists) {
      return { version: MANIFEST_VERSION, bundles: [] };
    }
    try {
      return parseManifest(JSON.parse(await this.#manifestFile.text()));
    } catch {
      return { version: MANIFEST_VERSION, bundles: [] };
    }
  }

  async #persistBundle(bundle: NativeTextConnectionBundle) {
    const manifest = await this.#readManifest();
    const persisted: PersistedBundle = {
      connection: bundle.connection,
      resources: bundle.resources.map(
        ({ content: _content, version: _version, ...resource }) => resource,
      ),
    };
    const next: NativeConnectionManifest = {
      version: MANIFEST_VERSION,
      bundles: [
        ...manifest.bundles.filter(
          (candidate) => candidate.connection.id !== bundle.connection.id,
        ),
        persisted,
      ],
    };
    this.#manifestDirectory.create({ idempotent: true, intermediates: true });
    const temporary = new File(
      this.#manifestDirectory,
      `connections-${Crypto.randomUUID()}.tmp`,
    );
    temporary.create();
    temporary.write(JSON.stringify(next));
    await temporary.move(this.#manifestFile, { overwrite: true });
  }
}
