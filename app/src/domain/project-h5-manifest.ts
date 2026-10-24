import {
  BUILT_IN_PROJECT_RESOURCE_PACK_IDS,
  type BuiltInProjectResourcePackId,
} from "./builtin-project-resources.ts";
import {
  PROJECT_H5_PERMISSION_KEYS,
  PROJECT_H5_PERMISSION_MODES,
  PROJECT_H5_PERMISSION_MODE,
  type ProjectH5Permission,
  type ProjectH5PermissionMode,
} from "./project-h5-capability-catalog.ts";

export {
  PROJECT_H5_CAPABILITY_CATALOG,
  PROJECT_H5_PERMISSION_KEYS,
  PROJECT_H5_PERMISSION_MODES,
  PROJECT_H5_PERMISSION_MODE,
  projectH5CapabilityDefinition,
  type ProjectH5CapabilityDefinition,
  type ProjectH5Permission,
  type ProjectH5PermissionMode,
} from "./project-h5-capability-catalog.ts";

export const PROJECT_H5_MANIFEST_FILE = "boltpocket.h5.json";

export const PROJECT_H5_PROFILES = ["vanilla", "preact-htm", "phaser"] as const;

export type ProjectH5Profile = (typeof PROJECT_H5_PROFILES)[number];

export const PROJECT_H5_ADDONS = ["echarts"] as const;

export type ProjectH5Addon = (typeof PROJECT_H5_ADDONS)[number];

export type ProjectH5PermissionDeclaration = Readonly<{
  id: ProjectH5Permission;
  /** User-facing explanation shown by the host before granting this app access. */
  purpose: string;
  mode: ProjectH5PermissionMode;
  /** Declared network recipients that receive data used by this capability. */
  recipients?: readonly string[];
}>;

export type ProjectH5NetworkDeclaration = Readonly<{
  /** Stable identifier referenced by permission recipient declarations. */
  id: string;
  /** Exact canonical HTTPS or WSS origin, without path, query or credentials. */
  origin: string;
  /** User-facing explanation of why this recipient is contacted. */
  purpose: string;
}>;

export type ProjectH5Manifest = Readonly<{
  schema: 1 | 2 | 3;
  title: string;
  description?: string;
  entry: string;
  profile: ProjectH5Profile;
  addons: readonly ProjectH5Addon[];
  /** Optional for snapshots created before bundled resources were introduced. */
  resources?: readonly BuiltInProjectResourcePackId[];
  /** Normalized permission IDs used by the browser policy. */
  permissions: readonly ProjectH5Permission[];
  /** Present for schema 2 and 3. Permissioned schema 1 is rejected. */
  permissionDeclarations?: readonly ProjectH5PermissionDeclaration[];
  /** Present for schema 3. Older manifests are offline-only. */
  network?: readonly ProjectH5NetworkDeclaration[];
}>;

const MANIFEST_KEYS = new Set([
  "schema",
  "title",
  "description",
  "entry",
  "profile",
  "addons",
  "resources",
  "permissions",
  "network",
]);
const PROFILE_SET = new Set<string>(PROJECT_H5_PROFILES);
const ADDON_SET = new Set<string>(PROJECT_H5_ADDONS);
const RESOURCE_SET = new Set<string>(BUILT_IN_PROJECT_RESOURCE_PACK_IDS);
const PERMISSION_SET = new Set<string>(PROJECT_H5_PERMISSION_KEYS);
const PERMISSION_MODE_SET = new Set<string>(PROJECT_H5_PERMISSION_MODES);
const NETWORK_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/u;
const MAX_NETWORK_DECLARATIONS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function visibleText(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string") {
    throw new Error(`H5 清单的${label}无效。`);
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized ||
    [...normalized].length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error(`H5 清单的${label}无效。`);
  }
  return normalized;
}

function stringArray<T extends string>(
  value: unknown,
  label: string,
  allowed: ReadonlySet<string>,
  maximumItems: number,
) {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    value.some((item) => typeof item !== "string" || !allowed.has(item)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`H5 清单的${label}无效。`);
  }
  return Object.freeze([...value]) as readonly T[];
}

function safeEntry(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.html?$/u.test(value) ||
    value.includes("\\") ||
    value
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("H5 清单的入口无效。");
  }
  return value;
}

export function createDefaultProjectH5Manifest(
  entry: string,
  title = "H5 小程序",
): ProjectH5Manifest {
  return Object.freeze({
    schema: 3,
    title: visibleText(title, "名称", 80),
    entry: safeEntry(entry),
    profile: "preact-htm",
    addons: Object.freeze([]),
    resources: Object.freeze([]),
    permissions: Object.freeze([]),
    permissionDeclarations: Object.freeze([]),
    network: Object.freeze([]),
  });
}

export function projectH5PermissionDeclarations(
  manifest: ProjectH5Manifest,
): readonly ProjectH5PermissionDeclaration[] {
  if (manifest.permissionDeclarations !== undefined) {
    return manifest.permissionDeclarations;
  }
  return Object.freeze([]);
}

export function projectH5NetworkDeclarations(
  manifest: ProjectH5Manifest,
): readonly ProjectH5NetworkDeclaration[] {
  return manifest.network ?? Object.freeze([]);
}

export function parseProjectH5Manifest(
  source: string,
  expectedEntry: string,
): ProjectH5Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("H5 清单不是有效的 JSON。");
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).some((key) => !MANIFEST_KEYS.has(key)) ||
    (parsed.schema !== 1 && parsed.schema !== 2 && parsed.schema !== 3) ||
    (parsed.schema !== 3 && Object.hasOwn(parsed, "network"))
  ) {
    throw new Error("H5 清单结构无效。");
  }
  const entry = safeEntry(parsed.entry);
  if (entry !== expectedEntry) {
    throw new Error("H5 清单入口与当前预览文件不一致。");
  }
  if (typeof parsed.profile !== "string" || !PROFILE_SET.has(parsed.profile)) {
    throw new Error("H5 清单的场景框架无效。");
  }
  const addons = stringArray<ProjectH5Addon>(
    parsed.addons,
    "附加组件",
    ADDON_SET,
    1,
  );
  if (parsed.profile === "phaser" && addons.length > 0) {
    throw new Error("游戏运行时不能叠加数据图表组件。");
  }
  const description =
    parsed.description === undefined
      ? undefined
      : visibleText(parsed.description, "简介", 240);
  const legacyPermissions =
    parsed.schema === 1
      ? stringArray<ProjectH5Permission>(
          parsed.permissions,
          "权限",
          PERMISSION_SET,
          PROJECT_H5_PERMISSION_KEYS.length,
        )
      : undefined;
  if (legacyPermissions && legacyPermissions.length > 0) {
    throw new Error(
      "旧版 H5 清单不能声明设备能力，请升级到 schema 3 并填写逐项用途。",
    );
  }
  const network =
    parsed.schema === 3 ? parseNetworkDeclarations(parsed.network) : undefined;
  const permissionDeclarations =
    parsed.schema === 1
      ? undefined
      : parsePermissionDeclarations(
          parsed.permissions,
          new Set(network?.map(({ id }) => id) ?? []),
          parsed.schema === 3,
          Boolean(network?.length),
        );
  const permissions = Object.freeze(
    permissionDeclarations?.map(({ id }) => id) ?? legacyPermissions ?? [],
  );
  return Object.freeze({
    schema: parsed.schema,
    title: visibleText(parsed.title, "名称", 80),
    ...(description ? { description } : {}),
    entry,
    profile: parsed.profile as ProjectH5Profile,
    addons,
    resources: stringArray<BuiltInProjectResourcePackId>(
      parsed.resources ?? [],
      "内置资源",
      RESOURCE_SET,
      BUILT_IN_PROJECT_RESOURCE_PACK_IDS.length,
    ),
    permissions,
    ...(permissionDeclarations === undefined ? {} : { permissionDeclarations }),
    ...(network === undefined ? {} : { network }),
  });
}

function parsePermissionDeclarations(
  value: unknown,
  networkIds: ReadonlySet<string>,
  allowRecipients: boolean,
  requireRecipients: boolean,
): readonly ProjectH5PermissionDeclaration[] {
  if (
    !Array.isArray(value) ||
    value.length > PROJECT_H5_PERMISSION_KEYS.length
  ) {
    throw new Error("H5 清单的权限无效。");
  }
  const declarations = value.map((item) => {
    const keys = isRecord(item) ? Object.keys(item) : [];
    if (
      !isRecord(item) ||
      keys.some(
        (key) =>
          key !== "id" &&
          key !== "purpose" &&
          key !== "mode" &&
          key !== "recipients",
      ) ||
      keys.length < 3 ||
      keys.length > 4 ||
      !Object.hasOwn(item, "id") ||
      !Object.hasOwn(item, "purpose") ||
      !Object.hasOwn(item, "mode") ||
      typeof item.id !== "string" ||
      !PERMISSION_SET.has(item.id) ||
      typeof item.mode !== "string" ||
      !PERMISSION_MODE_SET.has(item.mode)
    ) {
      throw new Error("H5 清单的权限无效。");
    }
    const id = item.id as ProjectH5Permission;
    const mode = item.mode as ProjectH5PermissionMode;
    if (mode !== PROJECT_H5_PERMISSION_MODE[id]) {
      throw new Error(`H5 清单权限 ${id} 的授权方式无效。`);
    }
    if (!allowRecipients && Object.hasOwn(item, "recipients")) {
      throw new Error(
        "schema 2 的 H5 清单不能声明数据接收方。请升级到 schema 3。",
      );
    }
    if (requireRecipients && !Object.hasOwn(item, "recipients")) {
      throw new Error(
        "联网的 schema 3 H5 清单必须为每项设备能力明确填写 recipients；本地处理请填写空数组。",
      );
    }
    const recipients =
      item.recipients === undefined
        ? undefined
        : parseNetworkRecipientIds(item.recipients, networkIds);
    return Object.freeze({
      id,
      mode,
      purpose: visibleText(item.purpose, "权限用途", 160),
      ...(recipients === undefined ? {} : { recipients }),
    });
  });
  if (new Set(declarations.map(({ id }) => id)).size !== declarations.length) {
    throw new Error("H5 清单的权限无效。");
  }
  return Object.freeze(declarations);
}

function parseNetworkRecipientIds(
  value: unknown,
  networkIds: ReadonlySet<string>,
) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_NETWORK_DECLARATIONS ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !NETWORK_ID_PATTERN.test(item) ||
        !networkIds.has(item),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("H5 清单的权限数据接收方无效。");
  }
  return Object.freeze([...value]) as readonly string[];
}

function canonicalNetworkOrigin(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("H5 清单的联网来源无效。");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("H5 清单的联网来源无效。");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "wss:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    value !== url.origin
  ) {
    throw new Error(
      "H5 清单的联网来源必须是精确、规范的 HTTPS 或 WSS origin。",
    );
  }
  return url.origin;
}

function parseNetworkDeclarations(
  value: unknown,
): readonly ProjectH5NetworkDeclaration[] {
  if (!Array.isArray(value) || value.length > MAX_NETWORK_DECLARATIONS) {
    throw new Error("H5 清单的联网声明无效。");
  }
  const declarations = value.map((item) => {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 3 ||
      !Object.hasOwn(item, "id") ||
      !Object.hasOwn(item, "origin") ||
      !Object.hasOwn(item, "purpose") ||
      typeof item.id !== "string" ||
      !NETWORK_ID_PATTERN.test(item.id)
    ) {
      throw new Error("H5 清单的联网声明无效。");
    }
    return Object.freeze({
      id: item.id,
      origin: canonicalNetworkOrigin(item.origin),
      purpose: visibleText(item.purpose, "联网用途", 160),
    });
  });
  if (
    new Set(declarations.map(({ id }) => id)).size !== declarations.length ||
    new Set(declarations.map(({ origin }) => origin)).size !==
      declarations.length
  ) {
    throw new Error("H5 清单的联网声明无效。");
  }
  return Object.freeze(declarations);
}
