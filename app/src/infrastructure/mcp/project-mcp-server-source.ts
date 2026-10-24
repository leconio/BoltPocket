import type {
  McpServerRuntimeDefinition,
  McpServerSource,
} from "@boltpocket/mcp-client";

import type {
  CredentialVaultItem,
  InternalCredentialVaultPort,
} from "@/application/ports/credential-vault";
import type {
  McpConnection,
  McpConnectionRepositoryPort,
  McpOAuthPort,
} from "@/application/ports/mcp-connections";

function exactSecretRedactor(secrets: Set<string>) {
  return (value: string) => {
    let result = value;
    for (const secret of [...secrets].sort(
      (left, right) => right.length - left.length,
    )) {
      if (secret) result = result.split(secret).join("••••");
    }
    return result;
  };
}

function sameOrigin(left: string | undefined, right: string) {
  if (!left) return false;
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export class ProjectMcpServerSource implements McpServerSource {
  readonly #connections: McpConnectionRepositoryPort;
  readonly #fetch?: typeof fetch;
  readonly #vault: InternalCredentialVaultPort;
  readonly #oauth?: McpOAuthPort;

  constructor(options: {
    connections: McpConnectionRepositoryPort;
    fetch?: typeof fetch;
    vault: InternalCredentialVaultPort;
    oauth?: McpOAuthPort;
  }) {
    this.#connections = options.connections;
    this.#fetch = options.fetch;
    this.#vault = options.vault;
    this.#oauth = options.oauth;
  }

  async listForProject(_projectId: string) {
    const [connections, credentials] = await Promise.all([
      this.#connections.list(),
      this.#vault.list(),
    ]);
    const credentialsById = new Map(
      credentials.map((credential) => [credential.id, credential]),
    );
    return connections
      .filter((connection) => connection.enabled)
      .map((connection) =>
        this.#runtimeDefinition(
          connection,
          connection.authentication.kind === "vault-token"
            ? connection.authentication.credentialIds.map((credentialId) =>
                credentialsById.get(credentialId),
              )
            : [],
        ),
      );
  }

  #runtimeDefinition(
    connection: McpConnection,
    credentials: readonly (CredentialVaultItem | undefined)[],
  ): McpServerRuntimeDefinition {
    const secrets = new Set<string>();
    const credentialRevision = credentials
      .map((credential) => credential?.updatedAt ?? "missing")
      .join(":");
    const common = {
      id: connection.id,
      name: connection.name,
      url: connection.serverUrl,
      revision: `${connection.updatedAt}:${credentialRevision || "none"}`,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
      ...(connection.allowedToolNames
        ? { allowedToolNames: connection.allowedToolNames }
        : {}),
      ...(connection.approveTools
        ? { approveTools: connection.approveTools }
        : {}),
      trustToolAnnotations: connection.trustToolAnnotations,
      redact: exactSecretRedactor(secrets),
    } satisfies Omit<
      McpServerRuntimeDefinition,
      "authProvider" | "requestHeaders" | "requestQuery"
    >;

    if (connection.authentication.kind === "none") return common;
    if (connection.authentication.kind === "oauth") {
      let authorizationId = connection.authentication.authorizationId;
      return {
        ...common,
        authProvider: {
          token: async () => {
            if (!this.#oauth) {
              throw new Error("当前构建尚未配置 MCP OAuth broker。");
            }
            const lease = await this.#oauth.lease(
              authorizationId,
              connection.serverUrl,
            );
            secrets.add(lease.accessToken);
            return lease.accessToken;
          },
          ...(this.#oauth?.invalidate
            ? {
                onUnauthorized: async () => {
                  await this.#oauth!.invalidate!(authorizationId);
                },
              }
            : {}),
        },
        onInsufficientScope: async (requiredScope) => {
          if (!this.#oauth) {
            throw new Error("当前构建尚未配置 MCP OAuth broker。");
          }
          const upgraded = await this.#oauth.connect(
            connection.serverUrl,
            requiredScope?.split(/\s+/u).filter(Boolean) ?? [],
          );
          if (!upgraded) throw new Error("MCP OAuth 增量授权已取消。");
          const previousAuthorizationId = authorizationId;
          const input = {
            projectId: null,
            name: connection.name,
            serverUrl: connection.serverUrl,
            authentication: {
              kind: "oauth" as const,
              authorizationId: upgraded.authorizationId,
            },
            enabled: connection.enabled,
            trustToolAnnotations: connection.trustToolAnnotations,
            ...(connection.allowedToolNames
              ? { allowedToolNames: connection.allowedToolNames }
              : {}),
            ...(connection.approveTools
              ? { approveTools: connection.approveTools }
              : {}),
          };
          try {
            await this.#connections.update(connection.id, input);
            await this.#oauth.disconnect(previousAuthorizationId);
            authorizationId = upgraded.authorizationId;
          } catch (error) {
            await this.#connections
              .update(connection.id, {
                ...input,
                authentication: {
                  kind: "oauth",
                  authorizationId: previousAuthorizationId,
                },
              })
              .catch(() => undefined);
            await this.#oauth
              .disconnect(upgraded.authorizationId)
              .catch(() => undefined);
            throw error;
          }
        },
      };
    }

    const credentialIds = connection.authentication.credentialIds;
    const read = async (credentialId: string) => {
      const resolved = await this.#vault.readInternal(credentialId);
      if (
        resolved.item.kind !== "api-token" ||
        resolved.secret.kind !== "api-token" ||
        resolved.item.agentAccess !== "internal-only"
      ) {
        throw new Error("MCP 连接引用的密码本记录不是内部 API Token。");
      }
      if (!sameOrigin(resolved.item.endpoint, connection.serverUrl)) {
        throw new Error("MCP Token 的密码本服务地址与连接地址不同源。");
      }
      secrets.add(resolved.secret.token);
      return { item: resolved.item, token: resolved.secret.token };
    };
    if (credentials.some((credential) => !credential)) {
      return {
        ...common,
        requestHeaders: async () => {
          throw new Error("MCP 连接引用的密码本记录不存在。");
        },
      };
    }
    const queryParameterName = connection.authentication.queryParameterName;
    if (queryParameterName) {
      return {
        ...common,
        requestQuery: async () => {
          const resolved = await read(credentialIds[0]!);
          return {
            [queryParameterName]: resolved.token,
          };
        },
      };
    }
    const firstCredential = credentials[0]!;
    if (
      credentialIds.length > 1 ||
      firstCredential.apiAuthentication === "header"
    ) {
      return {
        ...common,
        requestHeaders: async () => {
          const headers: Record<string, string> = {};
          const normalizedHeaderNames = new Set<string>();
          for (const credentialId of credentialIds) {
            const resolved = await read(credentialId);
            const headerName = resolved.item.apiHeaderName;
            const normalizedHeaderName = headerName?.toLowerCase();
            if (
              resolved.item.apiAuthentication !== "header" ||
              !headerName ||
              !normalizedHeaderName
            ) {
              throw new Error("MCP Token 的自定义 Header 名称缺失。");
            }
            if (normalizedHeaderNames.has(normalizedHeaderName)) {
              throw new Error("MCP Token 的自定义 Header 名称重复。");
            }
            normalizedHeaderNames.add(normalizedHeaderName);
            headers[headerName] = resolved.token;
          }
          return headers;
        },
      };
    }
    return {
      ...common,
      authProvider: {
        token: async () => (await read(credentialIds[0]!)).token,
      },
    };
  }
}
