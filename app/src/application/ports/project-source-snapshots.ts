import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";
import type { AppLocale } from "@/i18n/translate";

export type ProjectResourceBundle = {
  connection: ConnectionItem;
  resources: WorkspaceResource[];
};

export type ProjectSourceKind =
  | "github-public"
  | "local-file"
  | "local-archive"
  | "pasted-text"
  | "public-archive";

export type ProjectSourceImportRequest = {
  kind: "github-public";
  url: string;
};

export type ProjectSourceImportProgress =
  "inspect" | "acquire" | "extract" | "store";

export type ProjectSourceImportResult = {
  sourceKind: ProjectSourceKind;
  sourceLabel: string;
  revision: string;
  versionLabel: string;
  cached: boolean;
  bundles: ProjectResourceBundle[];
};

export interface ProjectSourceSnapshotService {
  load(): Promise<ProjectResourceBundle[]>;
  importSource(input: {
    project: Project;
    source: ProjectSourceImportRequest;
    locale?: AppLocale;
    signal?: AbortSignal;
    onProgress?: (progress: ProjectSourceImportProgress) => void;
  }): Promise<ProjectSourceImportResult>;
}
