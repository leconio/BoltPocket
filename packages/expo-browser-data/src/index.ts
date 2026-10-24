import { requireOptionalNativeModule } from "expo-modules-core";

type NativeBrowserData = {
  clear(): Promise<void>;
};

const nativeModule =
  requireOptionalNativeModule<NativeBrowserData>("BoltPocketBrowserData");

export async function clearBrowserWebsiteData() {
  if (!nativeModule) {
    throw new Error(
      "Browser website-data clearing is unavailable in this app build.",
    );
  }
  await nativeModule.clear();
}
