export type DocumentProviderId = "google" | "notion";

export type DocumentOAuthConnection = {
  accountId: string;
  accountName: string;
  connectionId: string;
  expiresAt: number;
  provider: DocumentProviderId;
  requiresReauthorization?: boolean;
};

export type DocumentAccessTokenLease = {
  accessToken: string;
  connectionId: string;
  leaseExpiresAt: number;
  provider: DocumentProviderId;
  tokenType: string;
};

export interface DocumentOAuthPort {
  connect(
    provider: DocumentProviderId,
  ): Promise<DocumentOAuthConnection | null>;
  lease(connectionId: string): Promise<DocumentAccessTokenLease>;
  list(provider?: DocumentProviderId): Promise<DocumentOAuthConnection[]>;
  /** Deletes both the broker-side encrypted grant and this device's session. */
  disconnect(connectionId: string): Promise<void>;
}
