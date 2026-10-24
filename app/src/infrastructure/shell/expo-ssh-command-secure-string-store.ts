import * as SecureStore from "expo-secure-store";

import type { SecureStringStore } from "./ssh-command-credential-vault";

const KEYCHAIN_SERVICE = "dev.boltpocket.app.ssh-profiles";

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: KEYCHAIN_SERVICE,
};

export class ExpoSshCommandProfileSecureStringStore implements SecureStringStore {
  isAvailable() {
    return SecureStore.isAvailableAsync();
  }

  get(key: string) {
    return SecureStore.getItemAsync(key, secureStoreOptions);
  }

  set(key: string, value: string) {
    return SecureStore.setItemAsync(key, value, secureStoreOptions);
  }

  remove(key: string) {
    return SecureStore.deleteItemAsync(key, secureStoreOptions);
  }
}
