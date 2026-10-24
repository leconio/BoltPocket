import type {
  MemoryItem,
  Project,
  SkillItem,
  WorkspaceResource,
} from "../domain/models.ts";
import {
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
} from "../domain/project-workspace.ts";
import {
  parseProjectSkillDocument,
  projectSkillPath,
} from "../domain/project-skill-document.ts";

export const PROJECT_WORKSPACE_BOOTSTRAP_MAX_CHARACTERS = 24_000;
export const PROJECT_WORKSPACE_MEMORY_MAX_CHARACTERS = 12_000;
export const PROJECT_WORKSPACE_SKILL_MAX_CHARACTERS = 64_000;

const UNBOUND_DEVICE_SKILLS = new Set([
  "operate-device",
  "manage-calendar-reminders",
  "read-device-sensors",
  "play-device-audio",
]);

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function truncateBootstrap(
  value: string,
  maxCharacters = PROJECT_WORKSPACE_BOOTSTRAP_MAX_CHARACTERS,
) {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, maxCharacters)}\n\n[内容已截断，请按需分段读取原文件]`;
}

export function projectWorkspaceResources(
  resources: readonly WorkspaceResource[],
  projectId: string,
) {
  return resources
    .filter(
      (resource) =>
        resource.projectId === projectId &&
        isProjectWorkspaceResource(resource) &&
        isSafeProjectWorkspacePath(resource.path),
    )
    .sort((left, right) => compareText(left.path, right.path));
}

function workspaceFile(
  resources: readonly WorkspaceResource[],
  projectId: string,
  path: string,
) {
  return projectWorkspaceResources(resources, projectId).find(
    (resource) => resource.path === path,
  );
}

export function projectWorkspaceInstructions(
  project: Project,
  resources: readonly WorkspaceResource[],
) {
  const agents = workspaceFile(resources, project.id, "AGENTS.md");
  return truncateBootstrap(agents?.content ?? project.instructions).trim();
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recentMemoryDates(now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return new Set([localDateKey(now), localDateKey(yesterday)]);
}

function memoryTextEntries(resource: WorkspaceResource) {
  const content = truncateBootstrap(
    resource.content,
    PROJECT_WORKSPACE_MEMORY_MAX_CHARACTERS,
  ).trim();
  if (!content) return [];
  const bullets = content.split(/\r?\n/gu).flatMap((line) => {
    const match = /^\s*[-*+]\s+(.+?)\s*$/u.exec(line);
    return match?.[1] ? [match[1]] : [];
  });
  const entries =
    bullets.length > 0
      ? bullets
      : [
          content
            .split(/\r?\n/gu)
            .filter((line) => !/^\s*#{1,6}\s+/u.test(line))
            .join("\n")
            .trim(),
        ].filter(Boolean);
  return entries.map<MemoryItem>((text, index) => ({
    id: `${resource.id}:${index + 1}`,
    text,
    scope: "project",
    source: resource.path,
    projectIds: [resource.projectId],
    pinned: resource.path === "MEMORY.md",
  }));
}

export function projectWorkspaceMemoryItems(
  resources: readonly WorkspaceResource[],
  projectId: string,
  now = new Date(),
) {
  const dates = recentMemoryDates(now);
  return projectWorkspaceResources(resources, projectId)
    .filter((resource) => {
      if (
        resource.path === "MEMORY.md" ||
        resource.path === "memory/RECENT.md" ||
        resource.path === "memory/SUMMARIES.md"
      ) {
        return true;
      }
      const match =
        /^memory\/(\d{4}-\d{2}-\d{2})(?:-[a-z0-9._-]+)?\.md$/iu.exec(
          resource.path,
        );
      return Boolean(match?.[1] && dates.has(match[1]));
    })
    .flatMap(memoryTextEntries);
}

export function projectWorkspaceMemoryResource(
  resources: readonly WorkspaceResource[],
  projectId: string,
  memoryItemId: string,
  now = new Date(),
) {
  if (
    !projectWorkspaceMemoryItems(resources, projectId, now).some(
      (memory) => memory.id === memoryItemId,
    )
  ) {
    return undefined;
  }
  return projectWorkspaceResources(resources, projectId).find((resource) =>
    memoryTextEntries(resource).some((memory) => memory.id === memoryItemId),
  );
}

export function projectMemoriesForRun(input: {
  catalog: readonly MemoryItem[];
  resources: readonly WorkspaceResource[];
  projectId: string;
  now?: Date;
}) {
  const global = input.catalog.filter((item) => item.scope === "global");
  const workspace = projectWorkspaceMemoryItems(
    input.resources,
    input.projectId,
    input.now,
  );
  if (
    workspace.length > 0 ||
    workspaceFile(input.resources, input.projectId, "MEMORY.md")
  ) {
    return [...global, ...workspace];
  }
  return [
    ...global,
    ...input.catalog.filter(
      (item) =>
        item.scope === "project" && item.projectIds?.includes(input.projectId),
    ),
  ];
}

function projectWorkspaceSkillCandidates(
  resources: readonly WorkspaceResource[],
  projectId: string,
) {
  return projectWorkspaceResources(resources, projectId)
    .flatMap((resource) => {
      const parsedPath = projectSkillPath(resource.path);
      return parsedPath ? [{ resource, ...parsedPath }] : [];
    })
    .sort(
      (left, right) =>
        left.precedence - right.precedence ||
        compareText(left.resource.path, right.resource.path),
    );
}

function firstBodyDescription(body: string) {
  return (
    body
      .split(/\r?\n/gu)
      .map((line) => line.replace(/^\s*#{1,6}\s+/u, "").trim())
      .find(Boolean) ?? "项目工作区 Skill"
  ).slice(0, 240);
}

export function projectWorkspaceSkills(input: {
  catalog: readonly SkillItem[];
  resources: readonly WorkspaceResource[];
  /** App-wide defaults inherited by projects unless a project overrides them. */
  enabledById: Record<string, boolean> | undefined;
  /** Overrides owned only by input.projectId and resolved before app defaults. */
  projectEnabledById?: Record<string, boolean>;
  projectId: string;
}) {
  const catalog = input.catalog.filter(
    (skill) =>
      skill.scope === "global" || skill.projectIds.includes(input.projectId),
  );
  const catalogById = new Map(catalog.map((skill) => [skill.id, skill]));
  const resolved = new Map(
    catalog.map((skill) => [
      skill.id,
      {
        ...skill,
        enabled: Boolean(
          input.projectEnabledById?.[skill.id] ??
          input.enabledById?.[skill.id] ??
          skill.enabled,
        ),
      },
    ]),
  );
  const candidates = projectWorkspaceSkillCandidates(
    input.resources,
    input.projectId,
  );
  for (const candidate of candidates) {
    const parsed = parseProjectSkillDocument(candidate.resource.content);
    if (!parsed?.body || (parsed.name && parsed.name !== candidate.slug)) {
      continue;
    }
    const fallback = catalogById.get(candidate.slug);
    const id = fallback?.id ?? candidate.slug;
    const risk =
      parsed.risk === "read" || parsed.risk === "propose"
        ? parsed.risk
        : (fallback?.risk ?? "propose");
    resolved.set(candidate.slug, {
      id,
      name: parsed.title?.slice(0, 120) || fallback?.name || candidate.slug,
      description:
        parsed.description?.slice(0, 240) ||
        fallback?.description ||
        firstBodyDescription(parsed.body),
      content: truncateBootstrap(
        parsed.body,
        PROJECT_WORKSPACE_SKILL_MAX_CHARACTERS,
      ),
      risk,
      enabled: Boolean(
        input.projectEnabledById?.[id] ??
        input.enabledById?.[id] ??
        fallback?.enabled ??
        true,
      ),
      scope: "project",
      projectIds: [input.projectId],
    });
  }
  return [...resolved.values()].sort((left, right) =>
    compareText(left.id, right.id),
  );
}

export function projectWorkspaceSkillResource(input: {
  catalog: readonly SkillItem[];
  resources: readonly WorkspaceResource[];
  projectId: string;
  skillId: string;
}) {
  const catalogById = new Map(
    input.catalog
      .filter(
        (skill) =>
          skill.scope === "global" ||
          skill.projectIds.includes(input.projectId),
      )
      .map((skill) => [skill.id, skill]),
  );
  const resolved = new Map<
    string,
    { id: string; resource: WorkspaceResource }
  >();
  for (const candidate of projectWorkspaceSkillCandidates(
    input.resources,
    input.projectId,
  )) {
    const parsed = parseProjectSkillDocument(candidate.resource.content);
    if (!parsed?.body || (parsed.name && parsed.name !== candidate.slug)) {
      continue;
    }
    const fallback = catalogById.get(candidate.slug);
    resolved.set(candidate.slug, {
      id: fallback?.id ?? candidate.slug,
      resource: candidate.resource,
    });
  }
  return [...resolved.values()].find(
    (candidate) => candidate.id === input.skillId,
  )?.resource;
}

export function resolveProjectWorkspaceContext(input: {
  project: Project;
  resources: readonly WorkspaceResource[];
  memories: readonly MemoryItem[];
  skills: readonly SkillItem[];
  enabledById: Record<string, boolean> | undefined;
  projectEnabledById?: Record<string, boolean>;
  now?: Date;
}) {
  const projectSkills = projectWorkspaceSkills({
    catalog: input.skills,
    resources: input.resources,
    enabledById: input.enabledById,
    projectEnabledById: input.projectEnabledById,
    projectId: input.project.id,
  });
  return {
    instructions: projectWorkspaceInstructions(input.project, input.resources),
    memories: projectMemoriesForRun({
      catalog: input.memories,
      resources: input.resources,
      projectId: input.project.id,
      now: input.now,
    }),
    skills: projectSkills.filter((skill) => skill.enabled),
    allSkills: projectSkills,
    bootstrapFiles: projectWorkspaceResources(
      input.resources,
      input.project.id,
    ).map((resource) => resource.path),
  };
}

export function resolveUnboundWorkspaceContext(input: {
  memories: readonly MemoryItem[];
  skills: readonly SkillItem[];
  enabledById?: Readonly<Record<string, boolean>>;
}) {
  const skills = input.skills
    .filter(
      (skill) =>
        skill.scope === "global" &&
        UNBOUND_DEVICE_SKILLS.has(skill.id) &&
        (input.enabledById?.[skill.id] ?? skill.enabled),
    )
    .map((skill) => ({ ...skill, enabled: true }));
  return {
    instructions: "",
    memories: input.memories.filter((memory) => memory.scope === "global"),
    skills,
    allSkills: input.skills.filter((skill) => skill.scope === "global"),
    bootstrapFiles: [] as string[],
  };
}
