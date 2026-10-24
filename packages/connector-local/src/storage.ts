export type LocalTextStorageEntry = {
  locator: string;
  text: string;
  version: string;
};

export type StoredRecoveryPoint = {
  storageRef: string;
  version: string;
};

export interface LocalTextStoragePort {
  read(locator: string): Promise<LocalTextStorageEntry>;
  createRecoveryPoint(
    locator: string,
    snapshot: LocalTextStorageEntry,
  ): Promise<StoredRecoveryPoint>;
  replaceWithRecovery(
    locator: string,
    expectedVersion: string,
    text: string,
  ): Promise<LocalTextStorageEntry>;
}
