import { ConnectorError } from "@boltpocket/connector-core";
import {
  googleSpreadsheetResourceUrl,
  parseGoogleSpreadsheetResourceKey,
} from "@boltpocket/connector-google-sheets";
import { googlePresentationUrl } from "@boltpocket/connector-google-slides";
import type {
  GoogleWorkspaceRecoverySnapshot,
  GoogleWorkspaceTextSnapshot,
} from "@boltpocket/connector-google-workspace";

import type {
  GoogleWorkspaceConnectionApi,
  GoogleWorkspaceConnectionBundle,
  GoogleWorkspaceConnectionKind,
  GoogleWorkspaceResourceConnectionService,
} from "@/application/ports/google-workspace-connections";
import type {
  GoogleDocsAuthorizedAccount,
  GoogleDocsAuthorizationPort,
  GoogleDocsConnectionCryptoPort,
} from "@/application/ports/google-docs-connections";
import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";
import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";

const MANIFEST_VERSION = 1;
const MAX_CONNECTIONS = 500;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,240}$/u;

type StoredGoogleWorkspaceResource = {
  connectionId: string;
  resourceId: string;
  projectId: string;
  accountId: string;
  accountLabel: string;
  providerResourceId: string;
  title: string;
  writable: boolean;
  trashable: boolean;
  restorable: boolean;
  trashed: boolean;
};

type StoredGoogleAccountBinding = {
  connectionId: string;
  projectId: string;
  accountId: string;
  accountLabel: string;
};

type GoogleWorkspaceManifest = {
  version: typeof MANIFEST_VERSION;
  accounts: StoredGoogleAccountBinding[];
  resources: StoredGoogleWorkspaceResource[];
};

type CreationIntent = {
  version: 1;
  provider: "google-sheets" | "google-slides";
  status: "prepared" | "started" | "completed";
  operationId: string;
  accountId: string;
  projectId: string;
  connectionId?: string;
  resourceId?: string;
  title: string;
  providerResourceId?: string;
  createdAt: string;
};

type Profile = {
  kind: GoogleWorkspaceConnectionKind;
  provider: CreationIntent["provider"];
  connectionPrefix: string;
  resourcePrefix: string;
  manifestKey: string;
  recoveryPrefix: string;
  creationPrefix: string;
  connectionName: string;
  countNoun: string;
  fallbackTitle: string;
  extension: string;
};

function profile(kind: GoogleWorkspaceConnectionKind): Profile {
  if (kind === "sheets") {
    return {
      kind,
      provider: "google-sheets",
      connectionPrefix: "google-sheets",
      resourcePrefix: "google-sheet",
      manifestKey: "google-sheets:manifest:v1",
      recoveryPrefix: "google-sheets:recovery:",
      creationPrefix: "google-sheets:create:",
      connectionName: "Google 表格",
      countNoun: "份表格",
      fallbackTitle: "Google 表格",
      extension: ".csv",
    };
  }
  return {
    kind,
    provider: "google-slides",
    connectionPrefix: "google-slides",
    resourcePrefix: "google-slide",
    manifestKey: "google-slides:manifest:v1",
    recoveryPrefix: "google-slides:recovery:",
    creationPrefix: "google-slides:create:",
    connectionName: "Google 幻灯片",
    countNoun: "份演示文稿",
    fallbackTitle: "Google 幻灯片",
    extension: ".slides.json",
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function canonicalLocator(
  kind: GoogleWorkspaceConnectionKind,
  resourceId: string,
) {
  return kind === "sheets"
    ? googleSpreadsheetResourceUrl(resourceId)
    : googlePresentationUrl(resourceId);
}

function validProviderResourceId(
  kind: GoogleWorkspaceConnectionKind,
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  try {
    canonicalLocator(kind, value);
    return true;
  } catch {
    return false;
  }
}

function validStoredResource(
  kind: GoogleWorkspaceConnectionKind,
  value: unknown,
): value is StoredGoogleWorkspaceResource {
  if (!record(value)) return false;
  return (
    typeof value.connectionId === "string" &&
    SAFE_ID.test(value.connectionId) &&
    typeof value.resourceId === "string" &&
    SAFE_ID.test(value.resourceId) &&
    safeText(value.projectId, 240) &&
    safeText(value.accountId, 240) &&
    safeText(value.accountLabel, 320) &&
    validProviderResourceId(kind, value.providerResourceId) &&
    safeText(value.title, 1_000) &&
    typeof value.writable === "boolean" &&
    (value.trashable === undefined || typeof value.trashable === "boolean") &&
    (value.restorable === undefined || typeof value.restorable === "boolean") &&
    (value.trashed === undefined || typeof value.trashed === "boolean")
  );
}

function validStoredAccount(
  value: unknown,
): value is StoredGoogleAccountBinding {
  if (!record(value)) return false;
  return (
    typeof value.connectionId === "string" &&
    SAFE_ID.test(value.connectionId) &&
    safeText(value.projectId, 240) &&
    safeText(value.accountId, 240) &&
    safeText(value.accountLabel, 320)
  );
}

function accountFromResource(
  resource: StoredGoogleWorkspaceResource,
): StoredGoogleAccountBinding {
  return {
    connectionId: resource.connectionId,
    projectId: resource.projectId,
    accountId: resource.accountId,
    accountLabel: resource.accountLabel,
  };
}

function parseManifest(
  kind: GoogleWorkspaceConnectionKind,
  value: string | undefined,
): GoogleWorkspaceManifest {
  if (value === undefined) {
    return { version: MANIFEST_VERSION, accounts: [], resources: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw invalidManifest(kind);
  }
  if (
    !record(parsed) ||
    parsed.version !== MANIFEST_VERSION ||
    (parsed.accounts !== undefined && !Array.isArray(parsed.accounts)) ||
    !Array.isArray(parsed.resources) ||
    parsed.resources.length > MAX_CONNECTIONS ||
    (Array.isArray(parsed.accounts) &&
      parsed.accounts.length > MAX_CONNECTIONS) ||
    (Array.isArray(parsed.accounts) &&
      !parsed.accounts.every(validStoredAccount)) ||
    !parsed.resources.every((item) => validStoredResource(kind, item))
  ) {
    throw invalidManifest(kind);
  }
  const resources = (parsed.resources as StoredGoogleWorkspaceResource[]).map(
    (item) => ({
      ...item,
      trashable: item.trashable ?? false,
      restorable: item.restorable ?? false,
      trashed: item.trashed ?? false,
    }),
  );
  const accounts = [
    ...((parsed.accounts ?? []) as StoredGoogleAccountBinding[]),
  ];
  for (const resource of resources) {
    const account = accountFromResource(resource);
    const existing = accounts.find(
      (candidate) => candidate.connectionId === account.connectionId,
    );
    if (!existing) {
      accounts.push(account);
      continue;
    }
    if (
      existing.projectId !== account.projectId ||
      existing.accountId !== account.accountId ||
      existing.accountLabel !== account.accountLabel
    ) {
      throw invalidManifest(kind);
    }
  }
  if (
    new Set(accounts.map((account) => account.connectionId)).size !==
      accounts.length ||
    new Set(
      accounts.map((account) => `${account.projectId}\0${account.accountId}`),
    ).size !== accounts.length ||
    new Set(resources.map((item) => item.resourceId)).size !==
      resources.length ||
    new Set(
      resources.map((item) => `${item.projectId}\0${item.providerResourceId}`),
    ).size !== resources.length ||
    resources.some((item) =>
      resources.some(
        (candidate) =>
          candidate.connectionId === item.connectionId &&
          (candidate.projectId !== item.projectId ||
            candidate.accountId !== item.accountId ||
            candidate.accountLabel !== item.accountLabel),
      ),
    )
  ) {
    throw invalidManifest(kind);
  }
  return {
    version: MANIFEST_VERSION,
    accounts: accounts.sort((left, right) =>
      left.connectionId.localeCompare(right.connectionId, "en"),
    ),
    resources,
  };
}

function safePath(title: string, current: Profile) {
  const leaf = title
    .normalize("NFC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "-")
    .trim()
    .slice(0, 160);
  return `${leaf || current.fallbackTitle}${current.extension}`;
}

function connection(
  current: Profile,
  account: StoredGoogleAccountBinding,
  resources: readonly StoredGoogleWorkspaceResource[],
  connected: boolean,
  snapshots: readonly GoogleWorkspaceTextSnapshot[] = [],
): ConnectionItem {
  const writable =
    connected &&
    (snapshots.length === 0 ||
      snapshots.every((snapshot) => snapshot.writable && !snapshot.trashed));
  return {
    id: account.connectionId,
    projectId: account.projectId,
    name: current.connectionName,
    accountId: account.accountId,
    account: account.accountLabel,
    scope:
      resources.length === 0
        ? "已授权，可新建或粘贴链接"
        : resources.length === 1
          ? (snapshots[0]?.title ?? resources[0]!.title)
          : `${resources.length} ${current.countNoun}`,
    status: connected ? "connected" : "attention",
    resourceCount: connected ? resources.length : 0,
    access: "persistent",
    writeMode: writable ? "recoverable" : "read-only",
  };
}

function workspaceResource(
  current: Profile,
  stored: StoredGoogleWorkspaceResource,
  snapshot: GoogleWorkspaceTextSnapshot,
): WorkspaceResource {
  const common = {
    locator: canonicalLocator(current.kind, stored.providerResourceId),
    accountId: stored.accountId,
    accountLabel: stored.accountLabel,
    writable: snapshot.writable,
    trashable: snapshot.trashable ?? false,
    restorable: snapshot.restorable ?? false,
    trashed: snapshot.trashed ?? false,
    access: "persistent" as const,
  };
  const storage: WorkspaceResource["storage"] =
    current.kind === "sheets"
      ? {
          kind: "google-sheet",
          ...common,
          ...parseGoogleSpreadsheetResourceKey(stored.providerResourceId),
        }
      : {
          kind: "google-slide",
          ...common,
          presentationId: stored.providerResourceId,
        };
  return {
    id: stored.resourceId,
    projectId: stored.projectId,
    connectionId: stored.connectionId,
    path: safePath(snapshot.title, current),
    content: snapshot.text,
    version: snapshot.version,
    storage,
  };
}

export class ExpoGoogleWorkspaceResourceConnectionService implements GoogleWorkspaceResourceConnectionService {
  readonly #store: DurableDocumentStore;
  readonly #authorization: GoogleDocsAuthorizationPort;
  readonly #crypto: GoogleDocsConnectionCryptoPort;
  readonly #api: GoogleWorkspaceConnectionApi;
  readonly #profile: Profile;

  constructor(input: {
    kind: GoogleWorkspaceConnectionKind;
    store: DurableDocumentStore;
    authorization: GoogleDocsAuthorizationPort;
    crypto: GoogleDocsConnectionCryptoPort;
    api: GoogleWorkspaceConnectionApi;
  }) {
    this.#profile = profile(input.kind);
    this.#store = input.store;
    this.#authorization = input.authorization;
    this.#crypto = input.crypto;
    this.#api = input.api;
  }

  async load(): Promise<GoogleWorkspaceConnectionBundle[]> {
    const manifest = await this.#manifest();
    const session = await this.#authorization.restore();
    return Promise.all(
      manifest.accounts.map(async (account) => {
        const resources = manifest.resources.filter(
          (resource) => resource.connectionId === account.connectionId,
        );
        if (!session || session.account.id !== account.accountId) {
          return {
            connection: connection(this.#profile, account, resources, false),
            resources: [],
          };
        }
        try {
          const snapshots = await Promise.all(
            resources.map((stored) =>
              this.#api.readResource(
                stored.accountId,
                stored.providerResourceId,
              ),
            ),
          );
          return {
            connection: connection(
              this.#profile,
              account,
              resources,
              true,
              snapshots,
            ),
            resources: resources.map((stored, index) =>
              workspaceResource(this.#profile, stored, snapshots[index]!),
            ),
          };
        } catch {
          return {
            connection: connection(this.#profile, account, resources, false),
            resources: [],
          };
        }
      }),
    );
  }

  async connectAccount(project: Project, account: GoogleDocsAuthorizedAccount) {
    this.#assertAccount(account);
    const connectionDigest = await this.#crypto.sha256(
      `${project.id}\0${account.id}`,
    );
    const stored: StoredGoogleAccountBinding = {
      connectionId: `${this.#profile.connectionPrefix}-${connectionDigest.slice(0, 20)}`,
      projectId: project.id,
      accountId: account.id,
      accountLabel: account.label,
    };
    await this.#upsertAccount(stored);
    return this.#loadBundle(stored.connectionId);
  }

  async connect(project: Project, resourceUrl: string) {
    const restored = await this.#authorization.restore();
    let session = restored ?? (await this.#authorization.connect());
    if (!session) return null;
    this.#assertAccount(session.account);
    let snapshot: GoogleWorkspaceTextSnapshot;
    try {
      snapshot = await this.#api.resolveResource(
        session.account.id,
        resourceUrl,
      );
    } catch (error) {
      if (
        restored === null ||
        !(error instanceof ConnectorError) ||
        error.code !== "permission_denied"
      ) {
        throw error;
      }
      const reauthorized = await this.#authorization.connect(true);
      if (!reauthorized) return null;
      session = reauthorized;
      snapshot = await this.#api.resolveResource(
        session.account.id,
        resourceUrl,
      );
    }
    if (!validProviderResourceId(this.#profile.kind, snapshot.resourceId)) {
      throw new ConnectorError(
        "io_failure",
        `${this.#profile.connectionName}返回了无效资源标识。`,
      );
    }
    const connectionDigest = await this.#crypto.sha256(
      `${project.id}\0${session.account.id}`,
    );
    const digest = await this.#crypto.sha256(
      `${project.id}\0${snapshot.resourceId}`,
    );
    const stored: StoredGoogleWorkspaceResource = {
      connectionId: `${this.#profile.connectionPrefix}-${connectionDigest.slice(0, 20)}`,
      resourceId: `${this.#profile.resourcePrefix}-${digest.slice(0, 24)}`,
      projectId: project.id,
      accountId: session.account.id,
      accountLabel: session.account.label,
      providerResourceId: snapshot.resourceId,
      title: snapshot.title,
      writable: snapshot.writable,
      trashable: snapshot.trashable ?? false,
      restorable: snapshot.restorable ?? false,
      trashed: snapshot.trashed ?? false,
    };
    await this.#upsertStored(stored);
    const bundle = await this.#loadBundle(stored.connectionId);
    return { ...bundle, focusedResourceId: stored.resourceId };
  }

  async refresh(resources: WorkspaceResource[]) {
    return Promise.all(
      resources.map(async (current) => {
        if (
          (this.#profile.kind === "sheets" &&
            current.storage.kind !== "google-sheet") ||
          (this.#profile.kind === "slides" &&
            current.storage.kind !== "google-slide")
        ) {
          return current;
        }
        if (
          current.storage.kind !== "google-sheet" &&
          current.storage.kind !== "google-slide"
        ) {
          return current;
        }
        const providerResourceId = this.#providerResourceId(current);
        if (!providerResourceId) return current;
        const snapshot = await this.#api.readResource(
          current.storage.accountId,
          providerResourceId,
        );
        return {
          ...current,
          path: safePath(snapshot.title, this.#profile),
          content: snapshot.text,
          version: snapshot.version,
          storage: {
            ...current.storage,
            writable: snapshot.writable,
            trashable: snapshot.trashable ?? current.storage.trashable,
            restorable: snapshot.restorable ?? current.storage.restorable,
            trashed: snapshot.trashed ?? current.storage.trashed,
          },
        };
      }),
    );
  }

  readResource(accountId: string, resourceId: string) {
    return this.#api.readResource(accountId, resourceId);
  }

  replaceResource(
    input: Parameters<GoogleWorkspaceConnectionApi["replaceResource"]>[0],
  ) {
    return this.#api.replaceResource(input);
  }

  setResourceTrashed(
    input: Parameters<
      NonNullable<GoogleWorkspaceConnectionApi["setResourceTrashed"]>
    >[0],
  ) {
    if (!this.#api.setResourceTrashed) {
      throw new ConnectorError(
        "unsupported",
        `${this.#profile.connectionName}不支持移入回收站。`,
      );
    }
    return this.#api.setResourceTrashed(input);
  }

  async createRecoveryPoint(snapshot: GoogleWorkspaceRecoverySnapshot) {
    const storageRef = `${this.#profile.recoveryPrefix}${this.#crypto.randomUUID()}`;
    await this.#store.write(
      storageRef,
      JSON.stringify({
        accountId: snapshot.accountId,
        providerResourceId: snapshot.resourceId,
        title: snapshot.title,
        text: snapshot.text,
        version: snapshot.version,
        metadata: snapshot.metadata ?? {},
        createdAt: new Date().toISOString(),
      }),
    );
    return { storageRef, version: snapshot.version };
  }

  async createCreationRecoveryPoint(input: {
    accountId: string;
    operationId: string;
    projectId: string;
    title: string;
  }) {
    const storageRef = this.#creationKey(input.operationId);
    const existing = await this.#creationIntent(storageRef);
    if (existing) {
      this.#assertSameCreation(existing, input);
      return { storageRef, version: "absent" };
    }
    const intent: CreationIntent = {
      version: 1,
      provider: this.#profile.provider,
      status: "prepared",
      ...input,
      createdAt: new Date().toISOString(),
    };
    await this.#store.write(storageRef, JSON.stringify(intent));
    return { storageRef, version: "absent" };
  }

  async createResource(
    input: Parameters<
      NonNullable<GoogleWorkspaceConnectionApi["createResource"]>
    >[0],
  ) {
    if (!this.#api.createResource) {
      throw new ConnectorError(
        "unsupported",
        `${this.#profile.connectionName}不支持新建。`,
      );
    }
    const storageRef = this.#creationKey(input.operationId);
    const intent = await this.#creationIntent(storageRef);
    if (!intent) {
      throw new ConnectorError(
        "recovery_failed",
        `缺少${this.#profile.connectionName}新建恢复意图，已取消写入。`,
      );
    }
    this.#assertSameCreation(intent, input);
    if (
      (intent.connectionId && intent.connectionId !== input.connectionId) ||
      (intent.resourceId && intent.resourceId !== input.resourceId)
    ) {
      throw new ConnectorError(
        "permission_denied",
        `${this.#profile.connectionName}新建目标绑定不一致。`,
      );
    }
    if (intent.status === "started") {
      throw new ConnectorError(
        "io_failure",
        `${this.#profile.connectionName}新建结果未知；为避免重复文件，客户端不会自动重试。`,
      );
    }
    if (intent.status === "completed") {
      if (!intent.providerResourceId) throw this.#invalidCreationIntent();
      await this.#ensureCreatedBinding(input, intent.providerResourceId);
      return this.#api.readResource(input.accountId, intent.providerResourceId);
    }
    await this.#store.write(
      storageRef,
      JSON.stringify({
        ...intent,
        status: "started",
        connectionId: input.connectionId,
        resourceId: input.resourceId,
      } satisfies CreationIntent),
    );
    const created = await this.#api.createResource(input);
    if (!validProviderResourceId(this.#profile.kind, created.resourceId)) {
      throw new ConnectorError(
        "io_failure",
        `${this.#profile.connectionName}已请求创建，但返回的资源标识无效；不会自动重试。`,
      );
    }
    await this.#store.write(
      storageRef,
      JSON.stringify({
        ...intent,
        status: "completed",
        connectionId: input.connectionId,
        resourceId: input.resourceId,
        providerResourceId: created.resourceId,
      } satisfies CreationIntent),
    );
    await this.#ensureCreatedBinding(input, created.resourceId, created);
    return created;
  }

  async #ensureCreatedBinding(
    input: Parameters<
      NonNullable<GoogleWorkspaceConnectionApi["createResource"]>
    >[0],
    providerResourceId: string,
    known?: GoogleWorkspaceTextSnapshot,
  ) {
    const manifest = await this.#manifest();
    const sameResource = manifest.resources.find(
      (resource) => resource.resourceId === input.resourceId,
    );
    if (
      sameResource &&
      sameResource.providerResourceId !== providerResourceId
    ) {
      throw new ConnectorError(
        "permission_denied",
        `${this.#profile.connectionName}资源 ID 已绑定其他文件。`,
      );
    }
    if (sameResource) return;
    const session = await this.#authorization.restore();
    if (!session || session.account.id !== input.accountId) {
      throw new ConnectorError("not_connected", "Google 授权已过期。");
    }
    const snapshot =
      known ??
      (await this.#api.readResource(input.accountId, providerResourceId));
    await this.#upsertStored({
      connectionId: input.connectionId,
      resourceId: input.resourceId,
      projectId: input.projectId,
      accountId: input.accountId,
      accountLabel: session.account.label,
      providerResourceId,
      title: snapshot.title,
      writable: snapshot.writable,
      trashable: snapshot.trashable ?? true,
      restorable: snapshot.restorable ?? false,
      trashed: snapshot.trashed ?? false,
    });
  }

  async #loadBundle(
    connectionId: string,
  ): Promise<GoogleWorkspaceConnectionBundle> {
    const manifest = await this.#manifest();
    const account = manifest.accounts.find(
      (candidate) => candidate.connectionId === connectionId,
    );
    const resources = manifest.resources.filter(
      (resource) => resource.connectionId === connectionId,
    );
    if (!account) {
      throw new ConnectorError(
        "io_failure",
        `${this.#profile.connectionName}连接数据缺失。`,
      );
    }
    const snapshots = await Promise.all(
      resources.map((stored) =>
        this.#api.readResource(stored.accountId, stored.providerResourceId),
      ),
    );
    return {
      connection: connection(
        this.#profile,
        account,
        resources,
        true,
        snapshots,
      ),
      resources: resources.map((stored, index) =>
        workspaceResource(this.#profile, stored, snapshots[index]!),
      ),
    };
  }

  async #upsertStored(stored: StoredGoogleWorkspaceResource) {
    const manifest = await this.#manifest();
    const accounts = this.#mergedAccounts(
      manifest.accounts,
      accountFromResource(stored),
    );
    const resources = [
      ...manifest.resources.filter(
        (resource) =>
          resource.resourceId !== stored.resourceId &&
          !(
            resource.projectId === stored.projectId &&
            resource.providerResourceId === stored.providerResourceId
          ),
      ),
      stored,
    ].sort((left, right) =>
      `${left.projectId}\0${left.providerResourceId}`.localeCompare(
        `${right.projectId}\0${right.providerResourceId}`,
        "en",
      ),
    );
    if (resources.length > MAX_CONNECTIONS) {
      throw new ConnectorError(
        "unsupported",
        `${this.#profile.connectionName}连接数量已达上限。`,
      );
    }
    await this.#store.write(
      this.#profile.manifestKey,
      JSON.stringify({ version: MANIFEST_VERSION, accounts, resources }),
    );
  }

  async #upsertAccount(stored: StoredGoogleAccountBinding) {
    const manifest = await this.#manifest();
    await this.#store.write(
      this.#profile.manifestKey,
      JSON.stringify({
        version: MANIFEST_VERSION,
        accounts: this.#mergedAccounts(manifest.accounts, stored),
        resources: manifest.resources,
      }),
    );
  }

  #mergedAccounts(
    accounts: readonly StoredGoogleAccountBinding[],
    stored: StoredGoogleAccountBinding,
  ) {
    const next = [
      ...accounts.filter(
        (account) =>
          account.connectionId !== stored.connectionId &&
          !(
            account.projectId === stored.projectId &&
            account.accountId === stored.accountId
          ),
      ),
      stored,
    ].sort((left, right) =>
      left.connectionId.localeCompare(right.connectionId, "en"),
    );
    if (next.length > MAX_CONNECTIONS) {
      throw new ConnectorError(
        "unsupported",
        `${this.#profile.connectionName}连接数量已达上限。`,
      );
    }
    return next;
  }

  #assertAccount(account: GoogleDocsAuthorizedAccount) {
    if (!SAFE_ID.test(account.id) || !safeText(account.label, 320)) {
      throw new ConnectorError(
        "not_connected",
        "Google account identity is invalid.",
      );
    }
  }

  async #manifest() {
    return parseManifest(
      this.#profile.kind,
      await this.#store.read(this.#profile.manifestKey),
    );
  }

  #providerResourceId(resource: WorkspaceResource) {
    if (
      this.#profile.kind === "sheets" &&
      resource.storage.kind === "google-sheet"
    ) {
      return `${resource.storage.spreadsheetId}:${resource.storage.sheetId}`;
    }
    if (
      this.#profile.kind === "slides" &&
      resource.storage.kind === "google-slide"
    ) {
      return resource.storage.presentationId;
    }
    return null;
  }

  #creationKey(operationId: string) {
    if (
      !operationId ||
      operationId.length > 512 ||
      operationId.includes("\0")
    ) {
      throw this.#invalidCreationIntent();
    }
    return `${this.#profile.creationPrefix}${operationId}`;
  }

  async #creationIntent(storageRef: string): Promise<CreationIntent | null> {
    const value = await this.#store.read(storageRef);
    if (!value) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw this.#invalidCreationIntent();
    }
    if (
      !record(parsed) ||
      parsed.version !== 1 ||
      parsed.provider !== this.#profile.provider ||
      !["prepared", "started", "completed"].includes(String(parsed.status)) ||
      !safeText(parsed.operationId, 512) ||
      !safeText(parsed.accountId, 240) ||
      !safeText(parsed.projectId, 240) ||
      !safeText(parsed.title, 1_000) ||
      !safeText(parsed.createdAt, 64) ||
      (parsed.connectionId !== undefined &&
        (typeof parsed.connectionId !== "string" ||
          !SAFE_ID.test(parsed.connectionId))) ||
      (parsed.resourceId !== undefined &&
        (typeof parsed.resourceId !== "string" ||
          !SAFE_ID.test(parsed.resourceId))) ||
      (parsed.providerResourceId !== undefined &&
        !validProviderResourceId(this.#profile.kind, parsed.providerResourceId))
    ) {
      throw this.#invalidCreationIntent();
    }
    return parsed as CreationIntent;
  }

  #assertSameCreation(
    intent: CreationIntent,
    input: {
      accountId: string;
      operationId: string;
      projectId: string;
      title: string;
    },
  ) {
    if (
      intent.accountId !== input.accountId ||
      intent.operationId !== input.operationId ||
      intent.projectId !== input.projectId ||
      intent.title !== input.title
    ) {
      throw new ConnectorError(
        "permission_denied",
        `${this.#profile.connectionName}新建恢复意图与当前提案不一致。`,
      );
    }
  }

  #invalidCreationIntent() {
    return new ConnectorError(
      "recovery_failed",
      `${this.#profile.connectionName}新建恢复意图无效，已取消写入。`,
    );
  }
}

function invalidManifest(kind: GoogleWorkspaceConnectionKind) {
  return new ConnectorError(
    "io_failure",
    `Saved Google ${kind} connections are invalid.`,
  );
}
