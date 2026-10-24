import type { ProjectPreviewSnapshot } from "@/application/ports/project-preview";

import type { BrowserTask } from "./browser-provider";

export type OpenProjectPreviewResolution = Readonly<{
  task: BrowserTask;
  /** Agent previews refresh the immutable snapshot in the existing tab. */
  replaceSnapshot: boolean;
}>;

export function resolveOpenProjectPreviewTask(
  tasks: readonly BrowserTask[],
  snapshot: Pick<ProjectPreviewSnapshot, "projectId" | "entryPath">,
  agentOwned: boolean,
): OpenProjectPreviewResolution | null {
  const task = tasks.find(
    (candidate) =>
      candidate.source.kind === "project-preview" &&
      candidate.source.snapshot.projectId === snapshot.projectId &&
      candidate.source.snapshot.entryPath === snapshot.entryPath,
  );
  return task ? { task, replaceSnapshot: agentOwned } : null;
}
