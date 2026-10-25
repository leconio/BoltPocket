import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { enableFreeze } from "react-native-screens";

import { AppProvider } from "@/providers/app-provider";
import { LoadingIndicator } from "@/components/loading-indicator";
import { AppBrowserHost } from "@/features/browser/app-browser-host";
import { ModelSettingsSessionProvider } from "@/features/settings/model-settings-session";
import { I18nProvider, useI18n } from "@/i18n/i18n-provider";
import {
  BrowserProvider,
  useBrowserState,
} from "@/features/browser/browser-provider";
import { useAppPalette } from "@/theme/tokens";
import { AppErrorBoundary } from "@/features/release/app-error-boundary";
import { AuthenticationProvider } from "@/providers/authentication-provider";
import { PrivacyConsentBoundary } from "@/features/privacy/privacy-consent-boundary";
import {
  DistributionRegionProvider,
  useDistributionRegion,
} from "@/providers/distribution-region-provider";
import { RuntimeServicesProvider } from "@/providers/runtime-services-provider";

enableFreeze(true);

function NavigationRoot() {
  const palette = useAppPalette();

  return (
    <Stack
      screenOptions={{
        animation: "default",
        contentStyle: { backgroundColor: palette.background },
        freezeOnBlur: true,
        headerShown: false,
      }}
    >
      <Stack.Screen name="(drawer)" />
      <Stack.Screen name="local-benchmark" />
      <Stack.Screen name="account" />
      <Stack.Screen name="projects" />
      <Stack.Screen name="memory" />
      <Stack.Screen name="skills" />
      <Stack.Screen name="skills/add" />
      <Stack.Screen name="skill-market/search" />
      <Stack.Screen name="skill-market/[entryId]" />
      <Stack.Screen name="connections" />
      <Stack.Screen name="connections/add" />
      <Stack.Screen name="connections/google-docs" />
      <Stack.Screen name="connections/notion" />
      <Stack.Screen name="mcp/index" />
      <Stack.Screen name="mcp/editor" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="settings/language" />
      <Stack.Screen name="library-detail" />
      <Stack.Screen name="library-create" />
      <Stack.Screen name="project/[projectId]" />
      <Stack.Screen name="project-h5/[projectId]" />
      <Stack.Screen name="h5-history" />
      <Stack.Screen name="project-resources/[projectId]/index" />
      <Stack.Screen name="project-resources/[projectId]/[packId]/index" />
      <Stack.Screen name="project-resources/[projectId]/[packId]/[fileIndex]" />
      <Stack.Screen name="project-files/[projectId]/index" />
      <Stack.Screen name="project-files/[projectId]/[resourceId]" />
      <Stack.Screen name="conversations" />
      <Stack.Screen name="conversation/[conversationId]" />
      <Stack.Screen name="conversation/claim" />
      <Stack.Screen name="conversation/message" />
      <Stack.Screen name="conversation/media" />
      <Stack.Screen name="conversation/report" />
      <Stack.Screen name="settings/browser" />
      <Stack.Screen name="settings/browser-permissions" />
      <Stack.Screen name="settings/device" />
      <Stack.Screen name="settings/model" />
      <Stack.Screen
        name="settings/model-add"
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="settings/vault" />
      <Stack.Screen name="settings/vault-editor" />
      <Stack.Screen name="settings/privacy" />
      <Stack.Screen name="settings/legal" />
      <Stack.Screen name="settings/about" />
      <Stack.Screen name="changes/[proposalId]" />
    </Stack>
  );
}

function NavigationSurface() {
  const palette = useAppPalette();
  const browserExpanded = useBrowserState(
    (browser) => browser.mode === "expanded",
  );

  return (
    <View
      accessibilityElementsHidden={browserExpanded}
      importantForAccessibility={
        browserExpanded ? "no-hide-descendants" : "auto"
      }
      style={{ backgroundColor: palette.background, flex: 1 }}
    >
      <NavigationRoot />
    </View>
  );
}

function LocalizedApplication() {
  const { ready, t } = useI18n();
  const palette = useAppPalette();

  if (!ready) {
    return (
      <GestureHandlerRootView
        style={{ backgroundColor: palette.background, flex: 1 }}
      >
        <View
          style={{
            alignItems: "center",
            backgroundColor: palette.background,
            flex: 1,
            justifyContent: "center",
          }}
        >
          <LoadingIndicator
            accessibilityLabel={t("settings.language.reading")}
            palette={palette}
            style={{ flex: 1 }}
            variant="screen"
          />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView
      style={{ backgroundColor: palette.background, flex: 1 }}
    >
      <AppProvider>
        <ModelSettingsSessionProvider>
          <BrowserProvider>
            <NavigationSurface />
            <AppBrowserHost />
          </BrowserProvider>
        </ModelSettingsSessionProvider>
      </AppProvider>
    </GestureHandlerRootView>
  );
}

function RootSurface() {
  const colorScheme = useColorScheme();
  const palette = useAppPalette();
  const region = useDistributionRegion();

  return (
    <View style={{ backgroundColor: palette.background, flex: 1 }}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <AppErrorBoundary>
        <PrivacyConsentBoundary>
          <RuntimeServicesProvider key={region} region={region}>
            <AuthenticationProvider>
              <LocalizedApplication />
            </AuthenticationProvider>
          </RuntimeServicesProvider>
        </PrivacyConsentBoundary>
      </AppErrorBoundary>
    </View>
  );
}

export default function RootLayout() {
  return (
    <I18nProvider>
      <DistributionRegionProvider>
        <RootSurface />
      </DistributionRegionProvider>
    </I18nProvider>
  );
}
