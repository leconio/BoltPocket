import type { DownloadedSkill } from "@/application/ports/downloaded-skills";
import type { SkillItem } from "@/domain/models";
import { validateProjectSkillDocument } from "@/domain/project-skill-document";
import {
  isProtectedMarketDownload,
  PROTECTED_MARKET_SKILL_PLACEHOLDER,
  type ProtectedMarketSkillRepository,
} from "@/infrastructure/capabilities/protected-market-skill-repository";

export async function hydrateProtectedMarketSkillsForRun(input: {
  authorize?: (download: DownloadedSkill) => Promise<void>;
  downloads: readonly DownloadedSkill[];
  repository: ProtectedMarketSkillRepository;
  skills: readonly SkillItem[];
}) {
  const downloadsBySkillId = new Map(
    input.downloads
      .filter(isProtectedMarketDownload)
      .map((item) => [item.skillId, item]),
  );
  let protectedSkillCount = 0;
  const protectedSkillIds: string[] = [];
  const skills: SkillItem[] = [];
  for (const skill of input.skills) {
    if (skill.content !== PROTECTED_MARKET_SKILL_PLACEHOLDER) {
      skills.push(skill);
      continue;
    }
    const download = downloadsBySkillId.get(skill.id);
    if (!download) {
      throw new Error("Protected Skill metadata is missing.");
    }
    await input.authorize?.(download);
    const document = await input.repository.load(download);
    const validation = validateProjectSkillDocument(
      download.resourcePath,
      document,
    );
    if (!validation.valid || validation.document.name !== skill.id) {
      throw new Error("Protected Skill instructions are invalid.");
    }
    skills.push({ ...skill, content: validation.document.body });
    protectedSkillIds.push(skill.id);
    protectedSkillCount += 1;
  }
  return { protectedSkillCount, protectedSkillIds, skills } as const;
}
