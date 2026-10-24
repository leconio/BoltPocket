import * as Crypto from "expo-crypto";

import type { GoogleDocsConnectionCryptoPort } from "@/application/ports/google-docs-connections";

export const expoGoogleDocsCrypto: GoogleDocsConnectionCryptoPort = {
  sha256(value) {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  },
  randomUUID() {
    return Crypto.randomUUID();
  },
};
