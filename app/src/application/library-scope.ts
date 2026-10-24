import type { Project } from "../domain/models.ts";

export function resolveLibraryProject(
  projects: Readonly<Record<string, Project>>,
  routeProjectId: string | undefined,
) {
  return routeProjectId ? projects[routeProjectId] : undefined;
}
