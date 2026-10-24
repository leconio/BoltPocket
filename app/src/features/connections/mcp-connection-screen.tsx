import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ApiCredentialAuthentication } from "@/application/ports/credential-vault";
import { authorizeMcpOAuthWithAccountRecovery } from "@/application/mcp-oauth-account-recovery";
import { isAccountAuthenticationRejectedAfterSignInError } from "@/application/account-authentication-recovery";
import { isAccountAuthenticationRequiredError } from "@/application/ports/authentication";
import type {
  McpConnection,
  McpConnectionAuthentication,
} from "@/application/ports/mcp-connections";
import { LoadingIndicator } from "@/components/loading-indicator";
import {
  loadComplianceConfig,
  thirdPartyMcpEnabled,
} from "@/config/compliance";
import { AppIcon, type IconName } from "@/components/app-icon";
import { LabeledTextField as Field } from "@/components/labeled-text-field";
import {
  ListRow,
  PageEmptyState,
  Pill,
  ScreenHeader,
  SectionLabel,
} from "@/components/ui";
import {
  mcpAuthenticationChoice,
  mcpToolPolicyPreset,
  suggestedMcpConnectionName,
  type McpAuthenticationChoice,
  type McpToolPolicyPreset,
} from "@/features/mcp/mcp-connection-form";
import { authenticationErrorMessageKey } from "@/features/auth/authentication-error-message";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import { isAuthenticationError } from "@/infrastructure/auth/casdoor-authentication";
import { useAuthenticationActions } from "@/providers/authentication-provider";
import {
  useAppActions,
  useSessionStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

type McpConnectionPrefill = Readonly<{
  authentication: McpAuthenticationChoice;
  credentialLabel?: string;
  name: string;
  parameterName?: string;
  serverUrl: string;
  tokenPlacement?: "bearer" | "header" | "query";
}>;

type NewHeaderCredential = Readonly<{
  headerName: string;
  id: string;
  token: string;
}>;

const MAX_MCP_CREDENTIAL_HEADERS = 8;
const MCP_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
function initialHeaderCredentials(prefill?: McpConnectionPrefill) {
  return [
    {
      id: "header-1",
      headerName:
        prefill?.tokenPlacement === "header" && prefill.parameterName
          ? prefill.parameterName
          : "X-API-Key",
      token: "",
    },
  ] satisfies NewHeaderCredential[];
}

function connectionHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function sameOrigin(left: string | undefined, right: string) {
  if (!left) return false;
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function parsedLines(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]/gu)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function probeResult(value: unknown, invalidResultMessage: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { count: 0, error: invalidResultMessage };
  }
  const result = value as Record<string, unknown>;
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const first = errors[0];
  const error =
    first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>).error
      : undefined;
  return {
    count:
      typeof result.total === "number" && Number.isFinite(result.total)
        ? result.total
        : 0,
    error: typeof error === "string" ? error : undefined,
  };
}

function ChoiceCard({
  detail,
  icon,
  onPress,
  selected,
  title,
}: {
  detail: string;
  icon: IconName;
  onPress: () => void;
  selected: boolean;
  title: string;
}) {
  const palette = useAppPalette();
  return (
    <Pressable
      accessibilityHint={detail}
      accessibilityLabel={title}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? palette.accentSoft : palette.surface,
          borderColor: selected ? palette.accent : palette.border,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View
        style={[
          styles.choiceIcon,
          {
            backgroundColor: selected
              ? palette.background
              : palette.codeSurface,
          },
        ]}
      >
        <AppIcon
          color={selected ? palette.accent : palette.textSecondary}
          name={icon}
          size={19}
        />
      </View>
      <View style={styles.choiceCopy}>
        <Text style={[styles.choiceTitle, { color: palette.text }]}>
          {title}
        </Text>
        <Text style={[styles.choiceDetail, { color: palette.textSecondary }]}>
          {detail}
        </Text>
      </View>
      <AppIcon
        color={selected ? palette.accent : palette.textTertiary}
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={21}
      />
    </Pressable>
  );
}

function McpConnectionEditor({
  connection,
  prefill,
}: {
  connection: McpConnection | null;
  prefill?: McpConnectionPrefill;
}) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const {
    authorizeMcpOAuth,
    createCredential,
    createMcpConnection,
    probeMcpConnection,
    removeCredential,
    removeMcpConnection,
    updateMcpConnection,
  } = useAppActions();
  const { signIn } = useAuthenticationActions();
  const credentialVaultItems = useSessionStateSelector(
    (session) => session.credentialVaultItems,
  );
  const [name, setName] = useState(connection?.name ?? prefill?.name ?? "");
  const [serverUrl, setServerUrl] = useState(
    connection?.serverUrl ?? prefill?.serverUrl ?? "",
  );
  const [mode, setMode] = useState<McpAuthenticationChoice>(
    connection
      ? mcpAuthenticationChoice(connection)
      : (prefill?.authentication ?? "oauth"),
  );
  const [selectedCredentialIds, setSelectedCredentialIds] = useState(
    connection?.authentication.kind === "vault-token"
      ? [...connection.authentication.credentialIds]
      : [],
  );
  const [useNewToken, setUseNewToken] = useState(
    connection?.authentication.kind !== "vault-token",
  );
  const [newToken, setNewToken] = useState("");
  const [newTokenAuthentication, setNewTokenAuthentication] =
    useState<ApiCredentialAuthentication>(
      prefill?.tokenPlacement === "header" ? "header" : "bearer",
    );
  const [newHeaderCredentials, setNewHeaderCredentials] = useState(
    initialHeaderCredentials(prefill),
  );
  const [queryParameterName] = useState(
    connection?.authentication.kind === "vault-token"
      ? connection.authentication.queryParameterName
      : prefill?.tokenPlacement === "query"
        ? prefill.parameterName
        : undefined,
  );
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [policyPreset, setPolicyPreset] = useState<McpToolPolicyPreset>(
    mcpToolPolicyPreset(connection),
  );
  const [approvalPatterns, setApprovalPatterns] = useState(
    connection?.approveTools?.filter((pattern) => pattern !== "*").join("\n") ??
      "",
  );
  const [allowedTools, setAllowedTools] = useState(
    connection?.allowedToolNames?.join("\n") ?? "",
  );
  const [trustToolAnnotations, setTrustToolAnnotations] = useState(
    connection?.trustToolAnnotations ?? true,
  );
  const [advancedVisible, setAdvancedVisible] = useState(
    mcpToolPolicyPreset(connection) === "custom",
  );
  const [busy, setBusy] = useState(false);

  const matchingTokenCandidates = useMemo(
    () =>
      credentialVaultItems
        .filter(
          (item) =>
            item.kind === "api-token" &&
            item.agentAccess === "internal-only" &&
            sameOrigin(item.endpoint, serverUrl),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [credentialVaultItems, serverUrl],
  );
  const selectedCredentials = selectedCredentialIds
    .map((credentialId) =>
      matchingTokenCandidates.find((item) => item.id === credentialId),
    )
    .filter((item) => item !== undefined);
  const suggestedName = suggestedMcpConnectionName(serverUrl);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/mcp");
  };

  const finish = (title: string, message: string) => {
    Alert.alert(title, message, [{ text: t("connections.mcp.done") }]);
  };

  const selectMode = (value: McpAuthenticationChoice) => {
    setMode(value);
    if (value === "token" && matchingTokenCandidates.length) {
      setUseNewToken(false);
      setSelectedCredentialIds((current) =>
        current.length ? current : [matchingTokenCandidates[0]!.id],
      );
    }
  };

  const setHeaderCredential = (
    id: string,
    key: "headerName" | "token",
    value: string,
  ) => {
    setNewHeaderCredentials((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, [key]: value } : entry,
      ),
    );
  };

  const addHeaderCredential = () => {
    setNewHeaderCredentials((current) => {
      if (current.length >= MAX_MCP_CREDENTIAL_HEADERS) return current;
      const nextId =
        Math.max(
          0,
          ...current.map(
            (entry) => Number(entry.id.replace(/^header-/u, "")) || 0,
          ),
        ) + 1;
      return [
        ...current,
        { id: `header-${nextId}`, headerName: "", token: "" },
      ];
    });
  };

  const removeHeaderCredential = (id: string) => {
    setNewHeaderCredentials((current) =>
      current.length === 1
        ? current
        : current.filter((entry) => entry.id !== id),
    );
  };

  const selectSavedCredential = (
    item: (typeof matchingTokenCandidates)[number],
  ) => {
    if (queryParameterName || item.apiAuthentication !== "header") {
      setSelectedCredentialIds([item.id]);
      return;
    }
    setSelectedCredentialIds((current) => {
      const availableIds = current.filter((credentialId) =>
        matchingTokenCandidates.some(
          (candidate) => candidate.id === credentialId,
        ),
      );
      const selectedItems = availableIds
        .map((credentialId) =>
          matchingTokenCandidates.find(
            (candidate) => candidate.id === credentialId,
          ),
        )
        .filter((candidate) => candidate !== undefined);
      if (
        selectedItems.some(
          (candidate) => candidate.apiAuthentication !== "header",
        )
      ) {
        return [item.id];
      }
      if (current.includes(item.id)) {
        return availableIds.length > 1
          ? availableIds.filter((credentialId) => credentialId !== item.id)
          : availableIds;
      }
      return availableIds.length >= MAX_MCP_CREDENTIAL_HEADERS
        ? availableIds
        : [...availableIds, item.id];
    });
  };

  const save = async (forceReconnectOAuth = false) => {
    if (busy) return;
    setBusy(true);
    const createdCredentialIds: string[] = [];
    let connectionPersisted = false;
    try {
      const normalizedUrl = new URL(serverUrl.trim()).toString();
      let authentication: McpConnectionAuthentication;
      if (mode === "none") {
        authentication = { kind: "none" };
      } else if (mode === "oauth") {
        if (
          connection?.authentication.kind === "oauth" &&
          !forceReconnectOAuth &&
          new URL(connection.serverUrl).toString() === normalizedUrl
        ) {
          authentication = connection.authentication;
        } else {
          const authorization = await authorizeMcpOAuthWithAccountRecovery({
            authorize: () => authorizeMcpOAuth(normalizedUrl),
            signIn,
          });
          if (!authorization) return;
          authentication = {
            kind: "oauth",
            authorizationId: authorization.authorizationId,
          };
        }
      } else if (useNewToken || !selectedCredentials.length) {
        const resolvedName = name.trim() || suggestedName;
        const entries =
          newTokenAuthentication === "header" && !queryParameterName
            ? newHeaderCredentials.map((entry) => ({
                headerName: entry.headerName.trim(),
                token: entry.token,
              }))
            : [{ headerName: undefined, token: newToken }];
        if (entries.some((entry) => !entry.token)) {
          throw new Error(t("connections.mcp.tokenRequired"));
        }
        const normalizedHeaderNames = entries
          .map((entry) => entry.headerName?.toLowerCase())
          .filter((headerName) => headerName !== undefined);
        if (
          normalizedHeaderNames.some(
            (headerName) => !MCP_HEADER_NAME.test(headerName),
          )
        ) {
          throw new Error(t("connections.mcp.headerNameInvalid"));
        }
        if (
          new Set(normalizedHeaderNames).size !== normalizedHeaderNames.length
        ) {
          throw new Error(t("connections.mcp.headerNameDuplicate"));
        }
        const credentials = [];
        for (const [index, entry] of entries.entries()) {
          const credential = await createCredential({
            label:
              entry.headerName ??
              `${resolvedName} ${entries.length > 1 ? index + 1 : ""} Token`.replace(
                "  ",
                " ",
              ),
            kind: "api-token",
            service: resolvedName,
            endpoint: normalizedUrl,
            apiAuthentication: newTokenAuthentication,
            ...(entry.headerName ? { apiHeaderName: entry.headerName } : {}),
            agentAccess: "internal-only",
            projectIds: [],
            source: "manual",
            secret: { kind: "api-token", token: entry.token },
          });
          credentials.push(credential);
          createdCredentialIds.push(credential.id);
        }
        authentication = {
          kind: "vault-token",
          credentialIds: credentials.map((credential) => credential.id),
          ...(queryParameterName ? { queryParameterName } : {}),
        };
      } else {
        if (selectedCredentials.length !== selectedCredentialIds.length) {
          throw new Error(t("connections.mcp.savedTokenUnavailable"));
        }
        if (
          selectedCredentials.some(
            (credential) => !sameOrigin(credential.endpoint, normalizedUrl),
          )
        ) {
          throw new Error(t("connections.mcp.tokenOriginMismatch"));
        }
        const selectedHeaderNames = selectedCredentials
          .filter((credential) => credential.apiAuthentication === "header")
          .map((credential) => credential.apiHeaderName?.trim());
        if (
          (selectedCredentials.length > 1 &&
            selectedHeaderNames.length !== selectedCredentials.length) ||
          selectedHeaderNames.some(
            (headerName) => !headerName || !MCP_HEADER_NAME.test(headerName),
          )
        ) {
          throw new Error(t("connections.mcp.headerNameInvalid"));
        }
        if (
          new Set(
            selectedHeaderNames.map((headerName) => headerName!.toLowerCase()),
          ).size !== selectedHeaderNames.length
        ) {
          throw new Error(t("connections.mcp.headerNameDuplicate"));
        }
        authentication = {
          kind: "vault-token",
          credentialIds: selectedCredentials.map((credential) => credential.id),
          ...(queryParameterName ? { queryParameterName } : {}),
        };
      }

      const customApprovalPatterns = parsedLines(approvalPatterns);
      const customAllowedTools = parsedLines(allowedTools);
      const input = {
        projectId: null,
        name: name.trim() || suggestedName,
        serverUrl: normalizedUrl,
        authentication,
        enabled,
        trustToolAnnotations:
          policyPreset === "standard"
            ? true
            : policyPreset === "ask-all"
              ? false
              : trustToolAnnotations,
        ...(policyPreset === "ask-all"
          ? { approveTools: ["*"] }
          : policyPreset === "custom" && customApprovalPatterns.length
            ? { approveTools: customApprovalPatterns }
            : {}),
        ...(policyPreset === "custom" && customAllowedTools.length
          ? { allowedToolNames: customAllowedTools }
          : {}),
      };
      const saved = connection
        ? await updateMcpConnection(connection.id, input)
        : await createMcpConnection(input);
      connectionPersisted = true;
      if (!connection) router.setParams({ connectionId: saved.id });
      if (!saved.enabled) {
        finish(
          t("connections.mcp.savedDisabled"),
          t("connections.mcp.savedDisabledDetail"),
        );
        return;
      }
      const probe = probeResult(
        await probeMcpConnection(saved.id),
        t("connections.mcp.invalidResult"),
      );
      if (probe.error) {
        finish(
          t("connections.mcp.savedNeedsAttention"),
          t("connections.mcp.savedNeedsAttentionDetail", {
            error: probe.error,
          }),
        );
      } else {
        finish(
          t("connections.mcp.connected"),
          t("connections.mcp.connectedDetail", { count: probe.count }),
        );
      }
    } catch (error) {
      if (!connectionPersisted && createdCredentialIds.length) {
        await Promise.allSettled(
          createdCredentialIds.map((credentialId) =>
            removeCredential(credentialId),
          ),
        );
      }
      if (isAccountAuthenticationRejectedAfterSignInError(error)) {
        Alert.alert(t("auth.login.title"), t("auth.error.sessionRejected"));
      } else if (isAccountAuthenticationRequiredError(error)) {
        Alert.alert(t("auth.login.title"), t("auth.error.sessionExpired"));
      } else if (isAuthenticationError(error)) {
        Alert.alert(
          t("auth.login.title"),
          t(authenticationErrorMessageKey(error)),
        );
      } else {
        Alert.alert(
          t("connections.mcp.saveFailed"),
          localizedErrorMessage(error, t("connections.mcp.saveFailedDetail")),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!connection || busy) return;
    Alert.alert(
      t("connections.mcp.remove"),
      t("connections.mcp.removeDetail"),
      [
        { text: t("connections.mcp.cancel"), style: "cancel" },
        {
          text: t("connections.mcp.remove"),
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void removeMcpConnection(connection.id)
              .then(() => router.dismissTo("/mcp"))
              .catch((error) =>
                Alert.alert(
                  t("connections.mcp.removeFailed"),
                  localizedErrorMessage(
                    error,
                    t("connections.mcp.removeFailedDetail"),
                  ),
                ),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
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
        title={t(connection ? "connections.mcp.edit" : "connections.mcp.add")}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field
            autoCapitalize="none"
            autoCorrect={false}
            hint={t("connections.mcp.urlDetail")}
            keyboardType="url"
            label={t("connections.mcp.url")}
            maxLength={2_048}
            onChangeText={setServerUrl}
            placeholder="https://mcp.example.com/mcp"
            value={serverUrl}
          />

          <SectionLabel palette={palette}>
            {t("connections.mcp.signIn")}
          </SectionLabel>
          <View accessibilityRole="radiogroup" style={styles.choiceGroup}>
            <ChoiceCard
              detail={t("connections.mcp.oauthChoiceDetail")}
              icon="open-outline"
              onPress={() => selectMode("oauth")}
              selected={mode === "oauth"}
              title={t("connections.mcp.oauthChoice")}
            />
            <ChoiceCard
              detail={t("connections.mcp.tokenChoiceDetail")}
              icon="key-outline"
              onPress={() => selectMode("token")}
              selected={mode === "token"}
              title={t("connections.mcp.tokenChoice")}
            />
            <ChoiceCard
              detail={t("connections.mcp.noneChoiceDetail")}
              icon="lock-open-outline"
              onPress={() => selectMode("none")}
              selected={mode === "none"}
              title={t("connections.mcp.authNone")}
            />
          </View>

          {mode === "oauth" && connection?.authentication.kind === "oauth" ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy || !serverUrl.trim()}
              onPress={() => void save(true)}
              style={styles.inlineAction}
            >
              <Ionicons color={palette.accent} name="refresh" size={17} />
              <Text
                style={[styles.inlineActionText, { color: palette.accent }]}
              >
                {t("connections.mcp.oauthReconnect")}
              </Text>
            </Pressable>
          ) : null}

          {mode === "token" ? (
            <View
              style={[
                styles.tokenPanel,
                {
                  backgroundColor: palette.codeSurface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.inlineHint}>
                <Ionicons color={palette.accent} name="lock-closed" size={16} />
                <Text
                  style={[
                    styles.inlineHintText,
                    { color: palette.textSecondary },
                  ]}
                >
                  {t("connections.mcp.newTokenDetail")}
                </Text>
              </View>
              {matchingTokenCandidates.length ? (
                <View style={styles.pillRow}>
                  <Pill
                    onPress={() => setUseNewToken(false)}
                    palette={palette}
                    selected={!useNewToken}
                  >
                    {t("connections.mcp.savedToken")}
                  </Pill>
                  <Pill
                    onPress={() => setUseNewToken(true)}
                    palette={palette}
                    selected={useNewToken}
                  >
                    {t("connections.mcp.authNewToken")}
                  </Pill>
                </View>
              ) : null}
              {!useNewToken && matchingTokenCandidates.length ? (
                <View style={styles.selectionGroup}>
                  {matchingTokenCandidates.map((item) => (
                    <ListRow
                      detail={connectionHost(item.endpoint ?? "")}
                      icon={
                        selectedCredentialIds.includes(item.id)
                          ? "checkmark-circle"
                          : "key-outline"
                      }
                      key={item.id}
                      onPress={() => selectSavedCredential(item)}
                      palette={palette}
                      title={item.label}
                    />
                  ))}
                </View>
              ) : (
                <View style={styles.selectionGroup}>
                  {queryParameterName ? (
                    <Text
                      style={[styles.help, { color: palette.textSecondary }]}
                    >
                      {t("connections.mcp.queryTokenDetail", {
                        parameter: queryParameterName,
                      })}
                    </Text>
                  ) : (
                    <View style={styles.pillRow}>
                      <Pill
                        onPress={() => setNewTokenAuthentication("bearer")}
                        palette={palette}
                        selected={newTokenAuthentication === "bearer"}
                      >
                        Bearer
                      </Pill>
                      <Pill
                        onPress={() => setNewTokenAuthentication("header")}
                        palette={palette}
                        selected={newTokenAuthentication === "header"}
                      >
                        API Key Header
                      </Pill>
                    </View>
                  )}
                  {newTokenAuthentication === "header" &&
                  !queryParameterName ? (
                    <View style={styles.headerList}>
                      {newHeaderCredentials.map((entry, index) => (
                        <View
                          key={entry.id}
                          style={[
                            styles.headerCredential,
                            {
                              backgroundColor: palette.background,
                              borderColor: palette.border,
                            },
                          ]}
                        >
                          <View style={styles.headerCredentialTitleRow}>
                            <Text
                              style={[
                                styles.headerCredentialTitle,
                                { color: palette.textSecondary },
                              ]}
                            >
                              {t("connections.mcp.apiKeyHeaderNumber", {
                                number: index + 1,
                              })}
                            </Text>
                            {newHeaderCredentials.length > 1 ? (
                              <Pressable
                                accessibilityLabel={t(
                                  "connections.mcp.removeApiKeyHeader",
                                )}
                                accessibilityRole="button"
                                hitSlop={8}
                                onPress={() => removeHeaderCredential(entry.id)}
                                style={({ pressed }) =>
                                  pressed && { opacity: 0.55 }
                                }
                              >
                                <Ionicons
                                  color={palette.textTertiary}
                                  name="close-circle"
                                  size={21}
                                />
                              </Pressable>
                            ) : null}
                          </View>
                          <Field
                            autoCapitalize="none"
                            autoCorrect={false}
                            hint={t("connections.mcp.headerNameDetail")}
                            label={t("connections.mcp.headerName")}
                            maxLength={120}
                            onChangeText={(value) =>
                              setHeaderCredential(entry.id, "headerName", value)
                            }
                            value={entry.headerName}
                          />
                          <Field
                            autoCapitalize="none"
                            autoComplete="password"
                            autoCorrect={false}
                            emphasized
                            hint={t("connections.mcp.newTokenDetail")}
                            label={t("connections.mcp.token")}
                            maxLength={64 * 1024}
                            onChangeText={(value) =>
                              setHeaderCredential(entry.id, "token", value)
                            }
                            placeholder={t("connections.mcp.tokenPlaceholder")}
                            secureTextEntry
                            textContentType="password"
                            value={entry.token}
                          />
                        </View>
                      ))}
                      <Pressable
                        accessibilityLabel={t(
                          "connections.mcp.addApiKeyHeader",
                        )}
                        accessibilityRole="button"
                        disabled={
                          newHeaderCredentials.length >=
                          MAX_MCP_CREDENTIAL_HEADERS
                        }
                        onPress={addHeaderCredential}
                        style={({ pressed }) => [
                          styles.addHeaderButton,
                          { borderColor: palette.borderStrong },
                          newHeaderCredentials.length >=
                            MAX_MCP_CREDENTIAL_HEADERS && { opacity: 0.35 },
                          pressed && { opacity: 0.55 },
                        ]}
                      >
                        <Ionicons color={palette.accent} name="add" size={20} />
                        <Text
                          style={[
                            styles.addHeaderButtonText,
                            { color: palette.accent },
                          ]}
                        >
                          {t("connections.mcp.addApiKeyHeader")}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Field
                      autoCapitalize="none"
                      autoComplete="password"
                      autoCorrect={false}
                      emphasized
                      hint={t("connections.mcp.newTokenDetail")}
                      label={
                        prefill?.credentialLabel ?? t("connections.mcp.token")
                      }
                      maxLength={64 * 1024}
                      onChangeText={setNewToken}
                      placeholder={t("connections.mcp.tokenPlaceholder")}
                      secureTextEntry
                      textContentType="password"
                      value={newToken}
                    />
                  )}
                </View>
              )}
            </View>
          ) : null}

          <View style={styles.inlineHint}>
            <Ionicons
              color={palette.accent}
              name="shield-checkmark"
              size={16}
            />
            <Text
              style={[styles.inlineHintText, { color: palette.textSecondary }]}
            >
              {t("connections.mcp.standardSafetyDetail")}
            </Text>
          </View>

          <Pressable
            accessibilityLabel={t("connections.mcp.advanced")}
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedVisible }}
            onPress={() => setAdvancedVisible((value) => !value)}
            style={({ pressed }) => [
              styles.advancedButton,
              { borderColor: palette.border },
              pressed && { opacity: 0.65 },
            ]}
          >
            <Text style={[styles.advancedButtonText, { color: palette.text }]}>
              {t("connections.mcp.advanced")}
            </Text>
            <Ionicons
              color={palette.textSecondary}
              name={advancedVisible ? "chevron-up" : "chevron-down"}
              size={18}
            />
          </Pressable>

          {advancedVisible ? (
            <View style={styles.advancedContent}>
              <Field
                autoCapitalize="none"
                autoCorrect={false}
                hint={t("connections.mcp.nameOptionalDetail")}
                label={t("connections.mcp.nameOptional")}
                maxLength={160}
                onChangeText={setName}
                placeholder={suggestedName}
                value={name}
              />
              <ListRow
                detail={t("connections.mcp.enabledDetail")}
                icon="power-outline"
                onPress={() => setEnabled((value) => !value)}
                palette={palette}
                title={t("connections.mcp.enabled")}
                value={t(
                  enabled
                    ? "connections.mcp.enabledValue"
                    : "connections.mcp.disabledValue",
                )}
              />
              <SectionLabel palette={palette}>
                {t("connections.mcp.toolPolicy")}
              </SectionLabel>
              <View style={styles.pillRow}>
                <Pill
                  onPress={() => setPolicyPreset("standard")}
                  palette={palette}
                  selected={policyPreset === "standard"}
                >
                  {t("connections.mcp.policyStandard")}
                </Pill>
                <Pill
                  onPress={() => setPolicyPreset("ask-all")}
                  palette={palette}
                  selected={policyPreset === "ask-all"}
                >
                  {t("connections.mcp.policyAskAll")}
                </Pill>
                <Pill
                  onPress={() => setPolicyPreset("custom")}
                  palette={palette}
                  selected={policyPreset === "custom"}
                >
                  {t("connections.mcp.policyCustom")}
                </Pill>
              </View>
              <Text style={[styles.help, { color: palette.textSecondary }]}>
                {t(
                  policyPreset === "standard"
                    ? "connections.mcp.policyStandardDetail"
                    : policyPreset === "ask-all"
                      ? "connections.mcp.policyAskAllDetail"
                      : "connections.mcp.policyCustomDetail",
                )}
              </Text>
              {policyPreset === "custom" ? (
                <>
                  <ListRow
                    detail={t("connections.mcp.trustAnnotationsDetail")}
                    icon="shield-checkmark-outline"
                    onPress={() => setTrustToolAnnotations((value) => !value)}
                    palette={palette}
                    title={t("connections.mcp.trustAnnotations")}
                    value={t(
                      trustToolAnnotations
                        ? "connections.mcp.enabledValue"
                        : "connections.mcp.disabledValue",
                    )}
                  />
                  <Field
                    autoCapitalize="none"
                    autoCorrect={false}
                    hint={t("connections.mcp.approvePatternsDetail")}
                    label={t("connections.mcp.approvePatterns")}
                    maxLength={32_000}
                    multiline
                    onChangeText={setApprovalPatterns}
                    placeholder={"publish_*\nmcp-server/delete_*"}
                    value={approvalPatterns}
                  />
                  <Field
                    autoCapitalize="none"
                    autoCorrect={false}
                    hint={t("connections.mcp.allowListDetail")}
                    label={t("connections.mcp.allowList")}
                    maxLength={32_000}
                    multiline
                    onChangeText={setAllowedTools}
                    placeholder={"get_design_context\npublish_component"}
                    value={allowedTools}
                  />
                </>
              ) : null}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={busy || !serverUrl.trim()}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: palette.text },
              (busy || !serverUrl.trim()) && { opacity: 0.35 },
              pressed && { opacity: 0.72 },
            ]}
          >
            <Text
              style={[styles.primaryButtonText, { color: palette.background }]}
            >
              {busy
                ? t("connections.mcp.testing")
                : mode === "oauth" &&
                    connection?.authentication.kind !== "oauth"
                  ? t("connections.mcp.continueWithOAuth")
                  : t("connections.mcp.connectAndTest")}
            </Text>
          </Pressable>

          {connection ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={remove}
              style={({ pressed }) => [
                styles.removeButton,
                { borderColor: palette.danger },
                pressed && { opacity: 0.65 },
              ]}
            >
              <Text
                style={[styles.removeButtonText, { color: palette.danger }]}
              >
                {t("connections.mcp.remove")}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function McpConnectionScreen() {
  const mcpAvailable = thirdPartyMcpEnabled(loadComplianceConfig());
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{
    authentication?: string;
    connectionId?: string;
    credentialLabel?: string;
    parameterName?: string;
    presetName?: string;
    serverUrl?: string;
    tokenPlacement?: string;
  }>();
  const { connectionId } = params;
  const mcpConnectionItems = useSessionStateSelector(
    (session) => session.mcpConnectionItems,
  );
  const mcpConnectionsLoading = useSessionStateSelector(
    (session) => session.mcpConnectionsLoading,
  );
  const connection = connectionId
    ? (mcpConnectionItems.find((item) => item.id === connectionId) ?? null)
    : null;
  const prefill = connectionId ? undefined : parsedPrefill(params);

  if (!mcpAvailable) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <ScreenHeader
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/mcp")
          }
          palette={palette}
          title={t("connections.mcp.unavailable")}
        />
        <PageEmptyState
          description={t("connections.mcp.regionUnavailableDetail")}
          palette={palette}
        />
      </SafeAreaView>
    );
  }

  if (mcpConnectionsLoading) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <LoadingIndicator
          accessibilityLabel={t("connections.mcp.loading")}
          palette={palette}
          style={styles.flex}
          variant="screen"
        />
      </SafeAreaView>
    );
  }
  if (connectionId && !connection) {
    return (
      <SafeAreaView
        edges={["top"]}
        mode="margin"
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <ScreenHeader
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/mcp")
          }
          palette={palette}
          title={t("connections.mcp.unavailable")}
        />
        <PageEmptyState
          description={t("connections.mcp.unavailableDetail")}
          palette={palette}
          tone="error"
        />
      </SafeAreaView>
    );
  }
  return (
    <McpConnectionEditor
      connection={connection}
      key={`${connection?.id ?? "new"}:${connection?.updatedAt ?? prefill?.serverUrl ?? "new"}`}
      prefill={prefill}
    />
  );
}

function parsedPrefill(value: {
  authentication?: string;
  credentialLabel?: string;
  parameterName?: string;
  presetName?: string;
  serverUrl?: string;
  tokenPlacement?: string;
}): McpConnectionPrefill | undefined {
  if (
    !safeRouteText(value.presetName, 160) ||
    !safeRouteText(value.serverUrl, 2_048) ||
    !["none", "oauth", "token"].includes(value.authentication ?? "")
  ) {
    return undefined;
  }
  const authentication = value.authentication as McpAuthenticationChoice;
  const tokenPlacement = ["bearer", "header", "query"].includes(
    value.tokenPlacement ?? "",
  )
    ? (value.tokenPlacement as "bearer" | "header" | "query")
    : undefined;
  const parameterName = safeRouteText(value.parameterName, 64)
    ? value.parameterName
    : undefined;
  if (
    authentication === "token" &&
    (!tokenPlacement ||
      (tokenPlacement !== "bearer" &&
        !/^[A-Za-z][A-Za-z0-9._~-]{0,63}$/u.test(parameterName ?? "")))
  ) {
    return undefined;
  }
  return {
    authentication,
    name: value.presetName,
    serverUrl: value.serverUrl,
    ...(safeRouteText(value.credentialLabel, 160)
      ? { credentialLabel: value.credentialLabel }
      : {}),
    ...(parameterName ? { parameterName } : {}),
    ...(tokenPlacement ? { tokenPlacement } : {}),
  };
}

function safeRouteText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  help: { fontSize: 13, lineHeight: 19 },
  choiceGroup: { gap: spacing.xs },
  choice: {
    alignItems: "flex-start",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 72,
    padding: spacing.sm,
  },
  choiceIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  choiceCopy: { flex: 1, gap: 2 },
  choiceTitle: { fontSize: 14, fontWeight: "700" },
  choiceDetail: { fontSize: 12, lineHeight: 17 },
  tokenPanel: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  inlineHint: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  inlineHintText: { flex: 1, fontSize: 12, lineHeight: 17 },
  inlineAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
  },
  inlineActionText: { fontSize: 13, fontWeight: "700" },
  selectionGroup: { gap: spacing.sm },
  headerList: { gap: spacing.sm },
  headerCredential: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  headerCredentialTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerCredentialTitle: { fontSize: 12, fontWeight: "700" },
  addHeaderButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  addHeaderButtonText: { fontSize: 13, fontWeight: "700" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  advancedButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  advancedButtonText: { fontSize: 14, fontWeight: "600" },
  advancedContent: { gap: spacing.sm },
  primaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: { fontSize: 15, fontWeight: "700" },
  removeButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 48,
  },
  removeButtonText: { fontSize: 15, fontWeight: "600" },
  missing: { fontSize: 14, lineHeight: 21, padding: spacing.lg },
});
