import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const platform = process.argv[2];
if (!["android", "ios"].includes(platform)) throw new Error("Expected android or ios");
const hook = resolve("app/ios/ci_scripts/ci_post_clone.sh");
const saved = existsSync(hook) ? readFileSync(hook) : undefined;
const result = spawnSync("pnpm", ["--filter", "@boltpocket/mobile", "exec", "expo", "prebuild", "--platform", platform, "--no-install"], { stdio: "inherit", env: { ...process.env, EXPO_PUBLIC_BOLTPOCKET_LOCAL_ONLY: "1", EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION: "global" } });
if (saved) { mkdirSync(resolve("app/ios/ci_scripts"), { recursive: true }); writeFileSync(hook, saved); }
if (result.status !== 0) process.exit(result.status ?? 1);
if (platform === "android") {
  const path = resolve("app/android/app/src/main/AndroidManifest.xml");
  const manifest = readFileSync(path, "utf8");
  if (!manifest.includes('android:name="libOpenCL.so"')) {
    writeFileSync(path, manifest.replace("</application>", '<uses-native-library android:name="libOpenCL.so" android:required="false" />\n  </application>'));
  }
}
if (platform === "ios") {
  const path = resolve("app/ios/Podfile.properties.json");
  const value = JSON.parse(readFileSync(path, "utf8")); value["ios.deploymentTarget"] = "18.0";
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
