import type { ProjectPreviewSnapshot } from "@/application/ports/project-preview";
import {
  projectH5PermissionDeclarations,
  type ProjectH5Permission,
  type ProjectH5PermissionDeclaration,
} from "./project-h5-manifest";

export type ProjectH5ConsentState =
  | Readonly<{ state: "undeclared" }>
  | Readonly<{
      state: "denied";
      declaration: ProjectH5PermissionDeclaration;
    }>
  | Readonly<{ state: "granted"; declaration: ProjectH5PermissionDeclaration }>
  | Readonly<{
      state: "prompt";
      declaration: ProjectH5PermissionDeclaration;
    }>;

function sessionKey(
  taskId: string,
  contentSha256: string,
  capability: ProjectH5Permission,
) {
  return `${taskId}:${contentSha256}:${capability}`;
}

function networkKey(taskId: string, contentSha256: string) {
  return `${taskId}:${contentSha256}:network`;
}

export type ProjectH5NetworkConsentState =
  "not-required" | "prompt" | "granted" | "denied";

/**
 * Ephemeral, content-bound grants for one immutable H5 preview. Nothing is
 * persisted: hiding, closing, or replacing a task revokes every session grant.
 */
export class ProjectH5CapabilityConsentLedger {
  readonly #sessionGrants = new Set<string>();
  readonly #sessionDenials = new Set<string>();
  readonly #networkGrants = new Set<string>();
  readonly #networkDenials = new Set<string>();

  state(
    taskId: string,
    snapshot: Pick<ProjectPreviewSnapshot, "contentSha256" | "app">,
    capability: ProjectH5Permission,
  ): ProjectH5ConsentState {
    const declaration = projectH5PermissionDeclarations(snapshot.app).find(
      ({ id }) => id === capability,
    );
    if (!declaration) return { state: "undeclared" };
    const key = sessionKey(taskId, snapshot.contentSha256, capability);
    if (this.#sessionDenials.has(key)) {
      return { state: "denied", declaration };
    }
    if (declaration.mode === "session" && this.#sessionGrants.has(key)) {
      return { state: "granted", declaration };
    }
    return { state: "prompt", declaration };
  }

  grant(
    taskId: string,
    snapshot: Pick<ProjectPreviewSnapshot, "contentSha256">,
    declaration: ProjectH5PermissionDeclaration,
  ) {
    const key = sessionKey(taskId, snapshot.contentSha256, declaration.id);
    this.#sessionDenials.delete(key);
    if (declaration.mode === "session") this.#sessionGrants.add(key);
  }

  deny(
    taskId: string,
    snapshot: Pick<ProjectPreviewSnapshot, "contentSha256">,
    declaration: ProjectH5PermissionDeclaration,
  ) {
    const key = sessionKey(taskId, snapshot.contentSha256, declaration.id);
    this.#sessionGrants.delete(key);
    this.#sessionDenials.add(key);
  }

  resetCapability(
    taskId: string,
    snapshot: Pick<ProjectPreviewSnapshot, "contentSha256">,
    capability: ProjectH5Permission,
  ) {
    const key = sessionKey(taskId, snapshot.contentSha256, capability);
    this.#sessionGrants.delete(key);
    this.#sessionDenials.delete(key);
  }

  networkState(
    taskId: string,
    snapshot: Pick<ProjectPreviewSnapshot, "contentSha256" | "app">,
  ): ProjectH5NetworkConsentState {
    if (!snapshot.app.network?.length) return "not-required";
    const key = networkKey(taskId, snapshot.contentSha256);
    if (this.#networkGrants.has(key)) return "granted";
    if (this.#networkDenials.has(key)) return "denied";
    return "prompt";
  }

  grantNetwork(
    taskId: string,
    snapshot: Pick<ProjectPreviewSnapshot, "contentSha256">,
  ) {
    const key = networkKey(taskId, snapshot.contentSha256);
    this.#networkDenials.delete(key);
    this.#networkGrants.add(key);
  }

  denyNetwork(
    taskId: string,
    snapshot: Pick<ProjectPreviewSnapshot, "contentSha256">,
  ) {
    const key = networkKey(taskId, snapshot.contentSha256);
    this.#networkGrants.delete(key);
    this.#networkDenials.add(key);
  }

  resetNetwork(
    taskId: string,
    snapshot: Pick<ProjectPreviewSnapshot, "contentSha256">,
  ) {
    const key = networkKey(taskId, snapshot.contentSha256);
    this.#networkGrants.delete(key);
    this.#networkDenials.delete(key);
  }

  revokeContent(taskId: string, contentSha256: string) {
    const prefix = `${taskId}:${contentSha256}:`;
    for (const key of this.#sessionGrants) {
      if (key.startsWith(prefix)) this.#sessionGrants.delete(key);
    }
    for (const key of this.#sessionDenials) {
      if (key.startsWith(prefix)) this.#sessionDenials.delete(key);
    }
    for (const key of this.#networkGrants) {
      if (key.startsWith(prefix)) this.#networkGrants.delete(key);
    }
    for (const key of this.#networkDenials) {
      if (key.startsWith(prefix)) this.#networkDenials.delete(key);
    }
  }

  revokeTask(taskId: string) {
    const prefix = `${taskId}:`;
    for (const key of this.#sessionGrants) {
      if (key.startsWith(prefix)) this.#sessionGrants.delete(key);
    }
    for (const key of this.#sessionDenials) {
      if (key.startsWith(prefix)) this.#sessionDenials.delete(key);
    }
    for (const key of this.#networkGrants) {
      if (key.startsWith(prefix)) this.#networkGrants.delete(key);
    }
    for (const key of this.#networkDenials) {
      if (key.startsWith(prefix)) this.#networkDenials.delete(key);
    }
  }

  revokeAll() {
    this.#sessionGrants.clear();
    this.#sessionDenials.clear();
    this.#networkGrants.clear();
    this.#networkDenials.clear();
  }
}
