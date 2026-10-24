import { ConnectorError } from "@boltpocket/connector-core";
import type {
  GoogleDocsDocumentSnapshot,
  GoogleDocsRecoverySnapshot,
} from "@boltpocket/connector-google-docs";

import type {
  GoogleDocsAuthorizedAccount,
  GoogleDocsAuthorizationPort,
  GoogleDocsConnectionCryptoPort,
  GoogleDocsConnectionBundle,
  GoogleDocsConnectionService,
} from "@/application/ports/google-docs-connections";
import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";
import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";

import {
  googleDocumentUrl,
  parseGoogleDocumentId,
} from "./google-docs-document";
import { GoogleDocsHttpApi } from "./google-docs-http-api";

const MANIFEST_KEY = "google-docs:manifest:v1";
const RECOVERY_PREFIX = "google-docs:recovery:";
const CREATION_PREFIX = "google-docs:create:";
const MANIFEST_VERSION = 1;
const MAX_CONNECTIONS = 500;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{20,200}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,240}$/u;

type StoredGoogleDocument = {
  connectionId: string;
  resourceId: string;
  projectId: string;
  accountId: string;
  accountLabel: string;
  documentId: string;
  title: string;
  locator: string;
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

type GoogleDocsManifest = {
  version: typeof MANIFEST_VERSION;
  accounts: StoredGoogleAccountBinding[];
  documents: StoredGoogleDocument[];
};

type CreationIntent = {
  version: 1;
  provider: "google";
  status: "prepared" | "started" | "completed";
  operationId: string;
  accountId: string;
  projectId: string;
  connectionId?: string;
  resourceId?: string;
  title: string;
  documentId?: string;
  createdAt: string;
};

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

function validStoredDocument(value: unknown): value is StoredGoogleDocument {
  if (!record(value)) return false;
  return (
    typeof value.connectionId === "string" &&
    SAFE_ID.test(value.connectionId) &&
    typeof value.resourceId === "string" &&
    SAFE_ID.test(value.resourceId) &&
    safeText(value.projectId, 240) &&
    safeText(value.accountId, 240) &&
    safeText(value.accountLabel, 320) &&
    typeof value.documentId === "string" &&
    DOCUMENT_ID.test(value.documentId) &&
    safeText(value.title, 1_000) &&
    value.locator === googleDocumentUrl(value.documentId) &&
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

function accountFromDocument(
  document: StoredGoogleDocument,
): StoredGoogleAccountBinding {
  return {
    connectionId: document.connectionId,
    projectId: document.projectId,
    accountId: document.accountId,
    accountLabel: document.accountLabel,
  };
}

function parseManifest(value: string | undefined): GoogleDocsManifest {
  if (value === undefined) {
    return { version: MANIFEST_VERSION, accounts: [], documents: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ConnectorError(
      "io_failure",
      "Saved Google Docs connections are invalid.",
    );
  }
  if (
    !record(parsed) ||
    parsed.version !== MANIFEST_VERSION ||
    (parsed.accounts !== undefined && !Array.isArray(parsed.accounts)) ||
    !Array.isArray(parsed.documents) ||
    parsed.documents.length > MAX_CONNECTIONS ||
    (Array.isArray(parsed.accounts) &&
      parsed.accounts.length > MAX_CONNECTIONS) ||
    (Array.isArray(parsed.accounts) &&
      !parsed.accounts.every(validStoredAccount)) ||
    !parsed.documents.every(validStoredDocument)
  ) {
    throw new ConnectorError(
      "io_failure",
      "Saved Google Docs connections are invalid.",
    );
  }
  const documents = (parsed.documents as StoredGoogleDocument[]).map(
    (document) => ({
      ...document,
      trashable: document.trashable ?? false,
      restorable: document.restorable ?? false,
      trashed: document.trashed ?? false,
    }),
  );
  const accounts = [
    ...((parsed.accounts ?? []) as StoredGoogleAccountBinding[]),
  ];
  for (const document of documents) {
    const account = accountFromDocument(document);
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
      throw new ConnectorError(
        "io_failure",
        "Saved Google Docs account bindings are invalid.",
      );
    }
  }
  if (
    new Set(accounts.map((account) => account.connectionId)).size !==
      accounts.length ||
    new Set(
      accounts.map((account) => `${account.projectId}\0${account.accountId}`),
    ).size !== accounts.length ||
    new Set(documents.map((document) => document.resourceId)).size !==
      documents.length ||
    new Set(
      documents.map(
        (document) => `${document.projectId}\0${document.documentId}`,
      ),
    ).size !== documents.length ||
    documents.some((document) =>
      documents.some(
        (candidate) =>
          candidate.connectionId === document.connectionId &&
          (candidate.projectId !== document.projectId ||
            candidate.accountId !== document.accountId ||
            candidate.accountLabel !== document.accountLabel),
      ),
    )
  ) {
    throw new ConnectorError(
      "io_failure",
      "Saved Google Docs connections contain duplicate bindings.",
    );
  }
  return {
    version: MANIFEST_VERSION,
    accounts: accounts.sort((left, right) =>
      left.connectionId.localeCompare(right.connectionId, "en"),
    ),
    documents,
  };
}

function documentPath(title: string) {
  const leaf = title
    .normalize("NFC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "-")
    .trim()
    .slice(0, 160);
  return `${leaf || "Google 文档"}.txt`;
}

function connection(
  account: StoredGoogleAccountBinding,
  documents: readonly StoredGoogleDocument[],
  connected: boolean,
  snapshots: readonly GoogleDocsDocumentSnapshot[] = [],
): ConnectionItem {
  const writable =
    connected &&
    (snapshots.length === 0 ||
      snapshots.every((snapshot) => snapshot.writable && !snapshot.trashed));
  return {
    id: account.connectionId,
    projectId: account.projectId,
    name: "Google 文档",
    accountId: account.accountId,
    account: account.accountLabel,
    scope:
      documents.length === 0
        ? "已授权，可新建或粘贴链接"
        : documents.length === 1
          ? (snapshots[0]?.title ?? documents[0]!.title)
          : `${documents.length} 份文档`,
    status: connected ? "connected" : "attention",
    resourceCount: connected ? documents.length : 0,
    access: "persistent",
    writeMode: writable ? "recoverable" : "read-only",
  };
}

function resource(
  stored: StoredGoogleDocument,
  snapshot: GoogleDocsDocumentSnapshot,
): WorkspaceResource {
  return {
    id: stored.resourceId,
    projectId: stored.projectId,
    connectionId: stored.connectionId,
    path: documentPath(snapshot.title),
    content: snapshot.text,
    version: snapshot.revisionId,
    storage: {
      kind: "google-doc",
      locator: snapshot.documentId
        ? googleDocumentUrl(snapshot.documentId)
        : stored.locator,
      documentId: stored.documentId,
      accountId: stored.accountId,
      accountLabel: stored.accountLabel,
      writable: snapshot.writable,
      trashable: snapshot.trashable ?? false,
      restorable: snapshot.restorable ?? false,
      trashed: snapshot.trashed ?? false,
      access: "persistent",
    },
  };
}

export class ExpoGoogleDocsConnectionService implements GoogleDocsConnectionService {
  readonly #store: DurableDocumentStore;
  readonly #authorization: GoogleDocsAuthorizationPort;
  readonly #api: GoogleDocsHttpApi;
  readonly #crypto: GoogleDocsConnectionCryptoPort;

  constructor(
    store: DurableDocumentStore,
    authorization: GoogleDocsAuthorizationPort,
    crypto: GoogleDocsConnectionCryptoPort,
    fetchImplementation: typeof fetch = fetch,
  ) {
    this.#store = store;
    this.#authorization = authorization;
    this.#crypto = crypto;
    this.#api = new GoogleDocsHttpApi(authorization, fetchImplementation);
  }

  async load(): Promise<GoogleDocsConnectionBundle[]> {
    const manifest = await this.#manifest();
    const session = await this.#authorization.restore();
    return Promise.all(
      manifest.accounts.map(async (account) => {
        const documents = manifest.documents.filter(
          (document) => document.connectionId === account.connectionId,
        );
        if (!session || session.account.id !== account.accountId) {
          return {
            connection: connection(account, documents, false),
            resources: [],
          };
        }
        try {
          const snapshots = await Promise.all(
            documents.map((stored) =>
              this.#api.readDocument(stored.accountId, stored.documentId),
            ),
          );
          return {
            connection: connection(account, documents, true, snapshots),
            resources: documents.map((stored, index) =>
              resource(stored, snapshots[index]!),
            ),
          };
        } catch {
          return {
            connection: connection(account, documents, false),
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
      connectionId: `google-docs-${connectionDigest.slice(0, 20)}`,
      projectId: project.id,
      accountId: account.id,
      accountLabel: account.label,
    };
    await this.#upsertAccount(stored);
    return this.#loadBundle(stored.connectionId);
  }

  async connect(project: Project, documentUrl: string) {
    const documentId = parseGoogleDocumentId(documentUrl);
    const session = await this.#authorization.connect();
    if (!session) return null;
    this.#assertAccount(session.account);
    const snapshot = await this.#api.readDocument(
      session.account.id,
      documentId,
    );
    const connectionDigest = await this.#crypto.sha256(
      `${project.id}\0${session.account.id}`,
    );
    const digest = await this.#crypto.sha256(`${project.id}\0${documentId}`);
    const stored: StoredGoogleDocument = {
      connectionId: `google-docs-${connectionDigest.slice(0, 20)}`,
      resourceId: `google-doc-${digest.slice(0, 24)}`,
      projectId: project.id,
      accountId: session.account.id,
      accountLabel: session.account.label,
      documentId,
      title: snapshot.title,
      locator: googleDocumentUrl(documentId),
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
        if (current.storage.kind !== "google-doc") return current;
        const snapshot = await this.#api.readDocument(
          current.storage.accountId,
          current.storage.documentId,
        );
        return {
          ...current,
          path: documentPath(snapshot.title),
          content: snapshot.text,
          version: snapshot.revisionId,
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

  readDocument(accountId: string, documentId: string) {
    return this.#api.readDocument(accountId, documentId);
  }

  replaceDocument(input: {
    accountId: string;
    documentId: string;
    expectedRevisionId: string;
    text: string;
  }) {
    return this.#api.replaceDocument(input);
  }

  setDocumentTrashed(
    input: Parameters<GoogleDocsHttpApi["setDocumentTrashed"]>[0],
  ) {
    return this.#api.setDocumentTrashed(input);
  }

  async createRecoveryPoint(snapshot: GoogleDocsRecoverySnapshot) {
    const storageRef = `${RECOVERY_PREFIX}${this.#crypto.randomUUID()}`;
    await this.#store.write(
      storageRef,
      JSON.stringify({
        accountId: snapshot.accountId,
        documentId: snapshot.documentId,
        title: snapshot.title,
        text: snapshot.text,
        version: snapshot.revisionId,
        createdAt: new Date().toISOString(),
      }),
    );
    return { storageRef, version: snapshot.revisionId };
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
      provider: "google",
      status: "prepared",
      ...input,
      createdAt: new Date().toISOString(),
    };
    await this.#store.write(storageRef, JSON.stringify(intent));
    return { storageRef, version: "absent" };
  }

  async createDocument(
    input: Parameters<GoogleDocsHttpApi["createDocument"]>[0],
  ) {
    const storageRef = creationKey(input.operationId);
    const intent = await this.#creationIntent(storageRef);
    if (!intent) {
      throw new ConnectorError(
        "recovery_failed",
        "缺少 Google 文档新建恢复意图，已取消写入。",
      );
    }
    assertSameCreation(intent, input);
    if (
      (intent.connectionId && intent.connectionId !== input.connectionId) ||
      (intent.resourceId && intent.resourceId !== input.resourceId)
    ) {
      throw new ConnectorError(
        "permission_denied",
        "Google 文档新建目标绑定不一致。",
      );
    }
    if (intent.status === "started") {
      throw new ConnectorError(
        "io_failure",
        "Google 文档新建结果未知；为避免重复文档，客户端不会自动重试。",
      );
    }
    if (intent.status === "completed") {
      if (!intent.documentId) throw invalidCreationIntent();
      await this.#ensureCreatedBinding(input, intent.documentId);
      const snapshot = await this.#api.readDocument(
        input.accountId,
        intent.documentId,
      );
      return {
        ...snapshot,
        trashable: true,
        restorable: false,
        trashed: false,
      };
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
    const created = await this.#api.createDocument(input);
    await this.#store.write(
      storageRef,
      JSON.stringify({
        ...intent,
        status: "completed",
        connectionId: input.connectionId,
        resourceId: input.resourceId,
        documentId: created.documentId,
      } satisfies CreationIntent),
    );
    await this.#ensureCreatedBinding(input, created.documentId, created);
    return created;
  }

  async #ensureCreatedBinding(
    input: Parameters<GoogleDocsHttpApi["createDocument"]>[0],
    documentId: string,
    known?: GoogleDocsDocumentSnapshot,
  ) {
    const manifest = await this.#manifest();
    const sameResource = manifest.documents.find(
      (document) => document.resourceId === input.resourceId,
    );
    if (sameResource && sameResource.documentId !== documentId) {
      throw new ConnectorError(
        "permission_denied",
        "Google 文档资源 ID 已绑定其他文档。",
      );
    }
    if (sameResource) return;
    const session = await this.#authorization.restore();
    if (!session || session.account.id !== input.accountId) {
      throw new ConnectorError("not_connected", "Google 授权已过期。");
    }
    const snapshot =
      known ?? (await this.#api.readDocument(input.accountId, documentId));
    await this.#upsertStored({
      connectionId: input.connectionId,
      resourceId: input.resourceId,
      projectId: input.projectId,
      accountId: input.accountId,
      accountLabel: session.account.label,
      documentId,
      title: snapshot.title,
      locator: googleDocumentUrl(documentId),
      writable: snapshot.writable,
      trashable: snapshot.trashable ?? true,
      restorable: snapshot.restorable ?? false,
      trashed: snapshot.trashed ?? false,
    });
  }

  async #loadBundle(connectionId: string): Promise<GoogleDocsConnectionBundle> {
    const manifest = await this.#manifest();
    const account = manifest.accounts.find(
      (candidate) => candidate.connectionId === connectionId,
    );
    const documents = manifest.documents.filter(
      (document) => document.connectionId === connectionId,
    );
    if (!account) {
      throw new ConnectorError("io_failure", "Google 文档连接数据缺失。");
    }
    const snapshots = await Promise.all(
      documents.map((document) =>
        this.#api.readDocument(document.accountId, document.documentId),
      ),
    );
    return {
      connection: connection(account, documents, true, snapshots),
      resources: documents.map((document, index) =>
        resource(document, {
          ...snapshots[index]!,
          trashable: document.trashable,
          restorable: document.restorable,
          trashed: document.trashed,
        }),
      ),
    };
  }

  async #upsertStored(stored: StoredGoogleDocument) {
    const manifest = await this.#manifest();
    const account = accountFromDocument(stored);
    const accounts = this.#mergedAccounts(manifest.accounts, account);
    const documents = [
      ...manifest.documents.filter(
        (document) =>
          document.resourceId !== stored.resourceId &&
          !(
            document.projectId === stored.projectId &&
            document.documentId === stored.documentId
          ),
      ),
      stored,
    ].sort((left, right) =>
      `${left.projectId}\0${left.documentId}`.localeCompare(
        `${right.projectId}\0${right.documentId}`,
        "en",
      ),
    );
    if (documents.length > MAX_CONNECTIONS) {
      throw new ConnectorError(
        "unsupported",
        "Google Docs connection limit reached.",
      );
    }
    await this.#store.write(
      MANIFEST_KEY,
      JSON.stringify({ version: MANIFEST_VERSION, accounts, documents }),
    );
  }

  async #upsertAccount(stored: StoredGoogleAccountBinding) {
    const manifest = await this.#manifest();
    await this.#store.write(
      MANIFEST_KEY,
      JSON.stringify({
        version: MANIFEST_VERSION,
        accounts: this.#mergedAccounts(manifest.accounts, stored),
        documents: manifest.documents,
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
        "Google Docs connection limit reached.",
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
      !record(parsed) ||
      parsed.version !== 1 ||
      parsed.provider !== "google" ||
      !["prepared", "started", "completed"].includes(String(parsed.status)) ||
      !safeText(parsed.operationId, 512) ||
      !safeText(parsed.accountId, 240) ||
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
      "Google 文档新建恢复意图与当前提案不一致。",
    );
  }
}

function invalidCreationIntent() {
  return new ConnectorError(
    "recovery_failed",
    "Google 文档新建恢复意图无效，已取消写入。",
  );
}
