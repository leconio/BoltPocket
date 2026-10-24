import {
  createGoogleWorkspaceDocumentsSkill,
  type GoogleWorkspaceDocumentSkillBinding,
} from "@boltpocket/connector-google-workspace";
import {
  createNotionDocumentsSkill,
  type NotionDocumentSkillBinding,
} from "@boltpocket/connector-notion";

import type { ConnectionItem, SkillItem } from "@/domain/models";
import type { SupportedDocumentLink } from "@/infrastructure/connectors/document-link";

export type PromptDocumentSkillBinding = SupportedDocumentLink & {
  connectorId: string;
  resourceId: string;
};

const GOOGLE_CONNECTION = /^google-(?:docs|sheets|slides)-/u;
const NOTION_CONNECTION = /^notion-/u;

function projectSkill(
  document: Pick<SkillItem, "id" | "name" | "description" | "content">,
  projectId: string,
): SkillItem {
  return {
    ...document,
    risk: "propose",
    enabled: true,
    scope: "project",
    projectIds: [projectId],
  };
}

export function connectorDocumentSkillsForRun(input: {
  projectId: string;
  connections: readonly ConnectionItem[];
  bindings: readonly PromptDocumentSkillBinding[];
}): SkillItem[] {
  const connections = input.connections.filter(
    (connection) => connection.projectId === input.projectId,
  );
  const connectionIds = new Set(connections.map((connection) => connection.id));
  if (
    input.bindings.some((binding) => !connectionIds.has(binding.connectorId))
  ) {
    throw new Error("文档 Skill 绑定不属于当前项目连接器。");
  }

  const googleBindings: GoogleWorkspaceDocumentSkillBinding[] = input.bindings
    .filter(
      (
        binding,
      ): binding is PromptDocumentSkillBinding & {
        provider: GoogleWorkspaceDocumentSkillBinding["provider"];
      } => binding.provider !== "notion",
    )
    .map(({ provider, url, connectorId, resourceId }) => ({
      provider,
      sourceUrl: url,
      connectorId,
      resourceId,
    }));
  const notionBindings: NotionDocumentSkillBinding[] = input.bindings
    .filter((binding) => binding.provider === "notion")
    .map(({ url, connectorId, resourceId }) => ({
      sourceUrl: url,
      connectorId,
      resourceId,
    }));
  const skills: SkillItem[] = [];
  if (
    googleBindings.length > 0 ||
    connections.some((connection) => GOOGLE_CONNECTION.test(connection.id))
  ) {
    skills.push(
      projectSkill(
        createGoogleWorkspaceDocumentsSkill(googleBindings),
        input.projectId,
      ),
    );
  }
  if (
    notionBindings.length > 0 ||
    connections.some((connection) => NOTION_CONNECTION.test(connection.id))
  ) {
    skills.push(
      projectSkill(createNotionDocumentsSkill(notionBindings), input.projectId),
    );
  }
  return skills;
}

export function mergeRunSkills(
  configured: readonly SkillItem[],
  connectorOwned: readonly SkillItem[],
) {
  const merged = new Map(configured.map((skill) => [skill.id, skill]));
  for (const skill of connectorOwned) merged.set(skill.id, skill);
  return [...merged.values()];
}
