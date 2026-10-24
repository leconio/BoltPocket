import * as SecureStore from "expo-secure-store";

import {
  CodexDeviceOAuth,
  type CodexCredentialStore,
} from "./codex-device-oauth.ts";
import { expoModelFetch } from "./expo-model-fetch";

const KEYCHAIN_SERVICE = "dev.boltpocket.app.model-config";
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: KEYCHAIN_SERVICE,
};

const expoCodexCredentialStore: CodexCredentialStore = {
  deleteItem: (key) => SecureStore.deleteItemAsync(key, secureStoreOptions),
  getItem: (key) => SecureStore.getItemAsync(key, secureStoreOptions),
  setItem: (key, value) =>
    SecureStore.setItemAsync(key, value, secureStoreOptions),
};

export const codexDeviceOAuth = new CodexDeviceOAuth({
  fetch: expoModelFetch,
  secureStore: expoCodexCredentialStore,
});
