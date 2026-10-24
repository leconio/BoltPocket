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

import type { LocalTextStoragePort } from "./storage.ts";

export type LocalTextResourceDefinition = {
  id: string;
  projectId: string;
  displayName: string;
  locator: string;
  mediaType: string;
};

export type LocalTextConnectorOptions = {
  id: string;
  label: string;
  accountId: string;
  accountLabel: string;
  resources: LocalTextResourceDefinition[];
  storage: LocalTextStoragePort;
  readOnly?: boolean;
  writeMode?: "atomic" | "recoverable";
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export class LocalTextConnector implements ProjectConnector {
  readonly #options: LocalTextConnectorOptions;
  readonly #definitions = new Map<string, LocalTextResourceDefinition>();
  readonly #consumedApprovals = new Set<string>();

  constructor(options: LocalTextConnectorOptions) {
    this.#options = options;
    for (const definition of options.resources) {
      if (this.#definitions.has(definition.id)) {
        throw new ConnectorError(
          "unsupported",
          `Duplicate local resource: ${definition.id}`,
        );
      }
      this.#definitions.set(definition.id, definition);
    }
  }

  descriptor(): ConnectorDescriptor {
    const readOnly = Boolean(this.#options.readOnly);
    return {
      id: this.#options.id,
      label: this.#options.label,
      kind: "local-text",
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
        : ["list", "search", "read-text", "write-text", "recovery"],
      ...(!readOnly
        ? { writeMode: this.#options.writeMode ?? ("atomic" as const) }
        : {}),
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
    const stored = await this.#readStored(definition.locator);
    return {
      ref: this.#toRef(definition),
      mediaType: definition.mediaType,
      text: stored.text,
      version: stored.version,
      metadata: {},
    };
  }

  async validateTextChange(proposal: TextChangeProposal) {
    const definition = this.#requiredDefinition(proposal.ref);
    if (proposal.after === proposal.before) {
      throw new ConnectorError("unsupported", "Text change has no effect.");
    }
    const stored = await this.#readStored(definition.locator);
    if (
      stored.version !== proposal.baseVersion ||
      stored.text !== proposal.before
    ) {
      throw new ConnectorError(
        "conflict",
        "Resource changed after the proposal was created.",
        { retryable: true },
      );
    }
  }

  async applyTextChange(proposal: TextChangeProposal, approval: ApprovalGrant) {
    if (this.#options.readOnly) {
      throw new ConnectorError(
        "unsupported",
        "This connector instance is read-only.",
      );
    }
    if (this.#consumedApprovals.has(approval.id)) {
      throw new ConnectorError(
        "approval_replayed",
        "Approval has already been used.",
      );
    }
    verifyApprovalBinding(approval, proposal, this.#now());
    await this.validateTextChange(proposal);
    const definition = this.#requiredDefinition(proposal.ref);
    const before = await this.#readStored(definition.locator);

    let storedRecovery;
    try {
      storedRecovery = await this.#options.storage.createRecoveryPoint(
        definition.locator,
        before,
      );
    } catch (error) {
      throw new ConnectorError(
        "recovery_failed",
        "Could not create a recovery point; write was cancelled.",
        { cause: error, retryable: true },
      );
    }

    // Consume before the external write begins. An uncertain write result must
    // never be retried with the same grant.
    this.#consumedApprovals.add(approval.id);
    let written;
    try {
      written = await this.#options.storage.replaceWithRecovery(
        definition.locator,
        proposal.baseVersion,
        proposal.after,
      );
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError("io_failure", "Safe text replacement failed.", {
        cause: error,
        retryable: true,
      });
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

  #requiredDefinition(ref: ConnectorResourceRef) {
    const definition = this.#definitions.get(ref.resourceId);
    if (!definition || !sameResource(ref, this.#toRef(definition))) {
      throw new ConnectorError(
        "permission_denied",
        "Resource is outside this connector's project scope.",
      );
    }
    return definition;
  }

  #toRef(definition: LocalTextResourceDefinition): ConnectorResourceRef {
    return {
      connectorId: this.#options.id,
      accountId: this.#options.accountId,
      resourceId: definition.id,
      projectId: definition.projectId,
      kind: "text",
      displayName: definition.displayName,
      locator: definition.locator,
    };
  }

  async #readStored(locator: string) {
    try {
      return await this.#options.storage.read(locator);
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError("io_failure", "Could not read text resource.", {
        cause: error,
        retryable: true,
      });
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
