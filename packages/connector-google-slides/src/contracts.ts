import type {
  GoogleWorkspaceRecoverySnapshot,
  GoogleWorkspaceRecoveryStore,
  GoogleWorkspaceStoredRecoveryPoint,
  GoogleWorkspaceTextApiPort,
  GoogleWorkspaceTextSnapshot,
} from "@boltpocket/connector-google-workspace";

export type GoogleSlidesPresentationSnapshot = GoogleWorkspaceTextSnapshot & {
  presentationId?: string;
};

export type GoogleSlidesRecoverySnapshot = GoogleWorkspaceRecoverySnapshot;
export type GoogleSlidesStoredRecoveryPoint =
  GoogleWorkspaceStoredRecoveryPoint;
export type GoogleSlidesApiPort = GoogleWorkspaceTextApiPort;
export type GoogleSlidesRecoveryStore = GoogleWorkspaceRecoveryStore;
