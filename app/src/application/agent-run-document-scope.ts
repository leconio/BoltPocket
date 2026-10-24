type ProjectScopedItem = {
  id: string;
  projectId: string;
};

type ProjectResourceItem = ProjectScopedItem & {
  connectionId: string;
};

function mergeProjectItems<T extends ProjectScopedItem>(
  current: readonly T[],
  justConnected: readonly T[],
  projectId: string,
) {
  const merged = new Map<string, T>();
  for (const item of [...current, ...justConnected]) {
    if (item.projectId === projectId) merged.set(item.id, item);
  }
  return [...merged.values()];
}

export function mergeAuthorizedProjectResources<
  T extends ProjectResourceItem,
>(input: {
  current: readonly T[];
  justConnected: readonly T[];
  projectId: string;
  authorizedResourceIds: ReadonlySet<string>;
}) {
  const replacedConnectionIds = new Set(
    input.justConnected
      .filter((resource) => resource.projectId === input.projectId)
      .map((resource) => resource.connectionId),
  );
  const current = input.current.filter(
    (resource) => !replacedConnectionIds.has(resource.connectionId),
  );
  return mergeProjectItems(
    current,
    input.justConnected,
    input.projectId,
  ).filter((resource) => input.authorizedResourceIds.has(resource.id));
}

export function mergeProjectConnections<T extends ProjectScopedItem>(input: {
  current: readonly T[];
  justConnected: readonly T[];
  projectId: string;
}) {
  return mergeProjectItems(input.current, input.justConnected, input.projectId);
}
