import type {
  ConnectorDescriptor,
  ConnectorResourceRef,
  ProjectConnector,
  SearchResourcesInput,
  TextResourceSnapshot,
} from "./contracts.ts";
import { ConnectorError } from "./errors.ts";

export class ConnectorRegistry {
  readonly #connectors = new Map<string, ProjectConnector>();

  constructor(connectors: ProjectConnector[] = []) {
    for (const connector of connectors) this.register(connector);
  }

  register(connector: ProjectConnector) {
    const descriptor = connector.descriptor();
    if (this.#connectors.has(descriptor.id)) {
      throw new ConnectorError(
        "unsupported",
        `Connector is already registered: ${descriptor.id}`,
      );
    }
    this.#connectors.set(descriptor.id, connector);
  }

  descriptors(projectId?: string): ConnectorDescriptor[] {
    return [...this.#connectors.values()]
      .map((connector) => connector.descriptor())
      .filter(
        (descriptor) => !projectId || descriptor.projectIds.includes(projectId),
      );
  }

  async listResources(projectId: string) {
    const pages = await Promise.all(
      this.descriptors(projectId).map(async (descriptor) => {
        const refs = await this.required(descriptor.id).list({ projectId });
        this.#assertReturnedScope(refs, descriptor.id, projectId);
        return refs;
      }),
    );
    return pages.flat();
  }

  async searchResources(input: SearchResourcesInput) {
    const pages = await Promise.all(
      this.descriptors(input.projectId).map(async (descriptor) => {
        const refs = await this.required(descriptor.id).search(input);
        this.#assertReturnedScope(refs, descriptor.id, input.projectId);
        return refs;
      }),
    );
    const results = pages.flat();
    return input.limit === undefined ? results : results.slice(0, input.limit);
  }

  read(ref: ConnectorResourceRef): Promise<TextResourceSnapshot> {
    return this.required(ref.connectorId).read(ref);
  }

  required(connectorId: string) {
    const connector = this.#connectors.get(connectorId);
    if (!connector) {
      throw new ConnectorError(
        "not_found",
        `Connector is not registered: ${connectorId}`,
      );
    }
    return connector;
  }

  #assertReturnedScope(
    refs: readonly ConnectorResourceRef[],
    connectorId: string,
    projectId: string,
  ) {
    for (const ref of refs) {
      if (ref.connectorId !== connectorId || ref.projectId !== projectId) {
        throw new ConnectorError(
          "permission_denied",
          "Connector returned a resource outside the requested project scope.",
        );
      }
    }
  }
}
