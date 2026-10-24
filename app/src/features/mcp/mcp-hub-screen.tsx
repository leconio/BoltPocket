import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, SectionList, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  McpConnection,
  McpConnectionInput,
} from "@/application/ports/mcp-connections";
import { CapabilityRow } from "@/components/capability-row";
import { LoadingIndicator } from "@/components/loading-indicator";
import {
  loadComplianceConfig,
  thirdPartyMcpEnabled,
} from "@/config/compliance";
import {
  IconButton,
  PageEmptyState,
  ScreenHeader,
  SectionLabel,
} from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  useAppActions,
  useSessionStateSelector,
} from "@/providers/app-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

function connectionHost(serverUrl: string) {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

function authenticationKey(connection: McpConnection) {
  if (connection.authentication.kind === "oauth") {
    return "connections.mcp.hub.auth.oauth" as const;
  }
  if (connection.authentication.kind === "vault-token") {
    return "connections.mcp.hub.auth.token" as const;
  }
  return "connections.mcp.hub.auth.none" as const;
}

function updatedInput(
  connection: McpConnection,
  enabled: boolean,
): McpConnectionInput {
  return {
    projectId: null,
    name: connection.name,
    serverUrl: connection.serverUrl,
    authentication: connection.authentication,
    enabled,
    trustToolAnnotations: connection.trustToolAnnotations,
    ...(connection.allowedToolNames
      ? { allowedToolNames: connection.allowedToolNames }
      : {}),
    ...(connection.approveTools
      ? { approveTools: connection.approveTools }
      : {}),
  };
}

export function McpHubScreen() {
  const mcpAvailable = thirdPartyMcpEnabled(loadComplianceConfig());
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { removeMcpConnection, updateMcpConnection } = useAppActions();
  const mcpConnectionItems = useSessionStateSelector(
    (session) => session.mcpConnectionItems,
  );
  const mcpConnectionsLoading = useSessionStateSelector(
    (session) => session.mcpConnectionsLoading,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);

  const sections = useMemo(() => {
    return mcpConnectionItems.length
      ? [
          {
            data: mcpConnectionItems,
            title: t("connections.mcp.hub.globalServices"),
          },
        ]
      : [];
  }, [mcpConnectionItems, t]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const openEditor = (connection?: McpConnection) => {
    router.push({
      pathname: "/mcp/editor",
      params: connection ? { connectionId: connection.id } : {},
    });
  };

  const toggleConnection = async (
    connection: McpConnection,
    enabled: boolean,
  ) => {
    if (pendingId) return;
    setPendingId(connection.id);
    try {
      await updateMcpConnection(
        connection.id,
        updatedInput(connection, enabled),
      );
    } catch (error) {
      Alert.alert(
        t("connections.mcp.saveFailed"),
        localizedErrorMessage(error, t("connections.mcp.saveFailedDetail")),
      );
    } finally {
      setPendingId(null);
    }
  };

  const removeStoredConnection = (connection: McpConnection) => {
    if (pendingId) return;
    Alert.alert(
      t("connections.mcp.remove"),
      t("connections.mcp.removeDetail"),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("connections.mcp.remove"),
          style: "destructive",
          onPress: () => {
            setPendingId(connection.id);
            void removeMcpConnection(connection.id)
              .catch((error: unknown) =>
                Alert.alert(
                  t("connections.mcp.removeFailed"),
                  localizedErrorMessage(
                    error,
                    t("connections.mcp.removeFailedDetail"),
                  ),
                ),
              )
              .finally(() => setPendingId(null));
          },
        },
      ],
    );
  };

  if (mcpAvailable && mcpConnectionsLoading) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <LoadingIndicator
          accessibilityLabel={t("connections.mcp.loading")}
          palette={palette}
          style={styles.safeArea}
          variant="screen"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader
        onBack={goBack}
        palette={palette}
        right={
          mcpAvailable ? (
            <IconButton
              icon="add"
              label={t("connections.mcp.hub.add")}
              onPress={() => openEditor()}
              palette={palette}
            />
          ) : null
        }
        title="MCP"
      />
      <SectionList
        contentContainerStyle={[
          styles.content,
          sections.length === 0 && styles.emptyContent,
        ]}
        ListEmptyComponent={
          <PageEmptyState
            action={
              mcpAvailable
                ? {
                    label: t("connections.mcp.hub.addCompact"),
                    onPress: () => openEditor(),
                  }
                : undefined
            }
            description={t(
              mcpAvailable
                ? "connections.mcp.hub.emptyDetail"
                : "connections.mcp.regionUnavailableDetail",
            )}
            palette={palette}
          />
        }
        renderItem={({ item: connection }) => {
          return (
            <CapabilityRow
              detail={
                !mcpAvailable
                  ? t("connections.mcp.regionStoredDetail")
                  : `${connectionHost(connection.serverUrl)} · ${t(
                      authenticationKey(connection),
                    )}`
              }
              disabled={pendingId === connection.id}
              enabled={!mcpAvailable ? undefined : connection.enabled}
              icon="git-network-outline"
              onPress={() =>
                mcpAvailable
                  ? openEditor(connection)
                  : removeStoredConnection(connection)
              }
              onToggle={
                !mcpAvailable
                  ? undefined
                  : (value) => void toggleConnection(connection, value)
              }
              palette={palette}
              title={connection.name}
              toggleLabel={t(
                connection.enabled
                  ? "connections.mcp.disableService"
                  : "connections.mcp.enableService",
                { name: connection.name },
              )}
            />
          );
        }}
        renderSectionHeader={({ section }) => (
          <SectionLabel palette={palette}>{section.title}</SectionLabel>
        )}
        sections={sections}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  emptyContent: { flexGrow: 1 },
});
