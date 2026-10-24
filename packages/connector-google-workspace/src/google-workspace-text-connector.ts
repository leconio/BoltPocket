import {
  ConnectorError,
  sameResource,
  verifyApprovalBinding,
  type ApprovalGrant,
  type ConnectorDescriptor,
  type ConnectorResourceRef,
  type JsonValue,
  type ProjectConnector,
  type TextChangeProposal,
  type TextResourceSnapshot,
} from "@boltpocket/connector-core";

import type {
  GoogleWorkspaceRecoveryStore,
  GoogleWorkspaceTextApiPort,
} from "./contracts.ts";

export type GoogleWorkspaceResourceDefinition = {
  id: string;
  projectId: string;
  providerResourceId: string;
  displayName: string;
  locator: string;
  writable: boolean;
};

export type GoogleWorkspaceConnectorProfile = {
  descriptorKind: string;
  resourceKind: string;
  resourceNoun: string;
  mediaType: string;
  metadataIdKey: string;
  maximumCharacters: number;
  resourceUrl(resourceId: string): string;
};

export type GoogleWorkspaceTextConnectorOptions = {
  id: string;
  label: string;
  accountId: string;
  accountLabel: string;
  /** Project scopes granted to an account-only connector before a resource is attached. */
  projectIds?: string[];
  resources: GoogleWorkspaceResourceDefinition[];
  api: GoogleWorkspaceTextApiPort;
  recovery: GoogleWorkspaceRecoveryStore;
  profile: GoogleWorkspaceConnectorProfile;
  readOnly?: boolean;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export class GoogleWorkspaceTextConnector implements ProjectConnector {
  readonly #options: GoogleWorkspaceTextConnectorOptions;
  readonly #definitions = new Map<string, GoogleWorkspaceResourceDefinition>();
  readonly #consumedApprovals = new Set<string>();

  constructor(options: GoogleWorkspaceTextConnectorOptions) {
    this.#options = options;
    for (const definition of options.resources) {
      if (this.#definitions.has(definition.id)) {
        throw new ConnectorError(
          "unsupported",
          `Duplicate ${options.profile.resourceNoun} resource: ${definition.id}`,
        );
      }
      this.#definitions.set(definition.id, definition);
    }
  }

  descriptor(): ConnectorDescriptor {
    const projectIds = [
      ...new Set([
        ...(this.#options.projectIds ?? []),
        ...[...this.#definitions.values()].map((item) => item.projectId),
      ]),
    ];
    const readOnly =
      Boolean(this.#options.readOnly) ||
      (this.#definitions.size > 0 &&
        [...this.#definitions.values()].every(
          (resource) => !resource.writable,
        ));
    const canCreate =
      !this.#options.readOnly &&
      Boolean(this.#options.api.createResource) &&
      Boolean(this.#options.recovery.createCreationRecoveryPoint);
    return {
      id: this.#options.id,
      label: this.#options.label,
      kind: this.#options.profile.descriptorKind,
      accountId: this.#options.accountId,
      accountLabel: this.#options.accountLabel,
      status: "connected",
      projectIds,
      capabilities: readOnly
        ? ["list", "search", "read-text"]
        : [
            "list",
            "search",
            "read-text",
            ...(canCreate ? (["create-text"] as const) : []),
            "write-text",
            "recovery",
          ],
      ...(!readOnly ? { writeMode: "recoverable" as const } : {}),
    };
  }

  async list(input: { projectId: string }) {
    return [...this.#definitions.values()]
      .filter((definition) => definition.projectId === input.projectId)
      .map((definition) => this.#toRef(definition));
  }

  async search(input: { projectId: string; query: string; limit?: number }) {
    const query = input.query.trim().toLocaleLowerCase();
    const candidates = await this.list(input);
    if (!query) {
      return input.limit === undefined
        ? candidates
        : candidates.slice(0, input.limit);
    }
    const matches: ConnectorResourceRef[] = [];
    for (const ref of candidates) {
      const snapshot = await this.read(ref);
      if (
        ref.displayName.toLocaleLowerCase().includes(query) ||
        snapshot.text.toLocaleLowerCase().includes(query)
      ) {
        matches.push(ref);
      }
      if (input.limit && matches.length >= input.limit) break;
    }
    return matches;
  }

  async read(ref: ConnectorResourceRef): Promise<TextResourceSnapshot> {
    const definition = this.#requiredDefinition(ref);
    const snapshot = await this.#readResource(definition);
    return {
      ref: this.#toRef(definition),
      mediaType: this.#options.profile.mediaType,
      text: snapshot.text,
      version: snapshot.version,
      metadata: {
        title: snapshot.title,
        writable: snapshot.writable,
        trashable: snapshot.trashable ?? false,
        restorable: snapshot.restorable ?? false,
        trashed: snapshot.trashed ?? false,
        ...snapshot.metadata,
      },
    };
  }

  async validateTextChange(proposal: TextChangeProposal) {
    const definition = this.#requiredDefinition(proposal.ref);
    this.#assertWritable(definition);
    if (proposal.after === proposal.before) {
      throw new ConnectorError("unsupported", "Text change has no effect.");
    }
    this.#assertBoundedText(proposal.after);
    const current = await this.#readResource(definition);
    if (!current.writable || current.trashed) {
      throw new ConnectorError(
        "unsupported",
        `${this.#options.profile.resourceNoun} cannot be safely edited.`,
      );
    }
    if (
      current.version !== proposal.baseVersion ||
      current.text !== proposal.before
    ) {
      throw new ConnectorError(
        "conflict",
        `${this.#options.profile.resourceNoun} changed after the proposal was created.`,
        { retryable: true },
      );
    }
  }

  async applyTextChange(proposal: TextChangeProposal, approval: ApprovalGrant) {
    const definition = this.#requiredDefinition(proposal.ref);
    this.#assertWritable(definition);
    if (this.#consumedApprovals.has(approval.id)) {
      throw new ConnectorError(
        "approval_replayed",
        "Approval has already been used.",
      );
    }
    verifyApprovalBinding(approval, proposal, this.#now());
    await this.validateTextChange(proposal);
    const before = await this.#readResource(definition);
    if (
      before.version !== proposal.baseVersion ||
      before.text !== proposal.before ||
      !before.writable ||
      before.trashed
    ) {
      throw new ConnectorError(
        "conflict",
        `${this.#options.profile.resourceNoun} changed before recovery-point creation.`,
        { retryable: true },
      );
    }

    let storedRecovery;
    try {
      storedRecovery = await this.#options.recovery.createRecoveryPoint({
        ...before,
        accountId: this.#options.accountId,
      });
    } catch (error) {
      throw new ConnectorError(
        "recovery_failed",
        `Could not create a recovery point; ${this.#options.profile.resourceNoun} write was cancelled.`,
        { cause: error, retryable: true },
      );
    }

    this.#consumedApprovals.add(approval.id);
    let written;
    try {
      written = await this.#options.api.replaceResource({
        accountId: this.#options.accountId,
        resourceId: definition.providerResourceId,
        expectedVersion: proposal.baseVersion,
        text: proposal.after,
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        `Safe ${this.#options.profile.resourceNoun} replacement failed.`,
        { cause: error, retryable: true },
      );
    }
    if (written.text !== proposal.after || !written.version) {
      throw new ConnectorError(
        "io_failure",
        `${this.#options.profile.resourceNoun} replacement could not be verified.`,
      );
    }

    const appliedAt = this.#now().toISOString();
    return {
      ref: this.#toRef(definition),
      previousVersion: proposal.baseVersion,
      version: written.version,
      recoveryPoint: {
        id: this.#createId("recovery"),
        ref: this.#toRef(definition),
        version: storedRecovery.version,
        createdAt: appliedAt,
        storageRef: storedRecovery.storageRef,
      },
      appliedAt,
    };
  }

  async validateTextCreate(proposal: TextChangeProposal) {
    this.#assertCreateSupported();
    this.#assertBoundedText(proposal.after);
    if (
      proposal.ref.connectorId !== this.#options.id ||
      proposal.ref.accountId !== this.#options.accountId ||
      !this.descriptor().projectIds.includes(proposal.ref.projectId) ||
      this.#definitions.has(proposal.ref.resourceId) ||
      proposal.baseVersion !== "absent" ||
      proposal.before !== "" ||
      !proposal.ref.displayName.trim() ||
      proposal.ref.displayName.length > 1_000
    ) {
      throw new ConnectorError(
        "unsupported",
        `${this.#options.profile.resourceNoun} creation proposal is invalid.`,
      );
    }
  }

  async applyTextCreate(proposal: TextChangeProposal, approval: ApprovalGrant) {
    this.#assertCreateSupported();
    if (this.#consumedApprovals.has(approval.id)) {
      throw new ConnectorError(
        "approval_replayed",
        "Approval has already been used.",
      );
    }
    verifyApprovalBinding(approval, proposal, this.#now());
    await this.validateTextCreate(proposal);
    let storedRecovery;
    try {
      storedRecovery = await this.#options.recovery
        .createCreationRecoveryPoint!({
        accountId: this.#options.accountId,
        operationId: proposal.id,
        projectId: proposal.ref.projectId,
        title: proposal.ref.displayName,
      });
    } catch (error) {
      throw new ConnectorError(
        "recovery_failed",
        `Could not record the creation recovery intent; ${this.#options.profile.resourceNoun} creation was cancelled.`,
        { cause: error, retryable: true },
      );
    }
    this.#consumedApprovals.add(approval.id);
    let created;
    try {
      created = await this.#options.api.createResource!({
        accountId: this.#options.accountId,
        title: proposal.ref.displayName,
        text: proposal.after,
        operationId: proposal.id,
        connectionId: proposal.ref.connectorId,
        projectId: proposal.ref.projectId,
        resourceId: proposal.ref.resourceId,
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        `${this.#options.profile.resourceNoun} creation has an unknown outcome; it was not retried.`,
        { cause: error },
      );
    }
    if (
      !created.resourceId ||
      !created.version ||
      created.text !== proposal.after
    ) {
      throw new ConnectorError(
        "io_failure",
        `${this.#options.profile.resourceNoun} creation could not be verified.`,
      );
    }
    const ref: ConnectorResourceRef = {
      ...proposal.ref,
      kind: this.#options.profile.resourceKind,
      displayName: created.title,
      locator: this.#options.profile.resourceUrl(created.resourceId),
    };
    const appliedAt = this.#now().toISOString();
    const metadata: Record<string, JsonValue> = {
      title: created.title,
      [this.#options.profile.metadataIdKey]: created.resourceId,
      writable: created.writable,
      trashable: created.trashable ?? false,
      restorable: created.restorable ?? false,
      trashed: created.trashed ?? false,
      ...created.metadata,
    };
    return {
      ref,
      previousVersion: "absent",
      version: created.version,
      recoveryPoint: {
        id: this.#createId("recovery"),
        ref,
        version: storedRecovery.version,
        createdAt: appliedAt,
        storageRef: storedRecovery.storageRef,
      },
      appliedAt,
      snapshot: {
        ref,
        mediaType: this.#options.profile.mediaType,
        text: created.text,
        version: created.version,
        metadata,
      },
    };
  }

  #assertWritable(definition: GoogleWorkspaceResourceDefinition) {
    if (this.#options.readOnly || !definition.writable) {
      throw new ConnectorError(
        "unsupported",
        `This ${this.#options.profile.resourceNoun} connector is read-only.`,
      );
    }
  }

  #assertCreateSupported() {
    if (
      this.#options.readOnly ||
      !this.#options.api.createResource ||
      !this.#options.recovery.createCreationRecoveryPoint
    ) {
      throw new ConnectorError(
        "unsupported",
        `This ${this.#options.profile.resourceNoun} connector cannot create resources.`,
      );
    }
  }

  #assertBoundedText(text: string) {
    if (
      text.includes("\0") ||
      text.length > this.#options.profile.maximumCharacters
    ) {
      throw new ConnectorError(
        "unsupported",
        `${this.#options.profile.resourceNoun} content exceeds the safe text limit.`,
      );
    }
  }

  #requiredDefinition(ref: ConnectorResourceRef) {
    const definition = this.#definitions.get(ref.resourceId);
    if (!definition || !sameResource(ref, this.#toRef(definition))) {
      throw new ConnectorError(
        "permission_denied",
        `${this.#options.profile.resourceNoun} is outside this connector's project scope.`,
      );
    }
    return definition;
  }

  #toRef(definition: GoogleWorkspaceResourceDefinition): ConnectorResourceRef {
    return {
      connectorId: this.#options.id,
      accountId: this.#options.accountId,
      resourceId: definition.id,
      projectId: definition.projectId,
      kind: this.#options.profile.resourceKind,
      displayName: definition.displayName,
      locator: definition.locator,
    };
  }

  async #readResource(definition: GoogleWorkspaceResourceDefinition) {
    try {
      const snapshot = await this.#options.api.readResource(
        this.#options.accountId,
        definition.providerResourceId,
      );
      if (snapshot.resourceId !== definition.providerResourceId) {
        throw new ConnectorError(
          "permission_denied",
          `${this.#options.profile.resourceNoun} API returned another resource.`,
        );
      }
      return snapshot;
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        `Could not read ${this.#options.profile.resourceNoun}.`,
        { cause: error, retryable: true },
      );
    }
  }

  #now() {
    return this.#options.now?.() ?? new Date();
  }

  #createId(prefix: string) {
    return (
      this.#options.createId?.(prefix) ??
      `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    );
  }
}
