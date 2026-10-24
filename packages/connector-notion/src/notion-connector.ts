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

import type { NotionApiPort, NotionRecoveryStore } from "./contracts.ts";
import { canonicalizeNotionMarkdown } from "./notion-markdown.ts";

export type NotionResourceDefinition = {
  id: string;
  projectId: string;
  pageId: string;
  displayName: string;
  locator: string;
  writable: boolean;
};

export type NotionConnectorOptions = {
  id: string;
  label: string;
  accountId: string;
  accountLabel: string;
  resources: NotionResourceDefinition[];
  api: NotionApiPort;
  recovery: NotionRecoveryStore;
  readOnly?: boolean;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export class NotionConnector implements ProjectConnector {
  readonly #options: NotionConnectorOptions;
  readonly #definitions = new Map<string, NotionResourceDefinition>();
  readonly #consumedApprovals = new Set<string>();

  constructor(options: NotionConnectorOptions) {
    this.#options = options;
    for (const definition of options.resources) {
      if (this.#definitions.has(definition.id)) {
        throw new ConnectorError(
          "unsupported",
          `Duplicate Notion page resource: ${definition.id}`,
        );
      }
      this.#definitions.set(definition.id, definition);
    }
  }

  descriptor(): ConnectorDescriptor {
    const readOnly =
      Boolean(this.#options.readOnly) ||
      [...this.#definitions.values()].every((resource) => !resource.writable);
    const canCreate =
      !this.#options.readOnly &&
      Boolean(this.#options.api.createPage) &&
      Boolean(this.#options.recovery.createCreationRecoveryPoint);
    return {
      id: this.#options.id,
      label: this.#options.label,
      kind: "notion",
      accountId: this.#options.accountId,
      accountLabel: this.#options.accountLabel,
      status: "connected",
      projectIds: [
        ...new Set(
          [...this.#definitions.values()].map((item) => item.projectId),
        ),
      ],
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
    const snapshot = await this.#readPage(definition);
    return {
      ref: this.#toRef(definition),
      mediaType: "text/markdown",
      text: snapshot.markdown,
      version: snapshot.version,
      metadata: {
        title: snapshot.title,
        writable: snapshot.writable,
        trashed: snapshot.trashed,
        trashable: snapshot.trashable,
        restorable: snapshot.restorable,
      },
    };
  }

  async validateTextChange(proposal: TextChangeProposal) {
    const definition = this.#requiredDefinition(proposal.ref);
    this.#assertWritable(definition);
    if (proposal.after === proposal.before) {
      throw new ConnectorError("unsupported", "Text change has no effect.");
    }
    if (proposal.after !== canonicalizeNotionMarkdown(proposal.after)) {
      throw new ConnectorError(
        "unsupported",
        "Notion change must use canonical Markdown whitespace.",
      );
    }
    const current = await this.#readPage(definition);
    if (!current.writable || current.trashed) {
      throw new ConnectorError(
        "unsupported",
        "This Notion page cannot be safely replaced as markdown.",
      );
    }
    if (
      current.version !== proposal.baseVersion ||
      current.markdown !== proposal.before
    ) {
      throw new ConnectorError(
        "conflict",
        "Notion page changed after the proposal was created.",
        { retryable: true },
      );
    }
  }

  async applyTextChange(proposal: TextChangeProposal, approval: ApprovalGrant) {
    const definition = this.#requiredDefinition(proposal.ref);
    this.#assertWritable(definition);
    this.#assertApprovalUnused(approval.id);
    verifyApprovalBinding(approval, proposal, this.#now());
    await this.validateTextChange(proposal);
    const before = await this.#readPage(definition);
    if (
      before.version !== proposal.baseVersion ||
      before.markdown !== proposal.before ||
      !before.writable ||
      before.trashed
    ) {
      throw new ConnectorError(
        "conflict",
        "Notion page changed before recovery-point creation.",
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
        "Could not create a recovery point; Notion write was cancelled.",
        { cause: error, retryable: true },
      );
    }
    this.#consumedApprovals.add(approval.id);
    let written;
    try {
      written = await this.#options.api.replacePage({
        accountId: this.#options.accountId,
        pageId: definition.pageId,
        expectedVersion: proposal.baseVersion,
        markdown: proposal.after,
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        "Safe Notion replacement failed.",
        { cause: error, retryable: true },
      );
    }
    if (written.markdown !== proposal.after || !written.version) {
      throw new ConnectorError(
        "io_failure",
        "Notion replacement could not be verified.",
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
    if (
      proposal.ref.connectorId !== this.#options.id ||
      proposal.ref.accountId !== this.#options.accountId ||
      !this.descriptor().projectIds.includes(proposal.ref.projectId) ||
      this.#definitions.has(proposal.ref.resourceId) ||
      proposal.baseVersion !== "absent" ||
      proposal.before !== "" ||
      proposal.after !== canonicalizeNotionMarkdown(proposal.after) ||
      !proposal.ref.displayName.trim() ||
      proposal.ref.displayName.length > 1_000 ||
      proposal.after.includes("\0") ||
      proposal.after.length > 100_000
    ) {
      throw new ConnectorError(
        "unsupported",
        "Notion page creation proposal is invalid.",
      );
    }
  }

  async applyTextCreate(proposal: TextChangeProposal, approval: ApprovalGrant) {
    this.#assertCreateSupported();
    this.#assertApprovalUnused(approval.id);
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
        "Could not record the creation recovery intent; Notion creation was cancelled.",
        { cause: error, retryable: true },
      );
    }
    this.#consumedApprovals.add(approval.id);
    let created;
    try {
      created = await this.#options.api.createPage!({
        accountId: this.#options.accountId,
        title: proposal.ref.displayName,
        markdown: proposal.after,
        operationId: proposal.id,
        connectionId: proposal.ref.connectorId,
        projectId: proposal.ref.projectId,
        resourceId: proposal.ref.resourceId,
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        "Notion page creation has an unknown outcome; it was not retried.",
        { cause: error },
      );
    }
    if (
      !created.pageId ||
      !created.version ||
      created.markdown !== proposal.after
    ) {
      throw new ConnectorError(
        "io_failure",
        "Notion page creation could not be verified.",
      );
    }
    const ref: ConnectorResourceRef = {
      ...proposal.ref,
      kind: "notion-page",
      displayName: created.title,
      locator: created.locator,
    };
    const appliedAt = this.#now().toISOString();
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
        mediaType: "text/markdown",
        text: created.markdown,
        version: created.version,
        metadata: {
          title: created.title,
          pageId: created.pageId,
          writable: created.writable,
          trashable: created.trashable,
          restorable: created.restorable,
          trashed: created.trashed,
        },
      },
    };
  }

  #assertApprovalUnused(id: string) {
    if (this.#consumedApprovals.has(id)) {
      throw new ConnectorError(
        "approval_replayed",
        "Approval has already been used.",
      );
    }
  }

  #assertWritable(definition: NotionResourceDefinition) {
    if (this.#options.readOnly || !definition.writable) {
      throw new ConnectorError(
        "unsupported",
        "This Notion connector is read-only.",
      );
    }
  }

  #assertCreateSupported() {
    if (
      this.#options.readOnly ||
      !this.#options.api.createPage ||
      !this.#options.recovery.createCreationRecoveryPoint
    ) {
      throw new ConnectorError(
        "unsupported",
        "This Notion connector cannot create pages.",
      );
    }
  }

  #requiredDefinition(ref: ConnectorResourceRef) {
    const definition = this.#definitions.get(ref.resourceId);
    if (!definition || !sameResource(ref, this.#toRef(definition))) {
      throw new ConnectorError(
        "permission_denied",
        "Notion page is outside this connector's project scope.",
      );
    }
    return definition;
  }

  #toRef(definition: NotionResourceDefinition): ConnectorResourceRef {
    return {
      connectorId: this.#options.id,
      accountId: this.#options.accountId,
      resourceId: definition.id,
      projectId: definition.projectId,
      kind: "notion-page",
      displayName: definition.displayName,
      locator: definition.locator,
    };
  }

  async #readPage(definition: NotionResourceDefinition) {
    try {
      const snapshot = await this.#options.api.readPage(
        this.#options.accountId,
        definition.pageId,
      );
      if (snapshot.pageId !== definition.pageId) {
        throw new ConnectorError(
          "permission_denied",
          "Notion API returned another page.",
        );
      }
      return snapshot;
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "io_failure",
        "Could not read the Notion page.",
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
