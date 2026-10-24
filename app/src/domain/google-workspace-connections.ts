import type { ConnectionItem } from "./models.ts";

const GOOGLE_CONNECTION = /^(?:google-docs|google-sheets|google-slides)-/u;

export function isGoogleWorkspaceConnection(connection: ConnectionItem) {
  return GOOGLE_CONNECTION.test(connection.id);
}

export function summarizeProjectConnections(
  connections: readonly ConnectionItem[],
  projectId: string | null | undefined,
) {
  if (!projectId) return [];
  const scoped = connections.filter(
    (connection) => connection.projectId === projectId,
  );
  const regular = scoped.filter(
    (connection) => !isGoogleWorkspaceConnection(connection),
  );
  const googleGroups = new Map<string, ConnectionItem[]>();
  for (const connection of scoped.filter(isGoogleWorkspaceConnection)) {
    const key = connection.accountId ?? connection.account;
    const group = googleGroups.get(key) ?? [];
    group.push(connection);
    googleGroups.set(key, group);
  }
  const google = [...googleGroups.values()].map((group) => {
    const ordered = [...group].sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    );
    const primary = ordered[0]!;
    const resourceCount = ordered.reduce(
      (total, connection) => total + connection.resourceCount,
      0,
    );
    return {
      ...primary,
      name: "Google Workspace",
      scope:
        resourceCount === 0
          ? "Docs · Sheets · Slides"
          : `${resourceCount} 个文件 · Docs / Sheets / Slides`,
      status: ordered.every((connection) => connection.status === "connected")
        ? ("connected" as const)
        : ("attention" as const),
      resourceCount,
      writeMode: ordered.every(
        (connection) => connection.writeMode === "read-only",
      )
        ? ("read-only" as const)
        : ("recoverable" as const),
    } satisfies ConnectionItem;
  });
  return [...google, ...regular].sort((left, right) =>
    `${left.name}\0${left.account}`.localeCompare(
      `${right.name}\0${right.account}`,
      "zh-CN",
    ),
  );
}
