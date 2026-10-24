import type { AppAction, AppState } from "./app-state-model.ts";
import {
  getSkillCatalog,
  hasProjectSkill,
} from "./app-state-reducer-helpers.ts";
import {
  isValidCustomGlobalMemory,
  isValidCustomGlobalSkill,
  isValidEditableLibraryContent,
  MAX_GLOBAL_SKILL_CHARACTERS,
} from "./library-content.ts";
import {
  builtInMemories,
  builtInSkills,
  isBuiltInSkillDefaultContent,
} from "./library-catalog.ts";
import {
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
  projectWorkspaceConnectionId,
} from "./project-workspace.ts";

type LibraryAction = Extract<
  AppAction,
  {
    type:
      | "project/workspace-skill-created"
      | "memory/create-global"
      | "skill/create-global"
      | "memory/update-global"
      | "skill/update-global"
      | "skill/set-enabled";
  }
>;

function createProjectSkillState(
  state: AppState,
  action: Extract<LibraryAction, { type: "project/workspace-skill-created" }>,
) {
  const project = state.projects[action.projectId];
  const connectionId = project ? projectWorkspaceConnectionId(project.id) : "";
  const connection = state.connections[connectionId];
  const resource = action.resource;
  const expectedPath = `skills/${action.skillId}/SKILL.md`;
  const duplicatePath = Object.values(state.resources).some(
    (candidate) =>
      candidate.projectId === action.projectId &&
      candidate.path === resource.path,
  );
  if (
    !project ||
    !connection ||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(action.skillId) ||
    state.resources[resource.id] ||
    duplicatePath ||
    resource.projectId !== project.id ||
    resource.connectionId !== connection.id ||
    resource.path !== expectedPath ||
    resource.version !== "1" ||
    !isProjectWorkspaceResource(resource) ||
    !isSafeProjectWorkspacePath(resource.path) ||
    !resource.content.startsWith(`---\nname: ${action.skillId}\n`) ||
    !resource.content.includes("\n---\n") ||
    resource.content.includes("\0") ||
    resource.content.length > MAX_GLOBAL_SKILL_CHARACTERS
  ) {
    return state;
  }
  return {
    ...state,
    projects: {
      ...state.projects,
      [project.id]: {
        ...project,
        resourceCount: project.resourceCount + 1,
        skillCount: project.skillCount + 1,
      },
    },
    connections: {
      ...state.connections,
      [connection.id]: {
        ...connection,
        resourceCount: connection.resourceCount + 1,
      },
    },
    resources: { ...state.resources, [resource.id]: resource },
    projectSkillEnabledByProjectId: {
      ...state.projectSkillEnabledByProjectId,
      [project.id]: {
        ...state.projectSkillEnabledByProjectId[project.id],
        [action.skillId]: true,
      },
    },
  };
}

export function reduceLibraryAction(
  state: AppState,
  action: LibraryAction,
): AppState {
  switch (action.type) {
    case "project/workspace-skill-created":
      return createProjectSkillState(state, action);
    case "memory/create-global": {
      const memory = action.memory;
      if (
        !isValidCustomGlobalMemory(memory) ||
        builtInMemories.some((candidate) => candidate.id === memory.id) ||
        state.customGlobalMemories[memory.id]
      ) {
        return state;
      }
      return {
        ...state,
        customGlobalMemories: {
          ...state.customGlobalMemories,
          [memory.id]: {
            ...memory,
            ...(memory.sourceMessage
              ? {
                  sourceMessage: {
                    ...memory.sourceMessage,
                    ...(memory.sourceMessage.values
                      ? { values: { ...memory.sourceMessage.values } }
                      : {}),
                  },
                }
              : {}),
            ...(memory.projectIds
              ? { projectIds: [...memory.projectIds] }
              : {}),
          },
        },
      };
    }
    case "skill/create-global": {
      const skill = action.skill;
      if (
        !isValidCustomGlobalSkill(skill) ||
        builtInSkills.some((candidate) => candidate.id === skill.id) ||
        state.customGlobalSkills[skill.id]
      ) {
        return state;
      }
      return {
        ...state,
        customGlobalSkills: {
          ...state.customGlobalSkills,
          [skill.id]: { ...skill, projectIds: [] },
        },
        skillEnabledById: {
          ...state.skillEnabledById,
          [skill.id]: skill.enabled,
        },
      };
    }
    case "memory/update-global": {
      const custom = state.customGlobalMemories[action.memoryId];
      if (custom) {
        return isValidEditableLibraryContent("memory", action.text)
          ? {
              ...state,
              customGlobalMemories: {
                ...state.customGlobalMemories,
                [custom.id]: { ...custom, text: action.text },
              },
            }
          : state;
      }
      const memory = builtInMemories.find(
        (candidate) =>
          candidate.id === action.memoryId && candidate.scope === "global",
      );
      if (!memory || !isValidEditableLibraryContent("memory", action.text)) {
        return state;
      }
      const globalMemoryTextById = { ...state.globalMemoryTextById };
      if (action.text === memory.text) delete globalMemoryTextById[memory.id];
      else globalMemoryTextById[memory.id] = action.text;
      return { ...state, globalMemoryTextById };
    }
    case "skill/update-global": {
      const custom = state.customGlobalSkills[action.skillId];
      if (custom) {
        return isValidEditableLibraryContent("skill", action.content)
          ? {
              ...state,
              customGlobalSkills: {
                ...state.customGlobalSkills,
                [custom.id]: { ...custom, content: action.content },
              },
            }
          : state;
      }
      const skill = builtInSkills.find(
        (candidate) =>
          candidate.id === action.skillId && candidate.scope === "global",
      );
      if (!skill || !isValidEditableLibraryContent("skill", action.content)) {
        return state;
      }
      const globalSkillContentById = { ...state.globalSkillContentById };
      if (isBuiltInSkillDefaultContent(skill.id, action.content))
        delete globalSkillContentById[skill.id];
      else globalSkillContentById[skill.id] = action.content;
      return { ...state, globalSkillContentById };
    }
    case "skill/set-enabled":
      if (action.scope === "project") {
        if (
          !state.projects[action.projectId] ||
          !hasProjectSkill(state, action.projectId, action.skillId)
        ) {
          return state;
        }
        return {
          ...state,
          projectSkillEnabledByProjectId: {
            ...state.projectSkillEnabledByProjectId,
            [action.projectId]: {
              ...state.projectSkillEnabledByProjectId[action.projectId],
              [action.skillId]: action.enabled,
            },
          },
        };
      }
      if (
        !getSkillCatalog(state).some(
          (skill) => skill.id === action.skillId && skill.scope === "global",
        )
      ) {
        return state;
      }
      return {
        ...state,
        skillEnabledById: {
          ...state.skillEnabledById,
          [action.skillId]: action.enabled,
        },
      };
  }
}
