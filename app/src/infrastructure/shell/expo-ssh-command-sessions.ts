import * as Crypto from "expo-crypto";

import { BoltPocketSsh } from "@boltpocket/expo-ssh";

import type { CredentialVaultPort } from "../../application/ports/credential-vault.ts";
import { ExpoSshCommandProfileSecureStringStore } from "./expo-ssh-command-secure-string-store.ts";
import { SshCommandProfileVault } from "./ssh-command-credential-vault.ts";
import {
  SshCommandSessionManager,
  type NativeSshCommandClient,
} from "./ssh-command-session-service.ts";

async function profileId(projectId: string, alias: string) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([projectId, alias]),
  );
  return `ssh-${digest.slice(0, 16)}`;
}

export class ExpoSshCommandSessionService extends SshCommandSessionManager {
  constructor(options: {
    native?: NativeSshCommandClient;
    profileVault?: SshCommandProfileVault;
    credentialVault: CredentialVaultPort;
    createSessionId?: () => string;
    profileId?: (projectId: string, alias: string) => Promise<string>;
  }) {
    super({
      native: options.native ?? BoltPocketSsh,
      profileVault:
        options.profileVault ??
        new SshCommandProfileVault(
          new ExpoSshCommandProfileSecureStringStore(),
        ),
      credentialVault: options.credentialVault,
      createSessionId:
        options.createSessionId ?? (() => `ssh-session-${Crypto.randomUUID()}`),
      profileId: options.profileId ?? profileId,
    });
  }
}

export type { NativeSshCommandClient };
