import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ListRow, ScreenHeader } from "@/components/ui";
import {
  cloudDocumentConnectorsEnabled,
  loadComplianceConfig,
} from "@/config/compliance";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

const selectConnectionCatalogState = createAppStateFieldsSelector("projects");

export function ConnectionCatalogScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { connectNativeTextDirectory } = useAppActions();
  const state = useAppStateSelector(selectConnectionCatalogState);
  const project = projectId ? state.projects[projectId] : undefined;
  const cloudDocumentsEnabled = cloudDocumentConnectorsEnabled(
    loadComplianceConfig(),
  );
  const [isConnectingDevice, setIsConnectingDevice] = useState(false);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(
      project
        ? { pathname: "/connections", params: { projectId: project.id } }
        : "/projects",
    );
  };

  const connectDevice = async () => {
    if (!project || isConnectingDevice) return;
    setIsConnectingDevice(true);
    try {
      const bundle = await connectNativeTextDirectory(project.id);
      if (bundle) {
        router.dismissTo({
          pathname: "/connections",
          params: { projectId: project.id },
        });
      }
    } catch (error) {
      Alert.alert(
        t("connections.catalog.failed"),
        localizedErrorMessage(error, t("connections.catalog.device.failed")),
      );
    } finally {
      setIsConnectingDevice(false);
    }
  };

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        subtitle={project?.name}
        title={t("connections.catalog.add")}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {project ? (
          <>
            {cloudDocumentsEnabled ? (
              <>
                <ListRow
                  detail={t("connections.catalog.google.detail")}
                  icon="document-text-outline"
                  onPress={() =>
                    router.push({
                      pathname: "/connections/google-docs",
                      params: { projectId: project.id },
                    })
                  }
                  palette={palette}
                  title={t("connections.catalog.google.title")}
                />
                <ListRow
                  detail={t("connections.catalog.notion.detail")}
                  icon="document-text-outline"
                  onPress={() =>
                    router.push({
                      pathname: "/connections/notion",
                      params: { projectId: project.id },
                    })
                  }
                  palette={palette}
                  title={t("connections.catalog.notion.title")}
                />
              </>
            ) : null}
            <ListRow
              detail={t("connections.catalog.device.detail")}
              icon="folder-open-outline"
              onPress={() => void connectDevice()}
              palette={palette}
              title={t("connections.catalog.device.title")}
              value={
                isConnectingDevice
                  ? t("connections.catalog.connecting")
                  : undefined
              }
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
});
