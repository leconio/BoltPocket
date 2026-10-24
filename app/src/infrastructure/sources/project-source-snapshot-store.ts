import type {
  ProjectResourceBundle,
  ProjectSourceKind,
} from "@/application/ports/project-source-snapshots";
import type { AppLocale } from "@/i18n/translate";

export const PROJECT_SOURCE_SNAPSHOT_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024,
  maxFiles: 1_501,
  maxTextBytes: 6 * 1024 * 1024 + 256 * 1024,
  maxSnapshots: 64,
});

export type ProjectSourceFileDraft = {
  id: string;
  path: string;
  content: string;
  version: string;
  byteLength: number;
};

export type ProjectSourceSnapshotDraft = {
  id: string;
  projectId: string;
  connectionId: string;
  reportConnectionId: string;
  reportResourceId: string;
  reportPath: string;
  sourceKind: ProjectSourceKind;
  /** Stable, adapter-owned identity. It is not displayed to the model. */
  sourceKey: string;
  sourceLabel: string;
  mountPath: string;
  revision: string;
  versionLabel: string;
  contentSha256: string;
  importedAt: string;
  manifestPath: string;
  files: ProjectSourceFileDraft[];
};

export interface ProjectSourceSnapshotStore {
  load(): Promise<ProjectResourceBundle[]>;
  find(
    projectId: string,
    sourceKind: ProjectSourceKind,
    sourceKey: string,
    revision: string,
  ): Promise<ProjectResourceBundle[] | null>;
  store(
    draft: ProjectSourceSnapshotDraft,
    locale?: AppLocale,
  ): Promise<ProjectResourceBundle[]>;
}
