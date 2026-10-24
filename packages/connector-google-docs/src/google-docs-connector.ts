import {
  ConnectorError,
  sameResource,
  verifyApprovalBinding,
  type ApprovalGrant,
  type ConnectorDescriptor,
  type ConnectorResourceRef,
  type ProjectConnector,
  type TextChangeProposal,
  type TextResourceSnapshot,
} from "@boltpocket/connector-core";

import type {
  GoogleDocsApiPort,
  GoogleDocsRecoveryStore,
} from "./contracts.ts";

export type GoogleDocsResourceDefinition = {
  id: string;
  projectId: string;
  documentId: string;
  displayName: string;
  locator: string;
  writable: boolean;
};

export type GoogleDocsConnectorOptions = {
  id: string;
  label: string;
  accountId: string;
  accountLabel: string;
  /** Project scopes granted to an account-only connector before any document is attached. */
  projectIds?: string[];
  resources: GoogleDocsResourceDefinition[];
  api: GoogleDocsApiPort;
  recovery: GoogleDocsRecoveryStore;
  readOnly?: boolean;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export class GoogleDocsConnector implements ProjectConnector {
  readonly #options: GoogleDocsConnectorOptions;
  readonly #definitions = new Map<string, GoogleDocsResourceDefinition>();
  readonly #consumedApprovals = new Set<string>();

  constructor(options: GoogleDocsConnectorOptions) {
    this.#options = options;
    for (const definition of options.resources) {
      if (this.#definitions.has(definition.id)) {
        throw new ConnectorError(
          "unsupported",
          `Duplicate Google Docs resource: ${definition.id}`,
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
      Boolean(this.#options.api.createDocument) &&
      Boolean(this.#options.recovery.createCreationRecoveryPoint);
    return {
      id: this.#options.id,
      label: this.#options.label,
      kind: "google-docs",
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
    const snapshot = await this.#readDocument(definition);
    return {
      ref: this.#toRef(definition),
      mediaType: "text/plain",
      text: snapshot.text,
      version: snapshot.revisionId,
      metadata: {
        title: snapshot.title,
        writable: snapshot.writable,
      },
    };
  }

  async validateTextChange(proposal: TextChangeProposal) {
    const definition = this.#requiredDefinition(proposal.ref);
    this.#assertWritable(definition);
    if (proposal.after === proposal.before) {
      throw new ConnectorError("unsupported", "Text change has no effect.");
    }
    const current = await this.#readDocument(definition);
    if (!current.writable) {
      throw new ConnectorError(
        "unsupported",
        "This Google document cannot be replaced without losing structure.",
      );
    }
    if (
      current.revisionId !== proposal.baseVersion ||
      current.text !== proposal.before
    ) {
      throw new ConnectorError(
        "conflict",
        "Google document changed after the proposal was created.",
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
    const before = await this.#readDocument(definition);
    if (
      before.revisionId !== proposal.baseVersion ||
      before.text !== proposal.before ||
      !before.writable
    ) {
      throw new ConnectorError(
        "conflict",
        "Google document changed before recovery-point creation.",
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
        "Could not create a recovery point; Google Docs write was cancelled.",
        { cause: error, retryable: true },
      );
    }

    this.#consumedApprovals.add(approval.id);
    let written;
    try {
      written = await this.#options.api.replaceDocument({
        accountId: this.#options.accountId,
        documentId: definition.documentId,
        expectedRevisionId: proposal.baseVersion,
        text: proposal.after,
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        "Safe Google Docs replacement failed.",
        { cause: error, retryable: true },
      );
    }
    if (written.text !== proposal.after || !written.revisionId) {
      throw new ConnectorError(
        "io_failure",
        "Google Docs replacement could not be verified.",
      );
    }

    const appliedAt = this.#now().toISOString();
    return {
      ref: this.#toRef(definition),
      previousVersion: proposal.baseVersion,
      version: written.revisionId,
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
    if (
      proposal.ref.connectorId !== this.#options.id ||
      proposal.ref.accountId !== this.#options.accountId ||
      !this.descriptor().projectIds.includes(proposal.ref.projectId) ||
      this.#definitions.has(proposal.ref.resourceId) ||
      proposal.baseVersion !== "absent" ||
      proposal.before !== "" ||
      !proposal.ref.displayName.trim() ||
      proposal.ref.displayName.length > 1_000 ||
      proposal.after.includes("\0") ||
      proposal.after.length > 100_000
    ) {
      throw new ConnectorError(
        "unsupported",
        "Google document creation proposal is invalid.",
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
        "Could not record the creation recovery intent; Google Docs creation was cancelled.",
        { cause: error, retryable: true },
      );
    }
    this.#consumedApprovals.add(approval.id);
    let created;
    try {
      created = await this.#options.api.createDocument!({
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
        "Google document creation has an unknown outcome; it was not retried.",
        { cause: error },
      );
    }
    if (
      !created.documentId ||
      !created.revisionId ||
      created.text !== proposal.after
    ) {
      throw new ConnectorError(
        "io_failure",
        "Google document creation could not be verified.",
      );
    }
    const ref: ConnectorResourceRef = {
      ...proposal.ref,
      kind: "google-doc",
      displayName: created.title,
      locator: `https://docs.google.com/document/d/${created.documentId}/edit`,
    };
    const appliedAt = this.#now().toISOString();
    return {
      ref,
      previousVersion: "absent",
      version: created.revisionId,
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
        mediaType: "text/plain",
        text: created.text,
        version: created.revisionId,
        metadata: {
          title: created.title,
          documentId: created.documentId,
          writable: created.writable,
          trashable: created.trashable ?? false,
          restorable: created.restorable ?? false,
          trashed: created.trashed ?? false,
        },
      },
    };
  }

  #assertWritable(definition: GoogleDocsResourceDefinition) {
    if (this.#options.readOnly || !definition.writable) {
      throw new ConnectorError(
        "unsupported",
        "This Google Docs connector is read-only.",
      );
    }
  }

  #assertCreateSupported() {
    if (
      this.#options.readOnly ||
      !this.#options.api.createDocument ||
      !this.#options.recovery.createCreationRecoveryPoint
    ) {
      throw new ConnectorError(
        "unsupported",
        "This Google Docs connector cannot create documents.",
      );
    }
  }

  #requiredDefinition(ref: ConnectorResourceRef) {
    const definition = this.#definitions.get(ref.resourceId);
    if (!definition || !sameResource(ref, this.#toRef(definition))) {
      throw new ConnectorError(
        "permission_denied",
        "Google document is outside this connector's project scope.",
      );
    }
    return definition;
  }

  #toRef(definition: GoogleDocsResourceDefinition): ConnectorResourceRef {
    return {
      connectorId: this.#options.id,
      accountId: this.#options.accountId,
      resourceId: definition.id,
      projectId: definition.projectId,
      kind: "google-doc",
      displayName: definition.displayName,
      locator: definition.locator,
    };
  }

  async #readDocument(definition: GoogleDocsResourceDefinition) {
    try {
      const snapshot = await this.#options.api.readDocument(
        this.#options.accountId,
        definition.documentId,
      );
      if (snapshot.documentId !== definition.documentId) {
        throw new ConnectorError(
          "permission_denied",
          "Google Docs API returned another document.",
        );
      }
      return snapshot;
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        "Could not read the Google document.",
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
