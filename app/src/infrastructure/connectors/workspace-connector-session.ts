import {
  ConnectorError,
  ConnectorRegistry,
  type ProjectConnector,
} from "@boltpocket/connector-core";
import {
  LocalTextConnector,
  type LocalTextStorageEntry,
  type LocalTextStoragePort,
  type StoredRecoveryPoint,
} from "@boltpocket/connector-local";
import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "@/domain/models";
import { createExpoNativeTextStorage } from "@/infrastructure/connectors/expo-native-text-connections";
import {
  createGoogleDocsWorkspaceConnector,
  type GoogleDocsWorkspaceBackend,
} from "@/infrastructure/connectors/google-docs-workspace-connector";
import {
  createGoogleSheetsWorkspaceConnector,
  type GoogleSheetsWorkspaceBackend,
} from "@/infrastructure/connectors/google-sheets-workspace-connector";
import {
  createGoogleSlidesWorkspaceConnector,
  type GoogleSlidesWorkspaceBackend,
} from "@/infrastructure/connectors/google-slides-workspace-connector";
import {
  createNotionWorkspaceConnector,
  type NotionWorkspaceBackend,
} from "@/infrastructure/connectors/notion-workspace-connector";
import { createExpoSourceTextStorage } from "@/infrastructure/sources/expo-project-source-snapshots";

class WorkspaceStateStorage implements LocalTextStoragePort {
  readonly #resourcesByLocator = new Map<string, WorkspaceResource>();
  readonly #recoveries = new Map<string, LocalTextStorageEntry>();
  readonly #readOnly: boolean;

  constructor(resources: WorkspaceResource[], readOnly: boolean) {
    for (const resource of resources) {
      this.#resourcesByLocator.set(resource.path, { ...resource });
    }
    this.#readOnly = readOnly;
  }

  async read(locator: string): Promise<LocalTextStorageEntry> {
    const resource = this.#resourcesByLocator.get(locator);
    if (!resource) {
      throw new ConnectorError("not_found", "Project resource was not found.");
    }
    return {
      locator,
      text: resource.content,
      version: String(resource.version),
    };
  }

  async createRecoveryPoint(
    locator: string,
    snapshot: LocalTextStorageEntry,
  ): Promise<StoredRecoveryPoint> {
    this.#assertWritable();
    const storageRef = `${locator}.boltpocket-recovery.${this.#recoveries.size + 1}`;
    this.#recoveries.set(storageRef, { ...snapshot });
    return { storageRef, version: snapshot.version };
  }

  async replaceWithRecovery(
    locator: string,
    expectedVersion: string,
    text: string,
  ): Promise<LocalTextStorageEntry> {
    this.#assertWritable();
    const current = this.#resourcesByLocator.get(locator);
    if (!current) {
      throw new ConnectorError("not_found", "Project resource was not found.");
    }
    if (String(current.version) !== expectedVersion) {
      throw new ConnectorError(
        "conflict",
        "Project resource version changed before write.",
      );
    }
    const numericVersion = Number(current.version);
    const nextVersion =
      Number.isSafeInteger(numericVersion) &&
      String(numericVersion) === current.version
        ? String(numericVersion + 1)
        : `${current.version}:next`;
    const next = { ...current, content: text, version: nextVersion };
    this.#resourcesByLocator.set(locator, next);
    return { locator, text, version: String(next.version) };
  }

  #assertWritable() {
    if (this.#readOnly) {
      throw new ConnectorError(
        "unsupported",
        "This project connector session is read-only.",
      );
    }
  }
}

function mediaType(path: string) {
  return path.toLocaleLowerCase().endsWith(".md")
    ? "text/markdown"
    : "text/plain";
}

export class WorkspaceConnectorSession {
  readonly registry: ConnectorRegistry;

  constructor(input: {
    project: Project;
    resources: WorkspaceResource[];
    connections?: ConnectionItem[];
    readOnly: boolean;
    googleDocs?: GoogleDocsWorkspaceBackend;
    googleSheets?: GoogleSheetsWorkspaceBackend;
    googleSlides?: GoogleSlidesWorkspaceBackend;
    notion?: NotionWorkspaceBackend;
  }) {
    const projectResources = input.resources.filter(
      (resource) => resource.projectId === input.project.id,
    );
    const byConnection = new Map<string, WorkspaceResource[]>();
    for (const resource of projectResources) {
      const group = byConnection.get(resource.connectionId) ?? [];
      group.push(resource);
      byConnection.set(resource.connectionId, group);
    }
    const resourceConnectors = [...byConnection].map(
      ([connectionId, resources]) => {
        const storageKinds = new Set(
          resources.map((resource) => resource.storage.kind),
        );
        if (storageKinds.size !== 1) {
          throw new ConnectorError(
            "unsupported",
            "One connector cannot mix different storage resource types.",
          );
        }
        const storageKind = resources[0]?.storage.kind;
        if (storageKind === "google-doc") {
          if (!input.googleDocs) {
            throw new ConnectorError(
              "not_connected",
              "Google Docs is not available for this connector session.",
            );
          }
          return createGoogleDocsWorkspaceConnector({
            connectionId,
            resources,
            readOnly: input.readOnly,
            backend: input.googleDocs,
          });
        }
        if (storageKind === "google-sheet") {
          if (!input.googleSheets) {
            throw new ConnectorError(
              "not_connected",
              "Google Sheets is not available for this connector session.",
            );
          }
          return createGoogleSheetsWorkspaceConnector({
            connectionId,
            resources,
            readOnly: input.readOnly,
            backend: input.googleSheets,
          });
        }
        if (storageKind === "google-slide") {
          if (!input.googleSlides) {
            throw new ConnectorError(
              "not_connected",
              "Google Slides is not available for this connector session.",
            );
          }
          return createGoogleSlidesWorkspaceConnector({
            connectionId,
            resources,
            readOnly: input.readOnly,
            backend: input.googleSlides,
          });
        }
        if (storageKind === "notion-page") {
          if (!input.notion) {
            throw new ConnectorError(
              "not_connected",
              "Notion is not available for this connector session.",
            );
          }
          return createNotionWorkspaceConnector({
            connectionId,
            resources,
            readOnly: input.readOnly,
            backend: input.notion,
          });
        }
        const isNative = storageKind === "native-file";
        const isSource = storageKind === "source-file";
        const storage = isNative
          ? createExpoNativeTextStorage(resources)
          : isSource
            ? createExpoSourceTextStorage(resources)
            : new WorkspaceStateStorage(resources, input.readOnly);
        return new LocalTextConnector({
          id: connectionId,
          label: connectionId,
          accountId: `project-${input.project.id}`,
          accountLabel: input.project.name,
          resources: resources.map((resource) => ({
            id: resource.id,
            projectId: resource.projectId,
            displayName: resource.path,
            locator:
              resource.storage.kind === "native-file" ||
              resource.storage.kind === "source-file"
                ? resource.storage.locator
                : resource.path,
            mediaType: mediaType(resource.path),
          })),
          storage,
          readOnly: input.readOnly || isSource,
          writeMode: isNative ? "recoverable" : "atomic",
        });
      },
    );
    const emptyGoogleConnectors: ProjectConnector[] = [];
    for (const connection of input.connections ?? []) {
      if (
        connection.projectId !== input.project.id ||
        connection.status !== "connected" ||
        connection.resourceCount !== 0 ||
        byConnection.has(connection.id) ||
        !connection.accountId
      ) {
        continue;
      }
      const common = {
        connectionId: connection.id,
        resources: [],
        readOnly: input.readOnly,
        projectId: input.project.id,
        accountId: connection.accountId!,
        accountLabel: connection.account,
      };
      if (connection.id.startsWith("google-docs-")) {
        if (input.googleDocs) {
          emptyGoogleConnectors.push(
            createGoogleDocsWorkspaceConnector({
              ...common,
              backend: input.googleDocs,
            }),
          );
        }
        continue;
      }
      if (connection.id.startsWith("google-sheets-")) {
        if (input.googleSheets) {
          emptyGoogleConnectors.push(
            createGoogleSheetsWorkspaceConnector({
              ...common,
              backend: input.googleSheets,
            }),
          );
        }
        continue;
      }
      if (connection.id.startsWith("google-slides-")) {
        if (input.googleSlides) {
          emptyGoogleConnectors.push(
            createGoogleSlidesWorkspaceConnector({
              ...common,
              backend: input.googleSlides,
            }),
          );
        }
      }
    }
    this.registry = new ConnectorRegistry([
      ...resourceConnectors,
      ...emptyGoogleConnectors,
    ]);
  }
}
