import { BUILT_IN_H5_RESOURCE_PACKS } from "./builtin-project-resources.generated.ts";

export { H5_RESOURCE_BUNDLE } from "./builtin-project-resources.generated.ts";

export const BUILT_IN_PROJECT_RESOURCE_PACKS = BUILT_IN_H5_RESOURCE_PACKS;

export type BuiltInProjectResourcePack =
  (typeof BUILT_IN_PROJECT_RESOURCE_PACKS)[number];
export type BuiltInProjectResourcePackId = BuiltInProjectResourcePack["id"];
export type BuiltInProjectResourceFile =
  BuiltInProjectResourcePack["files"][number];

export const BUILT_IN_PROJECT_RESOURCE_SKILL_BY_PACK = Object.freeze({
  "bootstrap-icons": "use-bootstrap-icons",
  "kenney-ui": "use-kenney-ui",
  "kenney-1bit": "use-kenney-1bit",
} as const satisfies Record<BuiltInProjectResourcePackId, string>);

export type BuiltInProjectResourceSkillId =
  (typeof BUILT_IN_PROJECT_RESOURCE_SKILL_BY_PACK)[BuiltInProjectResourcePackId];

const resourceSkillIds = new Set<string>(
  Object.values(BUILT_IN_PROJECT_RESOURCE_SKILL_BY_PACK),
);

export const BUILT_IN_PROJECT_RESOURCE_PACK_IDS = Object.freeze(
  BUILT_IN_PROJECT_RESOURCE_PACKS.map((pack) => pack.id),
) as readonly BuiltInProjectResourcePackId[];

const packIds = new Set<string>(BUILT_IN_PROJECT_RESOURCE_PACK_IDS);

export type ProjectResourcePackEnabledByProjectId = Record<
  string,
  Partial<Record<BuiltInProjectResourcePackId, boolean>>
>;

export type ProjectResourceCatalogMatch =
  | Readonly<{
      kind: "icon";
      packId: "bootstrap-icons";
      name: string;
      className: string;
      stylesheet: string;
    }>
  | Readonly<{
      kind: "file";
      packId: BuiltInProjectResourcePackId;
      path: string;
      h5Path: string;
      mimeType: string;
      byteLength: number;
      width?: number;
      height?: number;
    }>;

export function isBuiltInProjectResourcePackId(
  value: string,
): value is BuiltInProjectResourcePackId {
  return packIds.has(value);
}

export function builtInProjectResourcePack(id: BuiltInProjectResourcePackId) {
  return BUILT_IN_PROJECT_RESOURCE_PACKS.find((pack) => pack.id === id)!;
}

export function builtInProjectResourceFile(
  packId: BuiltInProjectResourcePackId,
  path: string,
) {
  return builtInProjectResourcePack(packId).files.find(
    (file) => file.path === path,
  );
}

export function projectResourceSkillId(id: BuiltInProjectResourcePackId) {
  return BUILT_IN_PROJECT_RESOURCE_SKILL_BY_PACK[id];
}

export function isBuiltInProjectResourceSkillId(
  id: string,
): id is BuiltInProjectResourceSkillId {
  return resourceSkillIds.has(id);
}

export function filterSkillsForEnabledProjectResources<
  T extends { id: string },
>(skills: readonly T[], packIds: readonly BuiltInProjectResourcePackId[]) {
  const enabledSkillIds = new Set(packIds.map(projectResourceSkillId));
  return skills.filter(
    (skill) =>
      !isBuiltInProjectResourceSkillId(skill.id) ||
      enabledSkillIds.has(skill.id),
  );
}

export function isProjectResourcePackEnabled(
  settings: ProjectResourcePackEnabledByProjectId,
  projectId: string,
  packId: BuiltInProjectResourcePackId,
) {
  return settings[projectId]?.[packId] ?? true;
}

export function enabledProjectResourcePacks(
  settings: ProjectResourcePackEnabledByProjectId,
  projectId: string,
) {
  return BUILT_IN_PROJECT_RESOURCE_PACKS.filter((pack) =>
    isProjectResourcePackEnabled(settings, projectId, pack.id),
  );
}

export function projectResourceH5Path(
  packId: BuiltInProjectResourcePackId,
  path: string,
) {
  return `./assets/vendor/${packId}/${path}`;
}

export function projectResourceCopyPaths(
  packId: BuiltInProjectResourcePackId,
  requestedPaths: readonly string[],
) {
  const paths = new Set(requestedPaths);
  if (packId === "bootstrap-icons" && paths.has("bootstrap-icons.min.css")) {
    paths.add("fonts/bootstrap-icons.woff2");
  }
  return [...paths].sort((left, right) => left.localeCompare(right, "en"));
}

function searchScore(value: string, query: string) {
  const lower = value.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  const segment = lower
    .split(/[\/_.-]+/gu)
    .findIndex((candidate) => candidate.startsWith(query));
  if (segment >= 0) return 2 + segment;
  const index = lower.indexOf(query);
  return index < 0 ? Number.POSITIVE_INFINITY : 20 + index;
}

export function searchBuiltInProjectResources(input: {
  packIds: readonly BuiltInProjectResourcePackId[];
  query: string;
  limit?: number;
}): ProjectResourceCatalogMatch[] {
  const query = input.query.trim().toLowerCase();
  if (!query) throw new Error("资源搜索词不能为空。");
  const limit = Math.max(1, Math.min(input.limit ?? 24, 100));
  const allowed = new Set(input.packIds);
  const matches: { score: number; value: ProjectResourceCatalogMatch }[] = [];
  for (const pack of BUILT_IN_PROJECT_RESOURCE_PACKS) {
    if (!allowed.has(pack.id)) continue;
    for (const file of pack.files) {
      const score = searchScore(file.path, query);
      if (!Number.isFinite(score)) continue;
      matches.push({
        score,
        value: {
          kind: "file",
          packId: pack.id,
          path: file.path,
          h5Path: projectResourceH5Path(pack.id, file.path),
          mimeType: file.mimeType,
          byteLength: file.byteLength,
          ...(Object.hasOwn(file, "width")
            ? { width: (file as { width: number }).width }
            : {}),
          ...(Object.hasOwn(file, "height")
            ? { height: (file as { height: number }).height }
            : {}),
        },
      });
    }
    if (pack.id === "bootstrap-icons") {
      for (const name of pack.symbols) {
        const score = searchScore(name, query);
        if (!Number.isFinite(score)) continue;
        matches.push({
          score,
          value: {
            kind: "icon",
            packId: "bootstrap-icons",
            name,
            className: `bi bi-${name}`,
            stylesheet: projectResourceH5Path(
              "bootstrap-icons",
              "bootstrap-icons.min.css",
            ),
          },
        });
      }
    }
  }
  return matches
    .sort(
      (left, right) =>
        left.score - right.score ||
        JSON.stringify(left.value).localeCompare(
          JSON.stringify(right.value),
          "en",
        ),
    )
    .slice(0, limit)
    .map(({ value }) => value);
}
