import {
  Client,
  InsufficientScopeError,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";

import type {
  McpRemoteCallResult,
  McpRemoteClient,
  McpRemoteClientFactory,
  McpRemoteTool,
  McpServerRuntimeDefinition,
} from "./contracts.ts";
import { createMcpFetch, validatedMcpServerUrl } from "./security.ts";

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export type OfficialStreamableHttpClientFactoryOptions = Readonly<{
  clientName?: string;
  clientVersion?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}>;

function positiveTimeout(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 5 * 60_000) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function remoteTool(tool: Tool): McpRemoteTool {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    definition: tool,
  };
}

class OfficialRemoteClient implements McpRemoteClient {
  readonly client: Client;
  readonly requestTimeoutMs: number;
  readonly onInsufficientScope?: (requiredScope?: string) => Promise<void>;

  constructor(
    client: Client,
    requestTimeoutMs: number,
    onInsufficientScope?: (requiredScope?: string) => Promise<void>,
  ) {
    this.client = client;
    this.requestTimeoutMs = requestTimeoutMs;
    this.onInsufficientScope = onInsufficientScope;
  }

  serverInfo() {
    return {
      ...(this.client.getServerCapabilities() === undefined
        ? {}
        : { capabilities: this.client.getServerCapabilities() }),
      ...(this.client.getInstructions() === undefined
        ? {}
        : { instructions: this.client.getInstructions() }),
      ...(this.client.getProtocolEra() === undefined
        ? {}
        : { protocolEra: this.client.getProtocolEra() }),
      ...(this.client.getNegotiatedProtocolVersion() === undefined
        ? {}
        : { protocolVersion: this.client.getNegotiatedProtocolVersion() }),
      ...(this.client.getServerVersion() === undefined
        ? {}
        : { serverVersion: this.client.getServerVersion() }),
    };
  }

  setToolsChangedHandler(handler: () => void) {
    this.toolsChangedHandler = handler;
  }

  toolsChangedHandler: () => void = () => undefined;

  async listTools(options: { refresh?: boolean; signal?: AbortSignal } = {}) {
    const result = await this.#withScopeStepUp(() =>
      this.client.listTools(undefined, {
        cacheMode: options.refresh ? "refresh" : "use",
        maxTotalTimeout: this.requestTimeoutMs,
        signal: options.signal,
        timeout: this.requestTimeoutMs,
      }),
    );
    return result.tools.map(remoteTool);
  }

  async callTool(
    tool: McpRemoteTool,
    arguments_: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<McpRemoteCallResult> {
    const result: CallToolResult = await this.#withScopeStepUp(() =>
      this.client.callTool(
        { name: tool.name, arguments: arguments_ },
        {
          maxTotalTimeout: this.requestTimeoutMs,
          signal,
          timeout: this.requestTimeoutMs,
          ...(tool.definition
            ? { toolDefinition: tool.definition as Tool }
            : {}),
        },
      ),
    );
    return {
      content: result.content,
      ...(result.isError === undefined ? {} : { isError: result.isError }),
      ...(result.structuredContent === undefined
        ? {}
        : { structuredContent: result.structuredContent }),
    };
  }

  ping(signal?: AbortSignal) {
    return this.#withScopeStepUp(() =>
      this.client.ping(this.#requestOptions(signal)),
    );
  }

  async listPrompts(options: { refresh?: boolean; signal?: AbortSignal } = {}) {
    return this.#withScopeStepUp(() =>
      this.client.listPrompts(undefined, {
        ...this.#requestOptions(options.signal),
        cacheMode: options.refresh ? "refresh" : "use",
      }),
    );
  }

  getPrompt(
    name: string,
    arguments_: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ) {
    return this.#withScopeStepUp(() =>
      this.client.getPrompt(
        { name, arguments: arguments_ },
        this.#requestOptions(signal),
      ),
    );
  }

  async listResources(
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ) {
    return this.#withScopeStepUp(() =>
      this.client.listResources(undefined, {
        ...this.#requestOptions(options.signal),
        cacheMode: options.refresh ? "refresh" : "use",
      }),
    );
  }

  async listResourceTemplates(
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ) {
    return this.#withScopeStepUp(() =>
      this.client.listResourceTemplates(undefined, {
        ...this.#requestOptions(options.signal),
        cacheMode: options.refresh ? "refresh" : "use",
      }),
    );
  }

  readResource(
    uri: string,
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ) {
    return this.#withScopeStepUp(() =>
      this.client.readResource(
        { uri },
        {
          ...this.#requestOptions(options.signal),
          cacheMode: options.refresh ? "refresh" : "use",
        },
      ),
    );
  }

  complete(
    ref:
      | Readonly<{ type: "ref/prompt"; name: string }>
      | Readonly<{ type: "ref/resource"; uri: string }>,
    argument: Readonly<{ name: string; value: string }>,
    signal?: AbortSignal,
  ) {
    return this.#withScopeStepUp(() =>
      this.client.complete({ ref, argument }, this.#requestOptions(signal)),
    );
  }

  close() {
    return this.client.close();
  }

  #requestOptions(signal?: AbortSignal) {
    return {
      maxTotalTimeout: this.requestTimeoutMs,
      signal,
      timeout: this.requestTimeoutMs,
    };
  }

  async #withScopeStepUp<Value>(operation: () => Promise<Value>) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof InsufficientScopeError) ||
        !this.onInsufficientScope
      ) {
        throw error;
      }
      await this.onInsufficientScope(error.requiredScope);
      return operation();
    }
  }
}

export class OfficialStreamableHttpClientFactory implements McpRemoteClientFactory {
  readonly #clientName: string;
  readonly #clientVersion: string;
  readonly #connectTimeoutMs: number;
  readonly #requestTimeoutMs: number;

  constructor(options: OfficialStreamableHttpClientFactoryOptions = {}) {
    this.#clientName = options.clientName ?? "BoltPocket";
    this.#clientVersion = options.clientVersion ?? "0.1.0";
    this.#connectTimeoutMs = positiveTimeout(
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      "MCP connect timeout",
    );
    this.#requestTimeoutMs = positiveTimeout(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "MCP request timeout",
    );
  }

  async connect(server: McpServerRuntimeDefinition, signal?: AbortSignal) {
    const endpoint = validatedMcpServerUrl(server);
    let remote: OfficialRemoteClient | undefined;
    const client = new Client(
      { name: this.#clientName, version: this.#clientVersion },
      {
        defaultCacheTtlMs: 5 * 60_000,
        inputRequired: { autoFulfill: false },
        listChanged: {
          prompts: { onChanged: () => undefined },
          resources: { onChanged: () => undefined },
          tools: {
            onChanged: () => remote?.toolsChangedHandler(),
          },
        },
        listMaxPages: 32,
        versionNegotiation: {
          mode: "auto",
          probe: { maxRetries: 0, timeoutMs: 3_000 },
        },
      },
    );
    const transport = new StreamableHTTPClientTransport(endpoint, {
      ...(server.authProvider ? { authProvider: server.authProvider } : {}),
      fetch: createMcpFetch(server),
      maxStepUpRetries: isOAuthClientProvider(server.authProvider) ? 1 : 0,
      onInsufficientScope: isOAuthClientProvider(server.authProvider)
        ? "reauthorize"
        : "throw",
      reconnectionOptions: {
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 10_000,
        maxRetries: 1,
        reconnectionDelayGrowFactor: 1.5,
      },
      requestInit: { credentials: "omit", redirect: "manual" },
    });
    try {
      await client.connect(transport, {
        maxTotalTimeout: this.#connectTimeoutMs,
        signal,
        timeout: this.#connectTimeoutMs,
      });
      remote = new OfficialRemoteClient(
        client,
        this.#requestTimeoutMs,
        server.onInsufficientScope,
      );
      return remote;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }
}

function isOAuthClientProvider(
  provider: McpServerRuntimeDefinition["authProvider"],
) {
  return Boolean(
    provider &&
    "redirectToAuthorization" in provider &&
    typeof provider.redirectToAuthorization === "function",
  );
}
