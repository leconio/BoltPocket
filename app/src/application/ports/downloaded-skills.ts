export type DownloadedSkill = Readonly<{
  autoUpdate: boolean;
  catalogId: string;
  installedAt: string;
  /** Null means the Skill belongs to the app-wide installed inventory. */
  projectId: string | null;
  resourcePath: string;
  revision: string;
  sha256: string;
  skillId: string;
  sourceId: string;
  updatedAt: string;
}>;

export interface DownloadedSkillRepositoryPort {
  list(): Promise<readonly DownloadedSkill[]>;
  save(item: DownloadedSkill): Promise<void>;
  remove(projectId: string | null, skillId: string): Promise<void>;
}
