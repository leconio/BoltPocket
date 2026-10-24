import type {
  GoogleWorkspaceRecoverySnapshot,
  GoogleWorkspaceRecoveryStore,
  GoogleWorkspaceStoredRecoveryPoint,
  GoogleWorkspaceTextApiPort,
  GoogleWorkspaceTextSnapshot,
} from "@boltpocket/connector-google-workspace";

export type GoogleSheetsSpreadsheetSnapshot = GoogleWorkspaceTextSnapshot & {
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
};

export type GoogleSheetsRecoverySnapshot = GoogleWorkspaceRecoverySnapshot;
export type GoogleSheetsStoredRecoveryPoint =
  GoogleWorkspaceStoredRecoveryPoint;
export type GoogleSheetsApiPort = GoogleWorkspaceTextApiPort;
export type GoogleSheetsRecoveryStore = GoogleWorkspaceRecoveryStore;
