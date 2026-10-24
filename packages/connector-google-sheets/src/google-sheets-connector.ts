import {
  GoogleWorkspaceTextConnector,
  type GoogleWorkspaceTextConnectorOptions,
} from "@boltpocket/connector-google-workspace";
import {
  ConnectorError,
  type TextChangeProposal,
} from "@boltpocket/connector-core";

import {
  canonicalizeGoogleSheetCsv,
  MAX_GOOGLE_SHEET_CHARACTERS,
} from "./google-sheets-csv.ts";
import { googleSpreadsheetResourceUrl } from "./google-sheets-link.ts";
import type {
  GoogleSheetsApiPort,
  GoogleSheetsRecoveryStore,
} from "./contracts.ts";

export type GoogleSheetsResourceDefinition = {
  id: string;
  projectId: string;
  spreadsheetResourceId: string;
  displayName: string;
  locator: string;
  writable: boolean;
};

export type GoogleSheetsConnectorOptions = Omit<
  GoogleWorkspaceTextConnectorOptions,
  "api" | "profile" | "recovery" | "resources"
> & {
  resources: GoogleSheetsResourceDefinition[];
  api: GoogleSheetsApiPort;
  recovery: GoogleSheetsRecoveryStore;
};

export class GoogleSheetsConnector extends GoogleWorkspaceTextConnector {
  constructor(options: GoogleSheetsConnectorOptions) {
    super({
      ...options,
      resources: options.resources.map((resource) => ({
        id: resource.id,
        projectId: resource.projectId,
        providerResourceId: resource.spreadsheetResourceId,
        displayName: resource.displayName,
        locator: resource.locator,
        writable: resource.writable,
      })),
      profile: {
        descriptorKind: "google-sheets",
        resourceKind: "google-sheet",
        resourceNoun: "Google spreadsheet",
        mediaType: "text/csv",
        metadataIdKey: "spreadsheetId",
        maximumCharacters: MAX_GOOGLE_SHEET_CHARACTERS,
        resourceUrl: googleSpreadsheetResourceUrl,
      },
    });
  }

  override async validateTextChange(proposal: TextChangeProposal) {
    assertCanonicalCsv(proposal.after);
    await super.validateTextChange(proposal);
  }

  override async validateTextCreate(proposal: TextChangeProposal) {
    assertCanonicalCsv(proposal.after);
    await super.validateTextCreate(proposal);
  }
}

function assertCanonicalCsv(value: string) {
  if (canonicalizeGoogleSheetCsv(value) !== value) {
    throw new ConnectorError(
      "unsupported",
      "Google 表格内容必须是规范 CSV，不能包含多余空行或尾随空列。",
    );
  }
}
