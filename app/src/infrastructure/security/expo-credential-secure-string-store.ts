import * as SecureStore from "expo-secure-store";

import type { CredentialSecureStringStore } from "./credential-vault";

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: "dev.boltpocket.app.credential-vault",
};

export class ExpoCredentialSecureStringStore implements CredentialSecureStringStore {
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
