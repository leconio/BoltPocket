import type { WorkspaceResource } from "./models";

/** Only these resources have a host-owned storage adapter in this app. */
export function isLocalResourceStorage(
  kind: WorkspaceResource["storage"]["kind"],
) {
  return (
    kind === "memory" ||
    kind === "project-workspace" ||
    kind === "native-file" ||
    kind === "source-file"
  );
}
