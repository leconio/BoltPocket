import type { MemoryItem, SkillItem } from "../domain/models.ts";

export function selectProjectMemories(
  items: MemoryItem[],
  projectId: string | null,
) {
  return items.filter(
    (item) =>
      item.scope === "global" ||
      (projectId !== null && item.projectIds?.includes(projectId)),
  );
}

export function selectProjectSkills(
  items: SkillItem[],
  globalEnabledById: Record<string, boolean> | undefined,
  projectId: string | null,
  projectEnabledById?: Record<string, boolean>,
) {
  if (!projectId) return [];
  return items.filter(
    (item) =>
      Boolean(
        projectEnabledById?.[item.id] ??
        globalEnabledById?.[item.id] ??
        item.enabled,
      ) &&
      (item.scope === "global" || item.projectIds.includes(projectId)),
  );
}
