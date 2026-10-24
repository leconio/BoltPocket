import * as Crypto from "expo-crypto";

import type { NotionConnectionCryptoPort } from "@/application/ports/notion-connections";

export const expoNotionCrypto: NotionConnectionCryptoPort = {
  sha256(value) {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  },
  randomUUID() {
    return Crypto.randomUUID();
  },
};
