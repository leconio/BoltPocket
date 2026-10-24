import type {
  McpExecutionContext,
  McpProxyInput,
  McpProxyPort,
  McpRemoteClient,
  McpRemoteClientFactory,
  McpRemoteTool,
  McpServerRuntimeDefinition,
  McpServerSource,
  McpToolApprovalPort,
  McpToolRisk,
  McpToolSummary,
} from "./contracts.ts";

const DEFAULT_RESULT_LIMIT = 12;
const MAX_RESULT_LIMIT = 50;
const DEFAULT_CATALOG_TTL_MS = 5 * 60_000;
const DEFAULT_CONNECTION_IDLE_MS = 15_000;
const MAX_SCHEMA_CHARACTERS = 64 * 1024;
const MAX_ARGUMENT_CHARACTERS = 64 * 1024;
const MAX_RESULT_CHARACTERS = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const MAX_URI_CHARACTERS = 8 * 1024;
const MAX_PATTERN_CHARACTERS = 240;

type CatalogSlot = {
  revision: string;
  client?: McpRemoteClient;
  clientPromise?: Promise<McpRemoteClient>;
  tools?: readonly McpRemoteTool[];
  toolsLoadedAt?: number;
  toolsPromise?: Promise<readonly McpRemoteTool[]>;
};

type IdleTimer = ReturnType<typeof setTimeout>;

export class McpProxyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpProxyError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkedLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_RESULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULT_LIMIT) {
    throw new McpProxyError(`limit must be between 1 and ${MAX_RESULT_LIMIT}.`);
  }
  return value;
}

function checkedIdentifier(value: string, label: string) {
  if (!SAFE_ID.test(value)) {
    throw new McpProxyError(`${label} is invalid.`);
  }
  return value;
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("MCP operation was cancelled.");
  error.name = "AbortError";
  throw error;
}

function normalizedTools(tools: readonly McpRemoteTool[]) {
  if (tools.length > 10_000) {
    throw new McpProxyError("MCP server returned too many tools.");
  }
  const names = new Set<string>();
  return tools.map((tool) => {
    checkedIdentifier(tool.name, "MCP tool name");
    if (names.has(tool.name)) {
      throw new McpProxyError(
        `MCP server returned duplicate tool: ${tool.name}`,
      );
    }
    names.add(tool.name);
    if (
      (tool.title && tool.title.length > 500) ||
      (tool.description && tool.description.length > 8_000)
    ) {
      throw new McpProxyError(`MCP tool metadata is too large: ${tool.name}`);
    }
    if (
      serializedLength({
        annotations: tool.annotations,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      }) > MAX_SCHEMA_CHARACTERS
    ) {
      throw new McpProxyError(`MCP tool schema is too large: ${tool.name}`);
    }
    return tool;
  });
}

function toolRisk(
  server: McpServerRuntimeDefinition,
  tool: McpRemoteTool,
): McpToolRisk {
  if (tool.annotations?.destructiveHint === true) return "destructive";
  if (
    server.trustToolAnnotations === true &&
    tool.annotations?.readOnlyHint === true
  ) {
    return "read";
  }
  if (tool.annotations?.readOnlyHint === false) return "write";
  return "unknown";
}

function globMatches(pattern: string, value: string) {
  if (
    !pattern ||
    pattern.length > MAX_PATTERN_CHARACTERS ||
    /[\u0000-\u001f\u007f]/u.test(pattern)
  ) {
    throw new McpProxyError("MCP approval pattern is invalid.");
  }
  const source = [...pattern]
    .map((character) => {
      if (character === "*") return ".*";
      if (character === "?") return ".";
      return character.replace(/[\\^$+?.()|{}[\]]/gu, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`, "u").test(value);
}

function matchesApprovalPattern(
  server: McpServerRuntimeDefinition,
  tool: McpRemoteTool,
) {
  return (server.approveTools ?? []).some(
    (pattern) =>
      globMatches(pattern, tool.name) ||
      globMatches(pattern, `${server.id}/${tool.name}`),
  );
}

function callableState(
  server: McpServerRuntimeDefinition,
  tool: McpRemoteTool,
): Pick<
  McpToolSummary,
  "approvalRequired" | "callable" | "callableReason" | "risk"
> {
  const risk = toolRisk(server, tool);
  if (server.allowedToolNames && !server.allowedToolNames.includes(tool.name)) {
    return {
      approvalRequired: true,
      callable: false,
      callableReason: "not-allowed",
      risk,
    };
  }
  return {
    approvalRequired: risk !== "read" || matchesApprovalPattern(server, tool),
    callable: true,
    risk,
  };
}

function summary(
  server: McpServerRuntimeDefinition,
  tool: McpRemoteTool,
): McpToolSummary {
  return {
    serverId: server.id,
    serverName: server.name,
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description
      ? { description: tool.description.slice(0, 1_000) }
      : {}),
    ...callableState(server, tool),
  };
}

function searchTerms(query: string) {
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("en");
  if (!normalized || normalized.length > 240 || normalized.includes("\0")) {
    throw new McpProxyError("MCP tool search query is invalid.");
  }
  return {
    normalized,
    terms: [
      ...new Set(normalized.split(/[^\p{L}\p{N}._:-]+/gu).filter(Boolean)),
    ],
  };
}

function searchScore(
  server: McpServerRuntimeDefinition,
  tool: McpRemoteTool,
  query: ReturnType<typeof searchTerms>,
) {
  const name = tool.name.toLocaleLowerCase("en");
  const title = (tool.title ?? "").toLocaleLowerCase("en");
  const description = (tool.description ?? "").toLocaleLowerCase("en");
  const serverName = server.name.toLocaleLowerCase("en");
  let score = 0;
  if (name === query.normalized) score += 2_000;
  else if (name.startsWith(query.normalized)) score += 1_200;
  else if (name.includes(query.normalized)) score += 800;
  if (title === query.normalized) score += 1_000;
  else if (title.includes(query.normalized)) score += 500;
  if (description.includes(query.normalized)) score += 180;
  if (serverName.includes(query.normalized)) score += 120;
  for (const term of query.terms) {
    if (name.includes(term)) score += 240;
    if (title.includes(term)) score += 140;
    if (description.includes(term)) score += 40;
    if (serverName.includes(term)) score += 30;
  }
  return score;
}

function boundedValue(
  value: unknown,
  state: { characters: number; truncated: boolean },
  depth = 0,
): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    const available = Math.max(0, MAX_RESULT_CHARACTERS - state.characters);
    const selected = value.slice(0, Math.min(16_384, available));
    state.characters += selected.length;
    if (selected.length < value.length) state.truncated = true;
    return selected;
  }
  if (typeof value !== "object" || depth >= 12) {
    state.truncated = true;
    return "[omitted]";
  }
  if (Array.isArray(value)) {
    if (value.length > 100) state.truncated = true;
    return value
      .slice(0, 100)
      .map((item) => boundedValue(item, state, depth + 1));
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) state.truncated = true;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of entries.slice(0, 100)) {
    if (key === "data" || key === "blob") {
      result[key] = "[binary omitted]";
      state.truncated = true;
      continue;
    }
    result[key.slice(0, 240)] = boundedValue(entry, state, depth + 1);
  }
  return result;
}

function boundedResult(value: unknown) {
  const state = { characters: 0, truncated: false };
  const result = boundedValue(value, state);
  return state.truncated
    ? { value: result, truncated: true, limitCharacters: MAX_RESULT_CHARACTERS }
    : result;
}

function serializedLength(value: unknown) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new McpProxyError("MCP value is not valid JSON.", { cause: error });
  }
  return serialized.length;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new McpProxyError("MCP value contains a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (!isRecord(value)) {
    throw new McpProxyError("MCP value is not deterministic JSON.");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function toolFingerprint(tool: McpRemoteTool) {
  return canonicalJson({
    annotations: tool.annotations ?? null,
    inputSchema: tool.inputSchema,
    name: tool.name,
    outputSchema: tool.outputSchema ?? null,
  });
}

function redactedError(server: McpServerRuntimeDefinition, error: unknown) {
  const raw = error instanceof Error ? error.message : "Unknown MCP error.";
  const redacted = server.redact ? server.redact(raw) : raw;
  return redacted.replace(/[\r\n\0]+/gu, " ").slice(0, 1_000);
}

export class McpProxyService implements McpProxyPort {
  readonly #source: McpServerSource;
  readonly #factory: McpRemoteClientFactory;
  readonly #catalogTtlMs: number;
  readonly #connectionIdleMs: number;
  readonly #now: () => number;
  readonly #scheduleIdle: (callback: () => void, delayMs: number) => IdleTimer;
  readonly #cancelIdle: (timer: IdleTimer) => void;
  readonly #approval?: McpToolApprovalPort;
  readonly #slots = new Map<string, CatalogSlot>();
  readonly #activeOperations = new Map<string, number>();
  readonly #idleTimers = new Map<string, IdleTimer>();

  constructor(options: {
    source: McpServerSource;
    factory: McpRemoteClientFactory;
    catalogTtlMs?: number;
    connectionIdleMs?: number;
    now?: () => number;
    scheduleIdle?: (callback: () => void, delayMs: number) => IdleTimer;
    cancelIdle?: (timer: IdleTimer) => void;
    approval?: McpToolApprovalPort;
  }) {
    this.#source = options.source;
    this.#factory = options.factory;
    this.#catalogTtlMs = options.catalogTtlMs ?? DEFAULT_CATALOG_TTL_MS;
    this.#connectionIdleMs =
      options.connectionIdleMs ?? DEFAULT_CONNECTION_IDLE_MS;
    this.#now = options.now ?? Date.now;
    this.#scheduleIdle = options.scheduleIdle ?? setTimeout;
    this.#cancelIdle = options.cancelIdle ?? clearTimeout;
    this.#approval = options.approval;
    if (
      !Number.isSafeInteger(this.#catalogTtlMs) ||
      this.#catalogTtlMs < 0 ||
      this.#catalogTtlMs > 24 * 60 * 60_000
    ) {
      throw new Error("MCP catalog TTL is invalid.");
    }
    if (
      !Number.isSafeInteger(this.#connectionIdleMs) ||
      this.#connectionIdleMs < 0 ||
      this.#connectionIdleMs > 24 * 60 * 60_000
    ) {
      throw new Error("MCP connection idle timeout is invalid.");
    }
  }

  async execute(
    projectId: string,
    input: McpProxyInput,
    signal?: AbortSignal,
    context?: McpExecutionContext,
  ) {
    checkedIdentifier(projectId, "Project ID");
    throwIfAborted(signal);
    this.#beginOperation(projectId);
    try {
      if (input.action === "status") return await this.#status(projectId);
      if (input.action === "list") {
        return await this.#list(projectId, input, signal);
      }
      if (input.action === "search") {
        return await this.#search(projectId, input, signal);
      }
      if (input.action === "schema") {
        return await this.#schema(projectId, input, signal);
      }
      if (input.action === "call") {
        return await this.#call(projectId, input, signal, context);
      }
      return await this.#protocolOperation(projectId, input, signal);
    } finally {
      this.#finishOperation(projectId);
    }
  }

  /**
   * Keep a project's Streamable HTTP sessions alive across the gaps between
   * tool calls in one Agent run. The returned release is idempotent; once the
   * run ends, the normal idle timer retires the network clients while keeping
   * their lazy tool catalogs cached.
   */
  retainProject(projectId: string) {
    checkedIdentifier(projectId, "Project ID");
    this.#beginOperation(projectId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#finishOperation(projectId);
    };
  }

  async closeProject(projectId: string) {
    this.#cancelIdleTimer(projectId);
    this.#activeOperations.delete(projectId);
    const prefix = `${projectId}\0`;
    const closing: Promise<void>[] = [];
    for (const [key, slot] of this.#slots) {
      if (!key.startsWith(prefix)) continue;
      this.#slots.delete(key);
      if (slot.client) closing.push(slot.client.close());
      else if (slot.clientPromise) {
        closing.push(
          slot.clientPromise
            .then((client) => client.close())
            .catch(() => undefined),
        );
      }
    }
    await Promise.allSettled(closing);
  }

  async closeAll() {
    const projects = new Set([
      ...[...this.#slots.keys()].map((key) => key.slice(0, key.indexOf("\0"))),
      ...this.#idleTimers.keys(),
      ...this.#activeOperations.keys(),
    ]);
    await Promise.allSettled([...projects].map((id) => this.closeProject(id)));
  }

  #beginOperation(projectId: string) {
    this.#cancelIdleTimer(projectId);
    this.#activeOperations.set(
      projectId,
      (this.#activeOperations.get(projectId) ?? 0) + 1,
    );
  }

  #finishOperation(projectId: string) {
    const remaining = (this.#activeOperations.get(projectId) ?? 1) - 1;
    if (remaining > 0) {
      this.#activeOperations.set(projectId, remaining);
      return;
    }
    this.#activeOperations.delete(projectId);
    this.#cancelIdleTimer(projectId);
    const prefix = `${projectId}\0`;
    const hasLiveClient = [...this.#slots.entries()].some(
      ([key, slot]) =>
        key.startsWith(prefix) && Boolean(slot.client ?? slot.clientPromise),
    );
    if (!hasLiveClient) return;
    const timer = this.#scheduleIdle(() => {
      if (this.#idleTimers.get(projectId) !== timer) return;
      this.#idleTimers.delete(projectId);
      if ((this.#activeOperations.get(projectId) ?? 0) > 0) return;
      void this.#suspendProjectClients(projectId);
    }, this.#connectionIdleMs);
    const unref = (timer as unknown as { unref?: unknown }).unref;
    if (typeof unref === "function") unref.call(timer);
    this.#idleTimers.set(projectId, timer);
  }

  #cancelIdleTimer(projectId: string) {
    const timer = this.#idleTimers.get(projectId);
    if (!timer) return;
    this.#idleTimers.delete(projectId);
    this.#cancelIdle(timer);
  }

  async #suspendProjectClients(projectId: string) {
    const prefix = `${projectId}\0`;
    const closing: Promise<void>[] = [];
    for (const [key, slot] of this.#slots) {
      if (!key.startsWith(prefix)) continue;
      if (slot.client) {
        const client = slot.client;
        slot.client = undefined;
        closing.push(client.close());
      } else if (slot.clientPromise) {
        const connecting = slot.clientPromise;
        slot.clientPromise = undefined;
        closing.push(
          connecting.then((client) => client.close()).catch(() => undefined),
        );
      }
    }
    await Promise.allSettled(closing);
  }

  async #servers(projectId: string) {
    const servers = [...(await this.#source.listForProject(projectId))];
    if (servers.length > 100) {
      throw new McpProxyError(
        "Too many MCP servers are enabled for this project.",
      );
    }
    const ids = new Set<string>();
    for (const server of servers) {
      checkedIdentifier(server.id, "MCP server ID");
      if (ids.has(server.id)) {
        throw new McpProxyError(`Duplicate MCP server ID: ${server.id}`);
      }
      ids.add(server.id);
      if (
        !server.name.trim() ||
        server.name.length > 160 ||
        !server.revision ||
        server.revision.length > 240
      ) {
        throw new McpProxyError(`MCP server metadata is invalid: ${server.id}`);
      }
      for (const pattern of server.approveTools ?? []) {
        globMatches(pattern, "validation-only");
      }
    }
    return servers.sort(
      (left, right) =>
        left.name.localeCompare(right.name, "en") ||
        left.id.localeCompare(right.id, "en"),
    );
  }

  async #selectedServers(projectId: string, serverId?: string) {
    const servers = await this.#servers(projectId);
    if (!serverId) return servers;
    checkedIdentifier(serverId, "MCP server ID");
    const server = servers.find((candidate) => candidate.id === serverId);
    if (!server) {
      throw new McpProxyError(
        `MCP server is not enabled for this project: ${serverId}`,
      );
    }
    return [server];
  }

  #slotKey(projectId: string, serverId: string) {
    return `${projectId}\0${serverId}`;
  }

  async #slot(projectId: string, server: McpServerRuntimeDefinition) {
    const key = this.#slotKey(projectId, server.id);
    const existing = this.#slots.get(key);
    if (existing?.revision === server.revision) return existing;
    if (existing) {
      this.#slots.delete(key);
      if (existing.client) await existing.client.close().catch(() => undefined);
      else if (existing.clientPromise) {
        void existing.clientPromise
          .then((client) => client.close())
          .catch(() => undefined);
      }
    }
    const created: CatalogSlot = { revision: server.revision };
    this.#slots.set(key, created);
    return created;
  }

  async #client(
    projectId: string,
    server: McpServerRuntimeDefinition,
    signal?: AbortSignal,
  ) {
    const slot = await this.#slot(projectId, server);
    if (slot.client) return slot.client;
    if (!slot.clientPromise) {
      slot.clientPromise = this.#factory.connect(server, signal);
    }
    const connecting = slot.clientPromise;
    try {
      const client = await connecting;
      if (slot.clientPromise === connecting) {
        client.setToolsChangedHandler(() => {
          slot.tools = undefined;
          slot.toolsLoadedAt = undefined;
          slot.toolsPromise = undefined;
        });
        slot.client = client;
        slot.clientPromise = undefined;
      }
      return client;
    } catch (error) {
      if (slot.clientPromise === connecting) slot.clientPromise = undefined;
      throw error;
    }
  }

  async #tools(
    projectId: string,
    server: McpServerRuntimeDefinition,
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ) {
    const slot = await this.#slot(projectId, server);
    const fresh =
      slot.tools &&
      slot.toolsLoadedAt !== undefined &&
      this.#now() - slot.toolsLoadedAt <= this.#catalogTtlMs;
    if (!options.refresh && fresh) return slot.tools!;
    if (!slot.toolsPromise) {
      slot.toolsPromise = this.#client(projectId, server, options.signal).then(
        async (client) =>
          normalizedTools(
            await client.listTools({
              refresh: options.refresh,
              signal: options.signal,
            }),
          ),
      );
    }
    const loading = slot.toolsPromise;
    try {
      const tools = await loading;
      if (slot.toolsPromise === loading) {
        slot.tools = tools;
        slot.toolsLoadedAt = this.#now();
        slot.toolsPromise = undefined;
      }
      return tools;
    } catch (error) {
      if (slot.toolsPromise === loading) slot.toolsPromise = undefined;
      throw error;
    }
  }

  async #status(projectId: string) {
    const servers = await this.#servers(projectId);
    return {
      action: "status",
      transport: "streamable-http",
      servers: servers.map((server) => {
        const slot = this.#slots.get(this.#slotKey(projectId, server.id));
        return {
          id: server.id,
          name: server.name,
          state: slot?.client
            ? "connected"
            : slot?.clientPromise
              ? "connecting"
              : "idle",
          ...(slot?.tools
            ? {
                catalog: "loaded",
                toolCount: slot.tools.length,
                loadedAt: new Date(slot.toolsLoadedAt!).toISOString(),
              }
            : { catalog: "not-loaded" }),
          ...(slot?.client ? { protocol: slot.client.serverInfo() } : {}),
        };
      }),
      lazy: true,
    };
  }

  async #catalogResults(
    projectId: string,
    serverId: string | undefined,
    refresh: boolean | undefined,
    signal?: AbortSignal,
  ) {
    const servers = await this.#selectedServers(projectId, serverId);
    const settled = await Promise.allSettled(
      servers.map(async (server) => ({
        server,
        tools: await this.#tools(projectId, server, { refresh, signal }),
      })),
    );
    throwIfAborted(signal);
    const catalogs: {
      server: McpServerRuntimeDefinition;
      tools: readonly McpRemoteTool[];
    }[] = [];
    const errors: { serverId: string; serverName: string; error: string }[] =
      [];
    settled.forEach((result, index) => {
      const server = servers[index]!;
      if (result.status === "fulfilled") catalogs.push(result.value);
      else {
        errors.push({
          serverId: server.id,
          serverName: server.name,
          error: redactedError(server, result.reason),
        });
      }
    });
    return { catalogs, errors };
  }

  async #list(
    projectId: string,
    input: Extract<McpProxyInput, { action: "list" }>,
    signal?: AbortSignal,
  ) {
    const limit = checkedLimit(input.limit);
    const { catalogs, errors } = await this.#catalogResults(
      projectId,
      input.serverId,
      input.refresh,
      signal,
    );
    const all = catalogs.flatMap(({ server, tools }) =>
      tools.map((tool) => summary(server, tool)),
    );
    return {
      action: "list",
      tools: all.slice(0, limit),
      total: all.length,
      truncated: all.length > limit,
      ...(errors.length ? { errors } : {}),
    };
  }

  async #search(
    projectId: string,
    input: Extract<McpProxyInput, { action: "search" }>,
    signal?: AbortSignal,
  ) {
    const query = searchTerms(input.query);
    const limit = checkedLimit(input.limit);
    const { catalogs, errors } = await this.#catalogResults(
      projectId,
      input.serverId,
      input.refresh,
      signal,
    );
    const matches = catalogs
      .flatMap(({ server, tools }) =>
        tools.map((tool) => ({
          score: searchScore(server, tool, query),
          tool: summary(server, tool),
        })),
      )
      .filter((match) => match.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.tool.serverName.localeCompare(right.tool.serverName, "en") ||
          left.tool.name.localeCompare(right.tool.name, "en"),
      );
    return {
      action: "search",
      query: input.query,
      matches: matches.slice(0, limit),
      total: matches.length,
      truncated: matches.length > limit,
      ...(errors.length ? { errors } : {}),
    };
  }

  async #schema(
    projectId: string,
    input: Extract<McpProxyInput, { action: "schema" }>,
    signal?: AbortSignal,
  ) {
    checkedIdentifier(input.toolName, "MCP tool name");
    const [server] = await this.#selectedServers(projectId, input.serverId);
    const tool = (
      await this.#tools(projectId, server!, {
        refresh: input.refresh,
        signal,
      })
    ).find((candidate) => candidate.name === input.toolName);
    if (!tool) {
      throw new McpProxyError(`MCP tool was not found: ${input.toolName}`);
    }
    const result = {
      action: "schema",
      tool: {
        ...summary(server!, tool),
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
    };
    if (serializedLength(result) > MAX_SCHEMA_CHARACTERS) {
      throw new McpProxyError(
        "MCP tool schema exceeds the context safety limit.",
      );
    }
    return result;
  }

  async #call(
    projectId: string,
    input: Extract<McpProxyInput, { action: "call" }>,
    signal?: AbortSignal,
    context?: McpExecutionContext,
  ) {
    checkedIdentifier(input.toolName, "MCP tool name");
    if (input.arguments !== undefined && !isRecord(input.arguments)) {
      throw new McpProxyError("MCP tool arguments must be a JSON object.");
    }
    const arguments_ = input.arguments ?? {};
    if (serializedLength(arguments_) > MAX_ARGUMENT_CHARACTERS) {
      throw new McpProxyError("MCP tool arguments exceed the safety limit.");
    }
    const [server] = await this.#selectedServers(projectId, input.serverId);
    const tools = await this.#tools(projectId, server!, { signal });
    let tool = tools.find((candidate) => candidate.name === input.toolName);
    if (!tool) {
      throw new McpProxyError(`MCP tool was not found: ${input.toolName}`);
    }
    const callable = callableState(server!, tool);
    if (!callable.callable) {
      throw new McpProxyError(
        "This MCP tool is not in the local connection allow-list.",
      );
    }
    if (callable.approvalRequired) {
      if (!this.#approval) {
        throw new McpProxyError(
          "This MCP tool requires interactive approval, but no approval host is available.",
        );
      }
      const beforeApproval = toolFingerprint(tool);
      const decision = await this.#approval.authorize(
        {
          ...(context?.approvalSessionId
            ? { approvalSessionId: context.approvalSessionId }
            : {}),
          arguments: arguments_,
          projectId,
          ...(context?.projectName ? { projectName: context.projectName } : {}),
          risk: callable.risk,
          serverId: server!.id,
          serverName: server!.name,
          serverRevision: server!.revision,
          ...(tool.description ? { toolDescription: tool.description } : {}),
          toolDefinitionRevision: beforeApproval,
          toolName: tool.name,
          ...(tool.title ? { toolTitle: tool.title } : {}),
        },
        signal,
      );
      throwIfAborted(signal);
      if (!decision.approved) {
        throw new McpProxyError("The MCP tool call was denied by the user.");
      }
      const refreshed = await this.#tools(projectId, server!, {
        refresh: true,
        signal,
      });
      const current = refreshed.find(
        (candidate) => candidate.name === input.toolName,
      );
      if (!current || toolFingerprint(current) !== beforeApproval) {
        throw new McpProxyError(
          "The MCP tool definition changed after approval. Review and try again.",
        );
      }
      tool = current;
    }
    const client = await this.#client(projectId, server!, signal);
    const result = await client.callTool(tool, arguments_, signal);
    throwIfAborted(signal);
    const bounded = boundedResult({
      content: result.content,
      ...(result.structuredContent === undefined
        ? {}
        : { structuredContent: result.structuredContent }),
    });
    const serialized = JSON.stringify(bounded);
    const redacted = server!.redact ? server!.redact(serialized) : serialized;
    return {
      action: "call",
      serverId: server!.id,
      toolName: tool.name,
      isError: result.isError === true,
      result: JSON.parse(redacted) as unknown,
    };
  }

  async #protocolOperation(
    projectId: string,
    input: Exclude<
      McpProxyInput,
      { action: "status" | "list" | "search" | "schema" | "call" }
    >,
    signal?: AbortSignal,
  ) {
    const [server] = await this.#selectedServers(projectId, input.serverId);
    const client = await this.#client(projectId, server!, signal);
    let value: unknown;
    if (input.action === "ping") {
      value = await client.ping(signal);
    } else if (input.action === "prompts") {
      value = await client.listPrompts({
        refresh: input.refresh,
        signal,
      });
    } else if (input.action === "get-prompt") {
      checkedIdentifier(input.promptName, "MCP prompt name");
      const arguments_ = input.arguments ?? {};
      if (
        !isRecord(arguments_) ||
        Object.values(arguments_).some((entry) => typeof entry !== "string") ||
        serializedLength(arguments_) > MAX_ARGUMENT_CHARACTERS
      ) {
        throw new McpProxyError("MCP prompt arguments are invalid.");
      }
      value = await client.getPrompt(input.promptName, arguments_, signal);
    } else if (input.action === "resources") {
      value = await client.listResources({
        refresh: input.refresh,
        signal,
      });
    } else if (input.action === "resource-templates") {
      value = await client.listResourceTemplates({
        refresh: input.refresh,
        signal,
      });
    } else if (input.action === "read-resource") {
      checkedUri(input.uri);
      value = await client.readResource(input.uri, {
        refresh: input.refresh,
        signal,
      });
    } else {
      checkedIdentifier(input.argument.name, "MCP completion argument name");
      if (
        input.argument.value.length > 8_000 ||
        input.argument.value.includes("\0")
      ) {
        throw new McpProxyError("MCP completion argument is invalid.");
      }
      if (input.ref.type === "ref/prompt") {
        checkedIdentifier(input.ref.name, "MCP prompt name");
      } else {
        checkedUri(input.ref.uri);
      }
      value = await client.complete(input.ref, input.argument, signal);
    }
    throwIfAborted(signal);
    const serialized = JSON.stringify(boundedResult(value));
    const redacted = server!.redact ? server!.redact(serialized) : serialized;
    return {
      action: input.action,
      serverId: server!.id,
      result: JSON.parse(redacted) as unknown,
    };
  }
}

function checkedUri(value: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_URI_CHARACTERS ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new McpProxyError("MCP resource URI is invalid.");
  }
  return value;
}
