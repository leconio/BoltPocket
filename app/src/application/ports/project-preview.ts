import type { ProjectH5Manifest } from "@/domain/project-h5-manifest";
import type { BuiltInProjectResourcePackId } from "@/domain/builtin-project-resources";
import type { ProjectWorkspaceBinarySource } from "@/domain/models";

export type ProjectPreviewFile = Readonly<{
  /** Absolute path inside the current project's virtual /project tree. */
  path: string;
  content: string;
  /** Binary project files keep their exact bytes as canonical base64. */
  encoding?: "base64";
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
  source?: Readonly<ProjectWorkspaceBinarySource>;
}>;

export type ProjectPreviewSnapshot = Readonly<{
  id: string;
  projectId: string;
  entryPath: string;
  displayPath: string;
  url: string;
  /** App-private snapshot directory consumed only by the native WebView loader. */
  rootUri: string;
  fileCount: number;
  byteLength: number;
  /** SHA-256 of the canonical immutable file manifest for consent binding. */
  contentSha256: string;
  app: ProjectH5Manifest;
  runtime: Readonly<{
    assetCount: number;
    byteLength: number;
  }>;
  resources?: Readonly<{
    packCount: number;
    fileCount: number;
    byteLength: number;
  }>;
  createdAt: number;
}>;

export type CreateProjectPreviewInput = Readonly<{
  projectId: string;
  entryPath: string;
  files: readonly ProjectPreviewFile[];
  /** Project-authorized built-in packs. The manifest may select only these. */
  enabledResourcePackIds?: readonly BuiltInProjectResourcePackId[];
}>;

export interface ProjectPreviewSnapshotPort {
  create(input: CreateProjectPreviewInput): Promise<ProjectPreviewSnapshot>;
  release(snapshotId: string): Promise<void> | void;
}
