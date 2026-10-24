export type CasdoorAuthorizationProof = Readonly<{
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}>;

export interface CasdoorAuthorizationClient {
  createProof(): Promise<CasdoorAuthorizationProof>;
  open(authorizeUrl: string, redirectUri: string): Promise<string | null>;
}

export class ExpoCasdoorAuthorizationClient implements CasdoorAuthorizationClient {
  async createProof(): Promise<CasdoorAuthorizationProof> {
    const codeVerifier = await randomBase64Url();
    return {
      state: await randomBase64Url(),
      codeVerifier,
      codeChallenge: await sha256Base64Url(codeVerifier),
    };
  }

  async open(authorizeUrl: string, redirectUri: string) {
    const WebBrowser = await import("expo-web-browser");
    const result = await WebBrowser.openAuthSessionAsync(
      authorizeUrl,
      redirectUri,
    );
    return result.type === "success" ? result.url : null;
  }
}

async function randomBase64Url() {
  const Crypto = await import("expo-crypto");
  return sha256Base64Url(`${Crypto.randomUUID()}\u0000${Crypto.randomUUID()}`);
}

async function sha256Base64Url(value: string) {
  const Crypto = await import("expo-crypto");
  const base64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
