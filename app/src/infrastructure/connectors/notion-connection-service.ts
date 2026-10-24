import { ConnectorError } from "@boltpocket/connector-core";
import {
  normalizeNotionPageId,
  notionPageUrl,
  parseNotionPageId,
  type NotionPageSnapshot,
  type NotionRecoverySnapshot,
} from "@boltpocket/connector-notion";

import type {
  NotionConnectionBundle,
  NotionConnectionCryptoPort,
  NotionConnectionService,
} from "@/application/ports/notion-connections";
import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";
import type { ExpoDocumentOAuth } from "@/infrastructure/connectors/expo-document-oauth";
import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";

import { NotionHttpApi } from "./notion-http-api";

const MANIFEST_KEY = "notion:manifest:v1";
const RECOVERY_PREFIX = "notion:recovery:";
const CREATION_PREFIX = "notion:create:";
const MANIFEST_VERSION = 1;
const MAX_PAGES = 500;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,240}$/u;

type StoredNotionPage = {
  connectionId: string;
  resourceId: string;
  projectId: string;
  accountId: string;
  accountLabel: string;
  pageId: string;
  title: string;
  locator: string;
  writable: boolean;
  trashable: boolean;
  restorable: boolean;
  trashed: boolean;
};

type NotionManifest = {
  version: typeof MANIFEST_VERSION;
  pages: StoredNotionPage[];
};

type CreationIntent = {
  version: 1;
  provider: "notion";
  status: "prepared" | "started" | "completed";
  operationId: string;
  accountId: string;
  projectId: string;
  connectionId?: string;
  resourceId?: string;
  title: string;
  pageId?: string;
  createdAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
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

function validStoredPage(value: unknown): value is StoredNotionPage {
  if (!isRecord(value)) return false;
  try {
    return (
      typeof value.connectionId === "string" &&
      SAFE_ID.test(value.connectionId) &&
      typeof value.resourceId === "string" &&
      SAFE_ID.test(value.resourceId) &&
      safeText(value.projectId, 240) &&
      safeText(value.accountId, 512) &&
      safeText(value.accountLabel, 1_024) &&
      typeof value.pageId === "string" &&
      normalizeNotionPageId(value.pageId) === value.pageId &&
      safeText(value.title, 1_000) &&
      typeof value.locator === "string" &&
      parseNotionPageId(value.locator) === value.pageId &&
      typeof value.writable === "boolean" &&
      typeof value.trashable === "boolean" &&
      typeof value.restorable === "boolean" &&
      typeof value.trashed === "boolean"
    );
  } catch {
    return false;
  }
}

function parseManifest(value: string | undefined): NotionManifest {
  if (value === undefined) return { version: MANIFEST_VERSION, pages: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw invalidManifest();
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== MANIFEST_VERSION ||
    !Array.isArray(parsed.pages) ||
    parsed.pages.length > MAX_PAGES ||
    !parsed.pages.every(validStoredPage)
  ) {
    throw invalidManifest();
  }
  const pages = parsed.pages as StoredNotionPage[];
  if (
    new Set(pages.map((page) => page.resourceId)).size !== pages.length ||
    new Set(pages.map((page) => `${page.projectId}\0${page.pageId}`)).size !==
      pages.length ||
    pages.some((page) =>
      pages.some(
        (candidate) =>
          candidate.connectionId === page.connectionId &&
          (candidate.projectId !== page.projectId ||
            candidate.accountId !== page.accountId ||
            candidate.accountLabel !== page.accountLabel),
      ),
    )
  ) {
    throw invalidManifest();
  }
  return { version: MANIFEST_VERSION, pages };
}

function invalidManifest() {
  return new ConnectorError("io_failure", "已保存的 Notion 连接数据无效。");
}

function pagePath(title: string) {
  const leaf = title
    .normalize("NFC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "-")
    .trim()
    .slice(0, 160);
  return `${leaf || "Notion 页面"}.md`;
}

function storedFromSnapshot(
  binding: Omit<
    StoredNotionPage,
    "title" | "locator" | "writable" | "trashable" | "restorable" | "trashed"
  >,
  snapshot: NotionPageSnapshot,
): StoredNotionPage {
  return {
    ...binding,
    title: snapshot.title,
    locator: snapshot.locator || notionPageUrl(snapshot.pageId),
    writable: snapshot.writable,
    trashable: snapshot.trashable,
    restorable: snapshot.restorable,
    trashed: snapshot.trashed,
  };
}

function resource(
  stored: StoredNotionPage,
  snapshot: NotionPageSnapshot,
): WorkspaceResource {
  return {
    id: stored.resourceId,
    projectId: stored.projectId,
    connectionId: stored.connectionId,
    path: pagePath(snapshot.title),
    content: snapshot.markdown,
    version: snapshot.version,
    storage: {
      kind: "notion-page",
      locator: snapshot.locator,
      pageId: snapshot.pageId,
      accountId: stored.accountId,
      accountLabel: stored.accountLabel,
      writable: snapshot.writable,
      trashable: snapshot.trashable,
      restorable: snapshot.restorable,
      trashed: snapshot.trashed,
      access: "persistent",
    },
  };
}

function bundleConnection(
  pages: readonly StoredNotionPage[],
  connected: boolean,
  snapshots: readonly NotionPageSnapshot[] = [],
): ConnectionItem {
  const first = pages[0]!;
  const writable =
    connected &&
    snapshots.every((snapshot) => snapshot.writable && !snapshot.trashed);
  return {
    id: first.connectionId,
    projectId: first.projectId,
    name: "Notion",
    account: first.accountLabel,
    scope: pages.length === 1 ? pages[0]!.title : `${pages.length} 个页面`,
    status: connected ? "connected" : "attention",
    resourceCount: connected ? pages.length : 0,
    access: "persistent",
    writeMode: writable ? "recoverable" : "read-only",
  };
}

function groupPages(pages: readonly StoredNotionPage[]) {
  const groups = new Map<string, StoredNotionPage[]>();
  for (const page of pages) {
    const group = groups.get(page.connectionId) ?? [];
    group.push(page);
    groups.set(page.connectionId, group);
  }
  return [...groups.values()].map((group) =>
    group.sort((left, right) => left.pageId.localeCompare(right.pageId, "en")),
  );
}

export class ExpoNotionConnectionService implements NotionConnectionService {
  readonly #store: DurableDocumentStore;
  readonly #oauth: ExpoDocumentOAuth;
  readonly #api: NotionHttpApi;
  readonly #crypto: NotionConnectionCryptoPort;

  constructor(
    store: DurableDocumentStore,
    oauth: ExpoDocumentOAuth,
    crypto: NotionConnectionCryptoPort,
    fetchImplementation: typeof fetch = fetch,
  ) {
    this.#store = store;
    this.#oauth = oauth;
    this.#crypto = crypto;
    this.#api = new NotionHttpApi(oauth, fetchImplementation, (value) =>
      crypto.sha256(value),
    );
  }

  async load(): Promise<NotionConnectionBundle[]> {
    const manifest = await this.#manifest();
    const sessions = (await this.#oauth.list("notion")).filter(
      (session) => !session.requiresReauthorization,
    );
    return Promise.all(
      groupPages(manifest.pages).map(async (pages) => {
        if (
          !sessions.some((session) => session.accountId === pages[0]!.accountId)
        ) {
          return { connection: bundleConnection(pages, false), resources: [] };
        }
        try {
          const snapshots = await Promise.all(
            pages.map((page) =>
              this.#api.readPage(page.accountId, page.pageId),
            ),
          );
          return {
            connection: bundleConnection(pages, true, snapshots),
            resources: pages.map((page, index) =>
              resource(page, snapshots[index]!),
            ),
          };
        } catch {
          return { connection: bundleConnection(pages, false), resources: [] };
        }
      }),
    );
  }

  async connect(project: Project, pageUrl: string) {
    const pageId = parseNotionPageId(pageUrl);
    const existingSessions = (await this.#oauth.list("notion")).filter(
      (candidate) => !candidate.requiresReauthorization,
    );
    const session =
      existingSessions[0] ?? (await this.#oauth.connect("notion"));
    if (!session) return null;
    if (
      !safeText(session.accountId, 512) ||
      !safeText(session.accountName, 1_024)
    ) {
      throw new ConnectorError("not_connected", "Notion 工作区身份无效。");
    }
    const snapshot = await this.#api.readPage(session.accountId, pageId);
    const digest = await this.#crypto.sha256(
      `${project.id}\0${session.accountId}`,
    );
    const documentDigest = await this.#crypto.sha256(
      `${project.id}\0${pageId}`,
    );
    const connectionId = `notion-${digest.slice(0, 24)}`;
    const stored = storedFromSnapshot(
      {
        connectionId,
        resourceId: `notion-page-${documentDigest.slice(0, 24)}`,
        projectId: project.id,
        accountId: session.accountId,
        accountLabel: session.accountName,
        pageId,
      },
      snapshot,
    );
    await this.#upsertStored(stored);
    const bundle = await this.#loadBundle(connectionId);
    return { ...bundle, focusedResourceId: stored.resourceId };
  }

  async refresh(resources: WorkspaceResource[]) {
    return Promise.all(
      resources.map(async (current) => {
        if (current.storage.kind !== "notion-page") return current;
        const snapshot = await this.#api.readPage(
          current.storage.accountId,
          current.storage.pageId,
        );
        return resource(
          {
            connectionId: current.connectionId,
            resourceId: current.id,
            projectId: current.projectId,
            accountId: current.storage.accountId,
            accountLabel: current.storage.accountLabel,
            pageId: current.storage.pageId,
            title: snapshot.title,
            locator: snapshot.locator,
            writable: snapshot.writable,
            trashable: snapshot.trashable,
            restorable: snapshot.restorable,
            trashed: snapshot.trashed,
          },
          snapshot,
        );
      }),
    );
  }

  readPage(accountId: string, pageId: string) {
    return this.#api.readPage(accountId, pageId);
  }

  replacePage(input: Parameters<NotionHttpApi["replacePage"]>[0]) {
    return this.#api.replacePage(input);
  }

  setPageTrashed(input: Parameters<NotionHttpApi["setPageTrashed"]>[0]) {
    return this.#api.setPageTrashed(input);
  }

  async createRecoveryPoint(snapshot: NotionRecoverySnapshot) {
    const storageRef = `${RECOVERY_PREFIX}${this.#crypto.randomUUID()}`;
    await this.#store.write(
      storageRef,
      JSON.stringify({ ...snapshot, createdAt: new Date().toISOString() }),
    );
    return { storageRef, version: snapshot.version };
  }

  async createCreationRecoveryPoint(input: {
    accountId: string;
    operationId: string;
    projectId: string;
    title: string;
  }) {
    const storageRef = creationKey(input.operationId);
    const existing = await this.#creationIntent(storageRef);
    if (existing) {
      assertSameCreation(existing, input);
      return { storageRef, version: "absent" };
    }
    const intent: CreationIntent = {
      version: 1,
      provider: "notion",
      status: "prepared",
      ...input,
      createdAt: new Date().toISOString(),
    };
    await this.#store.write(storageRef, JSON.stringify(intent));
    return { storageRef, version: "absent" };
  }

  async createPage(input: Parameters<NotionHttpApi["createPage"]>[0]) {
    const storageRef = creationKey(input.operationId);
    const intent = await this.#creationIntent(storageRef);
    if (!intent) {
      throw new ConnectorError(
        "recovery_failed",
        "缺少 Notion 新建恢复意图，已取消写入。",
      );
    }
    assertSameCreation(intent, input);
    if (
      (intent.connectionId && intent.connectionId !== input.connectionId) ||
      (intent.resourceId && intent.resourceId !== input.resourceId)
    ) {
      throw new ConnectorError(
        "permission_denied",
        "Notion 新建目标绑定不一致。",
      );
    }
    if (intent.status === "started") {
      throw new ConnectorError(
        "io_failure",
        "Notion 新建结果未知；为避免重复页面，客户端不会自动重试。",
      );
    }
    if (intent.status === "completed") {
      if (!intent.pageId) throw invalidCreationIntent();
      await this.#ensureCreatedBinding(input, intent.pageId);
      return this.#api.readPage(input.accountId, intent.pageId);
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
    const created = await this.#api.createPage(input);
    await this.#store.write(
      storageRef,
      JSON.stringify({
        ...intent,
        status: "completed",
        connectionId: input.connectionId,
        resourceId: input.resourceId,
        pageId: created.pageId,
      } satisfies CreationIntent),
    );
    await this.#ensureCreatedBinding(input, created.pageId, created);
    return created;
  }

  async #ensureCreatedBinding(
    input: Parameters<NotionHttpApi["createPage"]>[0],
    pageId: string,
    known?: NotionPageSnapshot,
  ) {
    const manifest = await this.#manifest();
    const sameResource = manifest.pages.find(
      (page) => page.resourceId === input.resourceId,
    );
    if (sameResource && sameResource.pageId !== pageId) {
      throw new ConnectorError(
        "permission_denied",
        "Notion 新建资源 ID 已绑定其他页面。",
      );
    }
    if (sameResource) return;
    const account = await this.#oauth.connectionForAccount(
      "notion",
      input.accountId,
    );
    if (!account)
      throw new ConnectorError("not_connected", "Notion 授权已过期。");
    const snapshot =
      known ?? (await this.#api.readPage(input.accountId, pageId));
    await this.#upsertStored(
      storedFromSnapshot(
        {
          connectionId: input.connectionId,
          resourceId: input.resourceId,
          projectId: input.projectId,
          accountId: input.accountId,
          accountLabel: account.accountName,
          pageId: snapshot.pageId,
        },
        snapshot,
      ),
    );
  }

  async #loadBundle(connectionId: string): Promise<NotionConnectionBundle> {
    const pages = (await this.#manifest()).pages.filter(
      (page) => page.connectionId === connectionId,
    );
    if (!pages.length) throw invalidManifest();
    const snapshots = await Promise.all(
      pages.map((page) => this.#api.readPage(page.accountId, page.pageId)),
    );
    return {
      connection: bundleConnection(pages, true, snapshots),
      resources: pages.map((page, index) => resource(page, snapshots[index]!)),
    };
  }

  async #upsertStored(stored: StoredNotionPage) {
    const manifest = await this.#manifest();
    const pages = [
      ...manifest.pages.filter(
        (page) =>
          page.resourceId !== stored.resourceId &&
          !(
            page.projectId === stored.projectId && page.pageId === stored.pageId
          ),
      ),
      stored,
    ].sort((left, right) =>
      `${left.projectId}\0${left.pageId}`.localeCompare(
        `${right.projectId}\0${right.pageId}`,
        "en",
      ),
    );
    if (pages.length > MAX_PAGES) {
      throw new ConnectorError("unsupported", "Notion 页面连接数量已达上限。");
    }
    await this.#store.write(
      MANIFEST_KEY,
      JSON.stringify({ version: MANIFEST_VERSION, pages }),
    );
  }

  async #manifest() {
    return parseManifest(await this.#store.read(MANIFEST_KEY));
  }

  async #creationIntent(storageRef: string): Promise<CreationIntent | null> {
    const value = await this.#store.read(storageRef);
    if (!value) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw invalidCreationIntent();
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      parsed.provider !== "notion" ||
      !["prepared", "started", "completed"].includes(String(parsed.status)) ||
      !safeText(parsed.operationId, 512) ||
      !safeText(parsed.accountId, 512) ||
      !safeText(parsed.projectId, 240) ||
      !safeText(parsed.title, 1_000) ||
      !safeText(parsed.createdAt, 64)
    ) {
      throw invalidCreationIntent();
    }
    return parsed as CreationIntent;
  }
}

function creationKey(operationId: string) {
  if (!operationId || operationId.length > 512 || operationId.includes("\0")) {
    throw invalidCreationIntent();
  }
  return `${CREATION_PREFIX}${operationId}`;
}

function assertSameCreation(
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
      "Notion 新建恢复意图与当前提案不一致。",
    );
  }
}

function invalidCreationIntent() {
  return new ConnectorError(
    "recovery_failed",
    "Notion 新建恢复意图无效，已取消写入。",
  );
}
