import type { MemoryItem, SkillItem } from "./models.ts";
import {
  generatedGlobalSkillDocuments,
  generatedGlobalSkillDocumentsByLocale,
  generatedGlobalSkillMessageKeysById,
} from "./global-skills.generated.ts";
import { translateMessage } from "../i18n/messages.ts";
import type { AppLocale } from "../i18n/translate.ts";

/**
 * Runtime library entries must come from an installed or product-owned source.
 * Global Skill documents stay in app/skills and are generated into the mobile
 * bundle; this is only a React Native adapter around the upstream Skill reader.
 */
export const builtInMemories: readonly MemoryItem[] = [];

const globalSkillPolicy = {
  "build-h5": { risk: "propose", enabled: true },
  "operate-browser": { risk: "read", enabled: true },
  "operate-device": { risk: "propose", enabled: true },
  "manage-calendar-reminders": { risk: "propose", enabled: true },
  "read-device-sensors": { risk: "read", enabled: true },
  "play-device-audio": { risk: "propose", enabled: true },
  "operate-ssh": { risk: "propose", enabled: true },
  "skill-authoring": { risk: "propose", enabled: true },
  "use-bootstrap-icons": { risk: "propose", enabled: true },
  "use-h5-resources": { risk: "propose", enabled: true },
  "use-kenney-1bit": { risk: "propose", enabled: true },
  "use-kenney-ui": { risk: "propose", enabled: true },
} as const satisfies Record<
  (typeof generatedGlobalSkillDocuments)[number]["id"],
  Pick<SkillItem, "risk" | "enabled">
>;

export const builtInSkills: readonly SkillItem[] =
  generatedGlobalSkillDocuments.map((document) => ({
    id: document.id,
    name: document.name,
    description: document.description,
    content: document.content,
    ...globalSkillPolicy[document.id],
    scope: "global",
    projectIds: [],
  }));

const builtInSkillById = new Map(
  builtInSkills.map((skill) => [skill.id, skill] as const),
);

const builtInSkillDefaultContentById = new Map<string, ReadonlySet<string>>();
for (const documents of Object.values(generatedGlobalSkillDocumentsByLocale)) {
  for (const document of documents) {
    const contents = new Set(builtInSkillDefaultContentById.get(document.id));
    contents.add(document.content);
    builtInSkillDefaultContentById.set(document.id, contents);
  }
}

/**
 * A built-in Skill body may arrive from any supported UI locale. Treat every
 * manually authored localized body as product-owned default copy so saving an
 * unchanged editor never turns that translation into a user override.
 */
export function isBuiltInSkillDefaultContent(skillId: string, content: string) {
  return builtInSkillDefaultContentById.get(skillId)?.has(content) ?? false;
}

export function isManualGlobalMemorySource(source: string) {
  return (["zh-CN", "en"] as const).some(
    (locale) =>
      source ===
      translateMessage("library.screen.memory.source.manual", locale),
  );
}

/**
 * Product-owned Skills have manually authored copy for every supported locale.
 * A user-edited body is user content, so it is preserved verbatim rather than
 * translated or replaced when the interface language changes.
 */
export function localizeSkillCatalog(
  skills: readonly SkillItem[],
  locale: AppLocale,
): SkillItem[] {
  return skills.map((skill) => {
    if (!Object.hasOwn(generatedGlobalSkillMessageKeysById, skill.id)) {
      return skill;
    }
    const skillId =
      skill.id as keyof typeof generatedGlobalSkillMessageKeysById;
    const keys = generatedGlobalSkillMessageKeysById[skillId];
    return {
      ...skill,
      name: translateMessage(keys.name, locale),
      description: translateMessage(keys.description, locale),
      content:
        builtInSkillById.has(skill.id) &&
        isBuiltInSkillDefaultContent(skill.id, skill.content)
          ? translateMessage(keys.content, locale)
          : skill.content,
    };
  });
}

export const defaultGlobalSkillEnabledById: Readonly<Record<string, boolean>> =
  Object.freeze(
    Object.fromEntries(builtInSkills.map((skill) => [skill.id, skill.enabled])),
  );
