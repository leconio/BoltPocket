import type { ConfigContext, ExpoConfig } from "expo/config";

export const DISTRIBUTION_BUILD_PLUGIN =
  "./distribution-build-config.cjs" as const;

type ExpoPlugin = NonNullable<ExpoConfig["plugins"]>[number];
type DistributionMode = "automatic" | "global" | "china-mainland";

function parseDistributionMode(value: string | undefined): DistributionMode {
  const mode = value?.trim() || "automatic";
  if (mode !== "automatic" && mode !== "global" && mode !== "china-mainland") {
    throw new Error(
      "EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION must be automatic, global, or china-mainland.",
    );
  }
  return mode;
}

function pluginName(plugin: ExpoPlugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

/**
 * This is the only native build composition point for distribution-specific
 * services. Push, map, or other regional config plugins belong here instead
 * of in screens or generated ios/android projects.
 */
export function resolveAppConfig(
  config: ConfigContext["config"],
  mode: DistributionMode = parseDistributionMode(
    process.env.EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION,
  ),
): ExpoConfig {
  if (process.env.EXPO_PUBLIC_BOLTPOCKET_LOCAL_ONLY !== "0") {
    return {
      ...config,
      name: "BoltPocket",
      slug: "boltpocket",
      scheme: "boltpocket",
      icon: "./assets/boltpocket/icon.png",
      ios: {
        ...config.ios,
        icon: "./assets/boltpocket/icon.png",
        bundleIdentifier: "dev.boltpocket.app",
        associatedDomains: [],
        entitlements:
          process.env.BOLTPOCKET_IOS_INCREASED_MEMORY === "1"
            ? { "com.apple.developer.kernel.increased-memory-limit": true }
            : {},
        infoPlist: {
          ...config.ios?.infoPlist,
          CFBundleDisplayName: "BoltPocket",
          UIFileSharingEnabled: true,
          LSSupportsOpeningDocumentsInPlace: true,
        },
      },
      android: {
        ...config.android,
        package: "dev.boltpocket.app",
        adaptiveIcon: {
          backgroundColor: "#17382f",
          foregroundImage: "./assets/boltpocket/foreground.png",
          monochromeImage: "./assets/boltpocket/monochrome.png",
        },
      },
      plugins: (config.plugins ?? [])
        .filter(
          (plugin) =>
            ![
              DISTRIBUTION_BUILD_PLUGIN,
              "./app-display-name-config.cjs",
              "./with-android-release-signing.cjs",
              "expo-splash-screen",
            ].includes(pluginName(plugin) ?? ""),
        )
        .concat([
          ["expo-build-properties", { ios: { enableSceneSupport: true, deploymentTarget: "18.0" } }],
          [
            "expo-splash-screen",
            {
              backgroundColor: "#17382f",
              image: "./assets/boltpocket/foreground.png",
              imageWidth: 104,
            },
          ],
        ]),
      extra: { router: {}, boltpocketDistributionMode: "global" },
    };
  }
  const plugins = (config.plugins ?? []).filter(
    (plugin) => pluginName(plugin) !== DISTRIBUTION_BUILD_PLUGIN,
  );
  return {
    ...config,
    name: config.name ?? "BoltPocket",
    slug: config.slug ?? "boltpocket",
    plugins: [
      ...plugins,
      [DISTRIBUTION_BUILD_PLUGIN, { mode }] satisfies ExpoPlugin,
    ],
    extra: {
      ...config.extra,
      boltpocketDistributionMode: mode,
    },
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  resolveAppConfig(config);
