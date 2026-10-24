import type {
  ApiCredentialAuthentication,
  CreateCredentialInput,
  CredentialAgentAccess,
  CredentialKind,
  CredentialMetadataInput,
  CredentialSecret,
  CredentialSource,
  CredentialVaultItem,
  InternalCredentialVaultPort,
  SshCredentialAuthentication,
  UpdateCredentialInput,
} from "@/application/ports/credential-vault";

const INDEX_KEY = "boltpocket.credential-vault.index.v2";
const RECORD_PREFIX = "boltpocket.credential-vault.item.v2.";
const MAX_ITEMS = 100;
const MAX_SECRET_CHARACTERS = 64 * 1024;
const KINDS = new Set<CredentialKind>([
  "password",
  "ssh",
  "api-token",
  "secret-text",
]);
const SOURCES = new Set<CredentialSource>(["manual", "conversation"]);
const SSH_AUTHENTICATION = new Set<SshCredentialAuthentication>([
  "password",
  "private-key",
]);
const API_AUTHENTICATION = new Set<ApiCredentialAuthentication>([
  "bearer",
  "header",
]);
const AGENT_ACCESS = new Set<CredentialAgentAccess>([
  "requestable",
  "internal-only",
]);
const ITEM_KEYS = new Set([
  "id",
  "label",
  "kind",
  "service",
  "username",
  "endpoint",
  "sshAuthentication",
  "sshHostKey",
  "apiAuthentication",
  "apiHeaderName",
  "agentAccess",
  "projectIds",
  "source",
  "createdAt",
  "updatedAt",
]);
const RECORD_KEYS = new Set(["version", "credentialId", "secret"]);
const METADATA_KEYS = [
  "service",
  "username",
  "endpoint",
  "sshAuthentication",
  "sshHostKey",
  "apiAuthentication",
  "apiHeaderName",
  "agentAccess",
] as const;

type PersistedCredentialRecord = {
  version: 2;
  credentialId: string;
  secret: CredentialSecret;
};

export interface CredentialSecureStringStore {
  isAvailable(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class CredentialVaultStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialVaultStorageError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" && /^credential-[a-zA-Z0-9-]{16,80}$/u.test(value)
  );
}

function validProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 120 &&
    /^[\w.:-]+$/u.test(value)
  );
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeLabel(value: unknown) {
  if (typeof value !== "string") {
    throw new CredentialVaultStorageError("密码本名称必须为文本。");
  }
  const label = value.trim();
  if (!label || label.length > 100 || label.includes("\0")) {
    throw new CredentialVaultStorageError("密码本名称必须为 1 到 100 个字符。");
  }
  return label;
}

function normalizeOptionalText(
  value: unknown,
  label: string,
  maxLength: number,
) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new CredentialVaultStorageError(`${label}必须为文本。`);
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength || normalized.includes("\0")) {
    throw new CredentialVaultStorageError(`${label}超过安全长度限制。`);
  }
  return normalized;
}

function normalizeProjectIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new CredentialVaultStorageError("项目授权列表无效。");
  }
  const result = [...new Set(value)];
  if (result.some((projectId) => !validProjectId(projectId))) {
    throw new CredentialVaultStorageError("项目授权列表包含无效项目。");
  }
  return result.sort();
}

function normalizeKind(value: unknown) {
  if (!KINDS.has(value as CredentialKind)) {
    throw new CredentialVaultStorageError("密码本类型无效。");
  }
  return value as CredentialKind;
}

function normalizeSource(value: unknown) {
  if (!SOURCES.has(value as CredentialSource)) {
    throw new CredentialVaultStorageError("密码本来源无效。");
  }
  return value as CredentialSource;
}

function normalizeMetadata(input: CredentialMetadataInput) {
  const kind = normalizeKind(input.kind);
  const result: Pick<CredentialVaultItem, "label" | "kind" | "projectIds"> &
    Partial<
      Pick<
        CredentialVaultItem,
        | "service"
        | "username"
        | "endpoint"
        | "sshAuthentication"
        | "sshHostKey"
        | "apiAuthentication"
        | "apiHeaderName"
        | "agentAccess"
      >
    > = {
    label: normalizeLabel(input.label),
    kind,
    projectIds: normalizeProjectIds(input.projectIds),
  };
  const agentAccess = input.agentAccess ?? "requestable";
  if (!AGENT_ACCESS.has(agentAccess)) {
    throw new CredentialVaultStorageError("Agent 凭据访问策略无效。");
  }
  // Absence remains the backwards-compatible representation of requestable.
  if (agentAccess === "internal-only") result.agentAccess = agentAccess;
  if (kind === "password") {
    const service = normalizeOptionalText(input.service, "服务信息", 240);
    const username = normalizeOptionalText(input.username, "账号信息", 160);
    if (service) result.service = service;
    if (username) result.username = username;
    return result;
  }
  if (kind === "ssh") {
    if (
      !input.sshAuthentication ||
      !SSH_AUTHENTICATION.has(input.sshAuthentication)
    ) {
      throw new CredentialVaultStorageError("请选择 SSH 密码或私钥认证。");
    }
    const username = normalizeOptionalText(input.username, "默认用户名", 160);
    const endpoint = normalizeOptionalText(input.endpoint, "SSH 地址", 1_000);
    result.sshAuthentication = input.sshAuthentication;
    if (username) result.username = username;
    if (endpoint) result.endpoint = endpoint;
    if (input.sshHostKey !== undefined) {
      if (
        !endpoint ||
        !input.sshHostKey ||
        typeof input.sshHostKey !== "object" ||
        Array.isArray(input.sshHostKey) ||
        Object.keys(input.sshHostKey).length !== 2
      ) {
        throw new CredentialVaultStorageError("SSH 主机指纹无效。");
      }
      const algorithm = normalizeOptionalText(
        input.sshHostKey.algorithm,
        "SSH 主机密钥算法",
        120,
      );
      const fingerprint = normalizeOptionalText(
        input.sshHostKey.fingerprint,
        "SSH 主机指纹",
        240,
      );
      if (!algorithm || !fingerprint) {
        throw new CredentialVaultStorageError("SSH 主机指纹无效。");
      }
      result.sshHostKey = { algorithm, fingerprint };
    }
    return result;
  }
  if (kind === "api-token") {
    const service = normalizeOptionalText(input.service, "服务信息", 240);
    const username = normalizeOptionalText(input.username, "Key ID", 240);
    const endpoint = normalizeOptionalText(input.endpoint, "API 地址", 1_000);
    const authentication = input.apiAuthentication ?? "bearer";
    if (!API_AUTHENTICATION.has(authentication)) {
      throw new CredentialVaultStorageError("API 认证方式无效。");
    }
    result.apiAuthentication = authentication;
    if (service) result.service = service;
    if (username) result.username = username;
    if (endpoint) result.endpoint = endpoint;
    if (authentication === "header") {
      const headerName = normalizeOptionalText(
        input.apiHeaderName,
        "请求头名称",
        120,
      );
      if (!headerName || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(headerName)) {
        throw new CredentialVaultStorageError("请填写有效的 API 请求头名称。");
      }
      result.apiHeaderName = headerName;
    }
    return result;
  }
  return result;
}

function normalizedSecretText(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_SECRET_CHARACTERS ||
    value.includes("\0")
  ) {
    throw new CredentialVaultStorageError(
      `${label}必须为 1 到 ${MAX_SECRET_CHARACTERS} 个字符。`,
    );
  }
  return value;
}

function optionalSecretText(value: unknown, label: string) {
  if (value === undefined || value === "") return undefined;
  return normalizedSecretText(value, label);
}

function normalizeSecret(
  value: CredentialSecret,
  expectedKind: CredentialKind,
  expectedSshAuthentication?: SshCredentialAuthentication,
): CredentialSecret {
  if (!isRecord(value) || value.kind !== expectedKind) {
    throw new CredentialVaultStorageError("密码本类型与秘密内容不匹配。");
  }
  if (value.kind === "password") {
    if (!hasOnlyKeys(value, new Set(["kind", "password"]))) {
      throw new CredentialVaultStorageError("密码记录包含无效字段。");
    }
    return {
      kind: "password",
      password: normalizedSecretText(value.password, "密码"),
    };
  }
  if (value.kind === "ssh") {
    if (
      value.authentication !== expectedSshAuthentication ||
      !SSH_AUTHENTICATION.has(
        value.authentication as SshCredentialAuthentication,
      )
    ) {
      throw new CredentialVaultStorageError("SSH 认证方式与秘密内容不匹配。");
    }
    if (value.authentication === "password") {
      if (
        !hasOnlyKeys(value, new Set(["kind", "authentication", "password"]))
      ) {
        throw new CredentialVaultStorageError("SSH 密码记录包含无效字段。");
      }
      return {
        kind: "ssh",
        authentication: "password",
        password: normalizedSecretText(value.password, "SSH 密码"),
      };
    }
    if (
      value.authentication !== "private-key" ||
      !hasOnlyKeys(
        value,
        new Set([
          "kind",
          "authentication",
          "privateKey",
          "publicKey",
          "passphrase",
        ]),
      )
    ) {
      throw new CredentialVaultStorageError("SSH 私钥记录包含无效字段。");
    }
    const publicKey = optionalSecretText(value.publicKey, "SSH 公钥");
    const passphrase = optionalSecretText(value.passphrase, "私钥口令");
    return {
      kind: "ssh",
      authentication: "private-key",
      privateKey: normalizedSecretText(value.privateKey, "SSH 私钥"),
      ...(publicKey ? { publicKey } : {}),
      ...(passphrase ? { passphrase } : {}),
    };
  }
  if (value.kind === "api-token") {
    if (!hasOnlyKeys(value, new Set(["kind", "token"]))) {
      throw new CredentialVaultStorageError("API 凭据包含无效字段。");
    }
    return {
      kind: "api-token",
      token: normalizedSecretText(value.token, "访问令牌"),
    };
  }
  if (
    value.kind !== "secret-text" ||
    !hasOnlyKeys(value, new Set(["kind", "value"]))
  ) {
    throw new CredentialVaultStorageError("秘密文本包含无效字段。");
  }
  return {
    kind: "secret-text",
    value: normalizedSecretText(value.value, "秘密内容"),
  };
}

function metadataInputFromUnknown(value: Record<string, unknown>) {
  return {
    label: value.label,
    kind: value.kind,
    service: value.service,
    username: value.username,
    endpoint: value.endpoint,
    sshAuthentication: value.sshAuthentication,
    sshHostKey: value.sshHostKey,
    apiAuthentication: value.apiAuthentication,
    apiHeaderName: value.apiHeaderName,
    agentAccess: value.agentAccess,
    projectIds: value.projectIds,
  } as CredentialMetadataInput;
}

function metadataValueMatches(
  key: (typeof METADATA_KEYS)[number],
  stored: unknown,
  normalized: unknown,
) {
  if (key !== "sshHostKey") return stored === normalized;
  if (stored === undefined || normalized === undefined) {
    return stored === normalized;
  }
  return (
    isRecord(stored) &&
    isRecord(normalized) &&
    stored.algorithm === normalized.algorithm &&
    stored.fingerprint === normalized.fingerprint
  );
}

function assertItem(value: unknown): asserts value is CredentialVaultItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ITEM_KEYS) ||
    !validId(value.id) ||
    !SOURCES.has(value.source as CredentialSource) ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt)
  ) {
    throw new CredentialVaultStorageError("密码本索引已损坏，未读取任何秘密。");
  }
  let normalized: ReturnType<typeof normalizeMetadata>;
  try {
    normalized = normalizeMetadata(metadataInputFromUnknown(value));
  } catch {
    throw new CredentialVaultStorageError("密码本索引已损坏，未读取任何秘密。");
  }
  if (
    value.label !== normalized.label ||
    value.kind !== normalized.kind ||
    JSON.stringify(value.projectIds) !==
      JSON.stringify(normalized.projectIds) ||
    METADATA_KEYS.some(
      (key) => !metadataValueMatches(key, value[key], normalized[key]),
    )
  ) {
    throw new CredentialVaultStorageError("密码本索引已损坏，未读取任何秘密。");
  }
}

function assertRecord(
  value: unknown,
  item: CredentialVaultItem,
): asserts value is PersistedCredentialRecord {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, RECORD_KEYS) ||
    value.version !== 2 ||
    value.credentialId !== item.id ||
    !validId(value.credentialId) ||
    !isRecord(value.secret)
  ) {
    throw new CredentialVaultStorageError("密码本记录已损坏。");
  }
  normalizeSecret(
    value.secret as CredentialSecret,
    item.kind,
    item.sshAuthentication,
  );
}

function parseJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new CredentialVaultStorageError(message, { cause });
  }
}

export class CredentialVault implements InternalCredentialVaultPort {
  readonly #store: CredentialSecureStringStore;
  readonly #createId: () => string;
  readonly #now: () => Date;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    store: CredentialSecureStringStore,
    createId: () => string,
    now: () => Date = () => new Date(),
  ) {
    this.#store = store;
    this.#createId = createId;
    this.#now = now;
  }

  list(): Promise<CredentialVaultItem[]> {
    return this.#serialize(() => this.#loadIndex());
  }

  create(input: CreateCredentialInput): Promise<CredentialVaultItem> {
    return this.#serialize(async () => {
      const items = await this.#loadIndex();
      if (items.length >= MAX_ITEMS) {
        throw new CredentialVaultStorageError("密码本最多保存 100 条记录。");
      }
      const id = this.#createId();
      if (!validId(id) || items.some((item) => item.id === id)) {
        throw new CredentialVaultStorageError("无法生成安全的密码本记录 ID。");
      }
      const timestamp = this.#now().toISOString();
      const metadata = normalizeMetadata(input);
      const item: CredentialVaultItem = {
        id,
        ...metadata,
        source: normalizeSource(input.source),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const record: PersistedCredentialRecord = {
        version: 2,
        credentialId: id,
        secret: normalizeSecret(
          input.secret,
          item.kind,
          item.sshAuthentication,
        ),
      };
      try {
        await this.#store.set(this.#recordKey(id), JSON.stringify(record));
        await this.#saveIndex([...items, item]);
      } catch (cause) {
        await this.#store.remove(this.#recordKey(id)).catch(() => undefined);
        throw new CredentialVaultStorageError("密码本保存失败，消息未发送。", {
          cause,
        });
      }
      return item;
    });
  }

  update(
    credentialId: string,
    input: UpdateCredentialInput,
  ): Promise<CredentialVaultItem> {
    return this.#serialize(async () => {
      if (!validId(credentialId)) {
        throw new CredentialVaultStorageError("密码本记录 ID 无效。");
      }
      const items = await this.#loadIndex();
      const index = items.findIndex((item) => item.id === credentialId);
      const previous = items[index];
      if (!previous) {
        throw new CredentialVaultStorageError("密码本记录不存在。");
      }
      const metadata = normalizeMetadata(input);
      const authenticationChanged =
        previous.kind === "ssh" &&
        metadata.kind === "ssh" &&
        previous.sshAuthentication !== metadata.sshAuthentication;
      if (
        (previous.kind !== metadata.kind || authenticationChanged) &&
        !input.secret
      ) {
        throw new CredentialVaultStorageError(
          "更改凭据类型或认证方式时必须填写新内容。",
        );
      }
      const next: CredentialVaultItem = {
        id: previous.id,
        ...metadata,
        source: previous.source,
        createdAt: previous.createdAt,
        updatedAt: this.#now().toISOString(),
      };

      const recordKey = this.#recordKey(credentialId);
      const previousRecord = await this.#store.get(recordKey);
      if (!previousRecord) {
        throw new CredentialVaultStorageError("密码本秘密记录不存在。");
      }
      const nextItems = [...items];
      nextItems[index] = next;
      try {
        if (input.secret) {
          await this.#store.set(
            recordKey,
            JSON.stringify({
              version: 2,
              credentialId,
              secret: normalizeSecret(
                input.secret,
                next.kind,
                next.sshAuthentication,
              ),
            } satisfies PersistedCredentialRecord),
          );
        }
        await this.#saveIndex(nextItems);
      } catch (cause) {
        await this.#store.set(recordKey, previousRecord).catch(() => undefined);
        await this.#saveIndex(items).catch(() => undefined);
        throw new CredentialVaultStorageError(
          "密码本更新失败，原记录已保留。",
          { cause },
        );
      }
      return next;
    });
  }

  remove(credentialId: string): Promise<void> {
    return this.#serialize(async () => {
      if (!validId(credentialId)) {
        throw new CredentialVaultStorageError("密码本记录 ID 无效。");
      }
      const items = await this.#loadIndex();
      if (!items.some((item) => item.id === credentialId)) return;
      const recordKey = this.#recordKey(credentialId);
      const previousRecord = await this.#store.get(recordKey);
      try {
        await this.#store.remove(recordKey);
        await this.#saveIndex(items.filter((item) => item.id !== credentialId));
      } catch (cause) {
        if (previousRecord !== null) {
          await this.#store
            .set(recordKey, previousRecord)
            .catch(() => undefined);
        }
        await this.#saveIndex(items).catch(() => undefined);
        throw new CredentialVaultStorageError("密码本记录删除失败。", {
          cause,
        });
      }
    });
  }

  readForProject(
    credentialId: string,
    projectId: string,
  ): Promise<{ item: CredentialVaultItem; secret: CredentialSecret }> {
    return this.#serialize(async () => {
      if (!validId(credentialId) || !validProjectId(projectId)) {
        throw new CredentialVaultStorageError("密码本读取范围无效。");
      }
      const items = await this.#loadIndex();
      const item = items.find((candidate) => candidate.id === credentialId);
      if (!item || !item.projectIds.includes(projectId)) {
        throw new CredentialVaultStorageError(
          "当前项目没有这条密码本记录的授权。",
        );
      }
      return this.#readSecret(item);
    });
  }

  readInternal(
    credentialId: string,
  ): Promise<{ item: CredentialVaultItem; secret: CredentialSecret }> {
    return this.#serialize(async () => {
      if (!validId(credentialId)) {
        throw new CredentialVaultStorageError("密码本内部读取范围无效。");
      }
      const items = await this.#loadIndex();
      const item = items.find((candidate) => candidate.id === credentialId);
      if (!item || item.agentAccess !== "internal-only") {
        throw new CredentialVaultStorageError(
          "这条密码本记录不允许内部服务直接读取。",
        );
      }
      return this.#readSecret(item);
    });
  }

  async #readSecret(item: CredentialVaultItem) {
    const value = await this.#store.get(this.#recordKey(item.id));
    if (!value) {
      throw new CredentialVaultStorageError("密码本秘密记录不存在。");
    }
    const record = parseJson(value, "密码本秘密记录无法读取。");
    assertRecord(record, item);
    return {
      item,
      secret: normalizeSecret(record.secret, item.kind, item.sshAuthentication),
    };
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #assertAvailable() {
    if (!(await this.#store.isAvailable())) {
      throw new CredentialVaultStorageError(
        "当前设备不支持系统安全存储，密码本不可用。",
      );
    }
  }

  async #loadIndex(): Promise<CredentialVaultItem[]> {
    await this.#assertAvailable();
    const value = await this.#store.get(INDEX_KEY);
    if (!value) return [];
    const parsed = parseJson(value, "密码本索引无法读取。");
    if (!Array.isArray(parsed) || parsed.length > MAX_ITEMS) {
      throw new CredentialVaultStorageError("密码本索引已损坏。");
    }
    const seen = new Set<string>();
    for (const item of parsed) {
      assertItem(item);
      if (seen.has(item.id)) {
        throw new CredentialVaultStorageError("密码本索引包含重复记录。");
      }
      seen.add(item.id);
    }
    return (parsed as CredentialVaultItem[]).map((item) => ({
      ...item,
      projectIds: [...item.projectIds],
    }));
  }

  async #saveIndex(items: readonly CredentialVaultItem[]) {
    await this.#store.set(INDEX_KEY, JSON.stringify(items));
  }

  #recordKey(credentialId: string) {
    return `${RECORD_PREFIX}${credentialId}`;
  }
}
