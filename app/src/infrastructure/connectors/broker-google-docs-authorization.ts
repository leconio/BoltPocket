import type {
  GoogleDocsAccessSession,
  GoogleDocsAuthorizationPort,
} from "@/application/ports/google-docs-connections";
import type { ExpoDocumentOAuth } from "@/infrastructure/connectors/expo-document-oauth";

export class BrokerGoogleDocsAuthorization implements GoogleDocsAuthorizationPort {
  readonly #oauth: ExpoDocumentOAuth;

  constructor(oauth: ExpoDocumentOAuth) {
    this.#oauth = oauth;
  }

  async connect(force = false): Promise<GoogleDocsAccessSession | null> {
    const restored = force
      ? undefined
      : (await this.#oauth.list("google")).find(
          (connection) => !connection.requiresReauthorization,
        );
    const connection = restored ?? (await this.#oauth.connect("google"));
    if (!connection) return null;
    const lease = await this.#oauth.lease(connection.connectionId);
    return {
      account: { id: connection.accountId, label: connection.accountName },
      accessToken: lease.accessToken,
    };
  }

  async restore(): Promise<GoogleDocsAccessSession | null> {
    const connection = (await this.#oauth.list("google")).find(
      (candidate) => !candidate.requiresReauthorization,
    );
    if (!connection) return null;
    const lease = await this.#oauth.lease(connection.connectionId);
    return {
      account: { id: connection.accountId, label: connection.accountName },
      accessToken: lease.accessToken,
    };
  }

  async accessTokenFor(accountId: string) {
    const connection = await this.#oauth.connectionForAccount(
      "google",
      accountId,
    );
    if (!connection) throw new Error("Google 文档授权已过期，请重新连接。");
    return (await this.#oauth.lease(connection.connectionId)).accessToken;
  }

  async clearAccessToken(accessToken: string) {
    this.#oauth.clearLease(accessToken);
  }
}
