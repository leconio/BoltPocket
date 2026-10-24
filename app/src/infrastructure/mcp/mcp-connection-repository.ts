import type {
  McpConnection,
  McpConnectionAuthentication,
  McpConnectionInput,
  McpConnectionRepositoryPort,
} from "@/application/ports/mcp-connections";
import type { DurableDocumentStore } from "@/infrastructure/persistence/document-store";
import { isHttpsOrLocalNetworkHttpUrl } from "@boltpocket/connector-core";

const MANIFEST_KEY = "mcp:connections:manifest:v1";
const MANIFEST_VERSION = 6;
const MAX_CONNECTIONS = 100;
const MAX_CREDENTIALS_PER_CONNECTION = 8;
const MAX_ALLOWED_TOOLS = 2_000;
const MAX_APPROVAL_PATTERNS = 2_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const CONNECTION_ID = /^mcp-[A-Za-z0-9-]{16,100}$/u;

type PersistedManifest = Readonly<{
  version: typeof MANIFEST_VERSION;
  connections: readonly McpConnection[];
}>;

export class McpConnectionStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpConnectionStorageError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, maxLength: number) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function normalizedServerUrl(
  value: unknown,
  authenticationKind: McpConnectionAuthentication["kind"],
) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new McpConnectionStorageError("MCP 服务地址无效。");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new McpConnectionStorageError("MCP 服务地址无效。", {
      cause: error,
    });
  }
  const oauthRequiresHttps =
    authenticationKind === "oauth" && url.protocol !== "https:";
  if (
    url.username ||
    url.password ||
    url.hash ||
    !isHttpsOrLocalNetworkHttpUrl(url) ||
    oauthRequiresHttps
  ) {
    throw new McpConnectionStorageError(
      oauthRequiresHttps
        ? "OAuth MCP 连接必须使用 HTTPS。"
        : "公网 MCP 连接必须使用 HTTPS；局域网地址可使用 HTTP。",
    );
  }
  return url.toString();
}

function validatedLegacyProjectIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new McpConnectionStorageError("旧版 MCP 项目授权列表无效。");
  }
  const result = [...new Set(value)];
  if (result.some((id) => typeof id !== "string" || !SAFE_ID.test(id))) {
    throw new McpConnectionStorageError("旧版 MCP 项目授权列表无效。");
  }
  return result as string[];
}

function normalizedProjectId(value: unknown) {
  if (value !== null) {
    throw new McpConnectionStorageError("MCP 服务必须使用全局范围。");
  }
  return null;
}

function normalizedAllowedTools(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ALLOWED_TOOLS) {
    throw new McpConnectionStorageError("MCP 工具授权列表无效。");
  }
  const result = [...new Set(value)];
  if (result.some((name) => typeof name !== "string" || !SAFE_ID.test(name))) {
    throw new McpConnectionStorageError("MCP 工具授权列表包含无效名称。");
  }
  return result.sort();
}

function normalizedApprovalPatterns(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_APPROVAL_PATTERNS) {
    throw new McpConnectionStorageError("MCP 工具审批规则无效。");
  }
  const result = [...new Set(value)];
  if (
    result.some(
      (pattern) =>
        typeof pattern !== "string" ||
        !pattern ||
        pattern.length > 240 ||
        /[\u0000-\u001f\u007f]/u.test(pattern),
    )
  ) {
    throw new McpConnectionStorageError("MCP 工具审批规则包含无效 glob。");
  }
  return result.sort();
}

function normalizedAuthentication(value: unknown): McpConnectionAuthentication {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new McpConnectionStorageError("MCP 认证配置无效。");
  }
  if (value.kind === "none" && Object.keys(value).length === 1) {
    return { kind: "none" };
  }
  if (value.kind === "vault-token") {
    const legacyCredentialId =
      typeof value.credentialId === "string" ? value.credentialId : undefined;
    const credentialIds = Array.isArray(value.credentialIds)
      ? [...value.credentialIds]
      : legacyCredentialId
        ? [legacyCredentialId]
        : [];
    const allowedKeys = legacyCredentialId
      ? new Set(["kind", "credentialId", "queryParameterName"])
      : new Set(["kind", "credentialIds", "queryParameterName"]);
    const validCredentialIds =
      credentialIds.length >= 1 &&
      credentialIds.length <= MAX_CREDENTIALS_PER_CONNECTION &&
      credentialIds.every(
        (credentialId) =>
          typeof credentialId === "string" &&
          /^credential-[A-Za-z0-9-]{16,80}$/u.test(credentialId),
      ) &&
      new Set(credentialIds).size === credentialIds.length;
    const validQueryParameter =
      value.queryParameterName === undefined ||
      (credentialIds.length === 1 &&
        typeof value.queryParameterName === "string" &&
        /^[A-Za-z][A-Za-z0-9._~-]{0,63}$/u.test(value.queryParameterName));
    if (
      validCredentialIds &&
      validQueryParameter &&
      Object.keys(value).every((key) => allowedKeys.has(key))
    ) {
      return {
        kind: "vault-token",
        credentialIds: credentialIds as string[],
        ...(typeof value.queryParameterName === "string"
          ? { queryParameterName: value.queryParameterName }
          : {}),
      };
    }
  }
  if (
    value.kind === "oauth" &&
    Object.keys(value).length === 2 &&
    typeof value.authorizationId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{15,239}$/u.test(value.authorizationId)
  ) {
    return { kind: "oauth", authorizationId: value.authorizationId };
  }
  throw new McpConnectionStorageError("MCP 认证配置无效。");
}

function normalizedInput(input: McpConnectionInput) {
  if (typeof input.name !== "string") {
    throw new McpConnectionStorageError("MCP 连接名称必须为文本。");
  }
  const name = input.name.trim();
  if (!safeText(name, 160)) {
    throw new McpConnectionStorageError("MCP 连接名称必须为 1 到 160 个字符。");
  }
  const authentication = normalizedAuthentication(input.authentication);
  if (typeof input.enabled !== "boolean") {
    throw new McpConnectionStorageError("MCP 启用状态无效。");
  }
  const allowedToolNames = normalizedAllowedTools(input.allowedToolNames);
  const approveTools = normalizedApprovalPatterns(input.approveTools);
  const trustToolAnnotations = input.trustToolAnnotations ?? false;
  if (typeof trustToolAnnotations !== "boolean") {
    throw new McpConnectionStorageError("MCP 工具 annotation 信任设置无效。");
  }
  return {
    projectId: normalizedProjectId(input.projectId),
    name,
    serverUrl: normalizedServerUrl(input.serverUrl, authentication.kind),
    authentication,
    enabled: input.enabled,
    trustToolAnnotations,
    ...(allowedToolNames === undefined ? {} : { allowedToolNames }),
    ...(approveTools === undefined ? {} : { approveTools }),
  };
}

function parsedConnection(value: unknown, version: number): McpConnection {
  if (!isRecord(value)) {
    throw new McpConnectionStorageError("已保存的 MCP 连接无效。");
  }
  if (
    typeof value.id !== "string" ||
    !CONNECTION_ID.test(value.id) ||
    !safeText(value.createdAt, 64) ||
    !safeText(value.updatedAt, 64) ||
    !Number.isFinite(Date.parse(value.createdAt as string)) ||
    !Number.isFinite(Date.parse(value.updatedAt as string))
  ) {
    throw new McpConnectionStorageError("已保存的 MCP 连接无效。");
  }
  if (version === 1) validatedLegacyProjectIds(value.projectIds);
  if (
    version === 5 &&
    value.projectId !== null &&
    (typeof value.projectId !== "string" || !SAFE_ID.test(value.projectId))
  ) {
    throw new McpConnectionStorageError("旧版 MCP 项目范围无效。");
  }
  const projectId = null;
  const normalized = normalizedInput({
    projectId,
    name: value.name as string,
    serverUrl: value.serverUrl as string,
    authentication: value.authentication as McpConnectionAuthentication,
    enabled: value.enabled as boolean,
    ...(value.allowedToolNames === undefined
      ? {}
      : { allowedToolNames: value.allowedToolNames as string[] }),
    ...(value.approveTools === undefined
      ? {}
      : { approveTools: value.approveTools as string[] }),
    ...(value.trustToolAnnotations === undefined
      ? {}
      : { trustToolAnnotations: value.trustToolAnnotations as boolean }),
  });
  const allowedKeys = new Set([
    "id",
    "projectId",
    "name",
    "serverUrl",
    "authentication",
    "enabled",
    "allowedToolNames",
    "approveTools",
    "trustToolAnnotations",
    "createdAt",
    "updatedAt",
  ]);
  if (version !== 5 && version !== MANIFEST_VERSION) {
    allowedKeys.delete("projectId");
  }
  if (version === 1) allowedKeys.add("projectIds");
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new McpConnectionStorageError("已保存的 MCP 连接包含未知字段。");
  }
  return {
    id: value.id,
    ...normalized,
    projectId,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
  };
}

function parseManifest(value: string | undefined): PersistedManifest {
  if (value === undefined)
    return { version: MANIFEST_VERSION, connections: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new McpConnectionStorageError("无法读取已保存的 MCP 连接。", {
      cause: error,
    });
  }
  if (
    !isRecord(parsed) ||
    ![1, 2, 3, 4, 5, MANIFEST_VERSION].includes(parsed.version as number) ||
    !Array.isArray(parsed.connections) ||
    parsed.connections.length > MAX_CONNECTIONS ||
    Object.keys(parsed).some(
      (key) => key !== "version" && key !== "connections",
    )
  ) {
    throw new McpConnectionStorageError("已保存的 MCP 连接清单无效。");
  }
  const connections = parsed.connections.map((connection) =>
    parsedConnection(connection, parsed.version as number),
  );
  if (new Set(connections.map((item) => item.id)).size !== connections.length) {
    throw new McpConnectionStorageError("已保存的 MCP 连接编号重复。");
  }
  return { version: MANIFEST_VERSION, connections };
}

export class McpConnectionRepository implements McpConnectionRepositoryPort {
  readonly #store: DurableDocumentStore;
  readonly #createId: () => string;
  readonly #now: () => Date;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    store: DurableDocumentStore,
    createId: () => string,
    now: () => Date = () => new Date(),
  ) {
    this.#store = store;
    this.#createId = createId;
    this.#now = now;
  }

  async list(_legacyProjectId?: string) {
    await this.#queue;
    const connections = [
      ...parseManifest(await this.#store.read(MANIFEST_KEY)).connections,
    ];
    return connections.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  create(input: McpConnectionInput) {
    const normalized = normalizedInput(input);
    return this.#mutate(async (manifest) => {
      if (manifest.connections.length >= MAX_CONNECTIONS) {
        throw new McpConnectionStorageError("MCP 连接数量已达到上限。");
      }
      const id = this.#createId();
      if (!CONNECTION_ID.test(id)) {
        throw new McpConnectionStorageError("MCP 连接编号生成失败。");
      }
      if (manifest.connections.some((connection) => connection.id === id)) {
        throw new McpConnectionStorageError("MCP 连接编号重复。");
      }
      const timestamp = this.#now().toISOString();
      const created: McpConnection = {
        id,
        ...normalized,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return {
        result: created,
        connections: [...manifest.connections, created],
      };
    });
  }

  update(connectionId: string, input: McpConnectionInput) {
    if (!CONNECTION_ID.test(connectionId)) {
      return Promise.reject(
        new McpConnectionStorageError("MCP 连接编号无效。"),
      );
    }
    const normalized = normalizedInput(input);
    return this.#mutate(async (manifest) => {
      const existing = manifest.connections.find(
        (connection) => connection.id === connectionId,
      );
      if (!existing) throw new McpConnectionStorageError("MCP 连接不存在。");
      const updated: McpConnection = {
        id: existing.id,
        ...normalized,
        createdAt: existing.createdAt,
        updatedAt: this.#now().toISOString(),
      };
      return {
        result: updated,
        connections: manifest.connections.map((connection) =>
          connection.id === connectionId ? updated : connection,
        ),
      };
    });
  }

  remove(connectionId: string) {
    if (!CONNECTION_ID.test(connectionId)) {
      return Promise.reject(
        new McpConnectionStorageError("MCP 连接编号无效。"),
      );
    }
    return this.#mutate(async (manifest) => {
      if (
        !manifest.connections.some(
          (connection) => connection.id === connectionId,
        )
      ) {
        throw new McpConnectionStorageError("MCP 连接不存在。");
      }
      return {
        result: undefined,
        connections: manifest.connections.filter(
          (connection) => connection.id !== connectionId,
        ),
      };
    });
  }

  #mutate<Result>(
    operation: (
      manifest: PersistedManifest,
    ) => Promise<{ result: Result; connections: readonly McpConnection[] }>,
  ) {
    let resolveResult!: (value: Result | PromiseLike<Result>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<Result>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const queued = this.#queue.then(async () => {
      try {
        const manifest = parseManifest(await this.#store.read(MANIFEST_KEY));
        const changed = await operation(manifest);
        await this.#store.write(
          MANIFEST_KEY,
          JSON.stringify({
            version: MANIFEST_VERSION,
            connections: changed.connections,
          } satisfies PersistedManifest),
        );
        resolveResult(changed.result);
      } catch (error) {
        rejectResult(error);
      }
    });
    this.#queue = queued.catch(() => undefined);
    return result;
  }
}
