import type { CredentialVaultItem } from "@/application/ports/credential-vault";
import type {
  ConnectSshCommandInput,
  SshHostKey,
} from "@/application/ports/ssh-command-sessions";

import {
  normalizeRemoteRoot,
  normalizeSshCommandAlias,
} from "./ssh-command-path.ts";

export type ParsedSshCredentialEndpoint = Readonly<{
  host: string;
  port: number;
  root?: string;
}>;

export function formatSshCredentialEndpoint(
  hostValue: string,
  portValue: string | number,
  rootValue?: string,
): string {
  const host = hostValue.trim();
  const port =
    typeof portValue === "number" ? portValue : Number(portValue.trim());
  if (!host) throw new Error("SSH 主机不能为空。");
  if (/[\u0000-\u0020\u007f/@\\?#]/u.test(host)) {
    throw new Error("SSH 主机无效。");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SSH 端口必须在 1 到 65535 之间。");
  }
  const authority =
    host.includes(":") && !(host.startsWith("[") && host.endsWith("]"))
      ? `[${host}]`
      : host;
  const root = rootValue ? normalizeRemoteRoot(rootValue) : undefined;
  const encodedRoot = root
    ? root
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")
    : "";
  const endpoint = `ssh://${authority}:${port}${encodedRoot}`;
  const parsed = parseSshCredentialEndpoint(endpoint);
  if (parsed.root !== root) throw new Error("SSH 主机无效。");
  return endpoint;
}

export function parseSshCredentialEndpoint(
  value: string,
): ParsedSshCredentialEndpoint {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("SSH 主机或端口无效。");
  }
  if (
    url.protocol !== "ssh:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("SSH 主机或端口无效，用户名请单独填写。");
  }
  const port = url.port ? Number(url.port) : 22;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SSH 端口必须在 1 到 65535 之间。");
  }
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (!url.pathname || url.pathname === "/") {
    return Object.freeze({ host, port });
  }
  let root: string;
  try {
    root = normalizeRemoteRoot(decodeURIComponent(url.pathname));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "SSH 目录无效。");
  }
  return Object.freeze({ host, port, root });
}

export function sshAliasForCredential(item: CredentialVaultItem) {
  const endpoint = item.endpoint
    ? parseSshCredentialEndpoint(item.endpoint)
    : undefined;
  const base = (endpoint?.host ?? item.label)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 20);
  const suffix = item.id
    .replace(/^credential-/u, "")
    .slice(-8)
    .toLowerCase();
  return normalizeSshCommandAlias(`${base || "host"}-${suffix}`);
}

export function sshConnectionInputFromCredential(
  item: CredentialVaultItem,
): ConnectSshCommandInput {
  if (
    item.kind !== "ssh" ||
    !item.endpoint ||
    !item.username ||
    !item.sshHostKey
  ) {
    throw new Error("这条 SSH 凭据缺少地址、用户名或已确认的主机指纹。");
  }
  const endpoint = parseSshCredentialEndpoint(item.endpoint);
  return {
    ...endpoint,
    alias: sshAliasForCredential(item),
    username: item.username,
    expectedHostKey: item.sshHostKey,
    credentialId: item.id,
    persistProfile: true,
  };
}

export function sameSshHostKey(
  left: SshHostKey | undefined,
  right: SshHostKey,
) {
  return (
    left?.algorithm === right.algorithm &&
    left.fingerprint === right.fingerprint
  );
}
