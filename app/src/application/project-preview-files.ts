import type { ProjectPreviewFile } from "./ports/project-preview.ts";
import {
  isBinaryProjectWorkspaceResource,
  type WorkspaceResource,
} from "../domain/models.ts";

/** Preserve exact copied-resource metadata when a workspace file enters H5 preview. */
export function workspaceResourceToProjectPreviewFile(
  resource: WorkspaceResource,
  path: string,
): ProjectPreviewFile {
  if (!isBinaryProjectWorkspaceResource(resource)) {
    return { path, content: resource.content };
  }

  const { binary } = resource.storage;
  return {
    path,
    content: resource.content,
    encoding: binary.encoding,
    mimeType: binary.mimeType,
    byteLength: binary.byteLength,
    sha256: binary.sha256,
    source: { ...binary.source },
  };
}
