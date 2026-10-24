import { useLocalSearchParams, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import { SshConnectionTestError } from "@/application/ports/ssh-command-sessions";
import type {
  ApiCredentialAuthentication,
  CredentialKind,
  CredentialVaultItem,
  SshCredentialAuthentication,
} from "@/application/ports/credential-vault";
import type {
  SshCredentials,
  SshHostKey,
} from "@/application/ports/ssh-command-sessions";
import {
  AppSwitch,
  IconButton,
  ListRow,
  Pill,
  ScreenHeader,
  SectionLabel,
} from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import {
  createAppStateFieldsSelector,
  useAppActions,
  useAppStateSelector,
  useSessionStateSelector,
} from "@/providers/app-provider";
import {
  formatSshCredentialEndpoint,
  parseSshCredentialEndpoint,
  sameSshHostKey,
} from "@/infrastructure/shell/ssh-credential-endpoint";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const selectCredentialEditorState = createAppStateFieldsSelector("projects");

const kindOptions: readonly {
  kind: CredentialKind;
  labelKey: MessageKey;
  icon: "key-outline" | "document-lock-outline" | "code-slash-outline";
}[] = [
  {
    kind: "password",
    labelKey: "settings.vault.field.password",
    icon: "key-outline",
  },
  {
    kind: "ssh",
    labelKey: "settings.vault.field.sshCredential",
    icon: "document-lock-outline",
  },
  {
    kind: "api-token",
    labelKey: "settings.vault.field.apiToken",
    icon: "code-slash-outline",
  },
  {
    kind: "secret-text",
    labelKey: "settings.vault.field.other",
    icon: "key-outline",
  },
];

type Draft = {
  label: string;
  kind: CredentialKind;
  service: string;
  username: string;
  endpoint: string;
  sshHost: string;
  sshPort: string;
  sshRoot?: string;
  sshAuthentication: SshCredentialAuthentication;
  sshHostKey?: SshHostKey;
  apiAuthentication: ApiCredentialAuthentication;
  apiHeaderName: string;
  secret: string;
  publicKey: string;
  passphrase: string;
  projectIds: string[];
};

function emptyDraft(kind: CredentialKind = "password"): Draft {
  return {
    label: "",
    kind,
    service: "",
    username: "",
    endpoint: "",
    sshHost: "",
    sshPort: "22",
    sshRoot: undefined,
    sshAuthentication: "password",
    sshHostKey: undefined,
    apiAuthentication: "bearer",
    apiHeaderName: "X-API-Key",
    secret: "",
    publicKey: "",
    passphrase: "",
    projectIds: [],
  };
}

function draftFor(item: CredentialVaultItem): Draft {
  let sshHost = "";
  let sshPort = "22";
  let sshRoot: string | undefined;
  if (item.kind === "ssh" && item.endpoint) {
    try {
      const endpoint = parseSshCredentialEndpoint(item.endpoint);
      sshHost = endpoint.host;
      sshPort = String(endpoint.port);
      sshRoot = endpoint.root;
    } catch {
      sshHost = item.endpoint;
    }
  }
  return {
    label: item.label,
    kind: item.kind,
    service: item.service ?? "",
    username: item.username ?? "",
    endpoint: item.kind === "ssh" ? "" : (item.endpoint ?? ""),
    sshHost,
    sshPort,
    sshRoot,
    sshAuthentication: item.sshAuthentication ?? "password",
    sshHostKey: item.sshHostKey,
    apiAuthentication: item.apiAuthentication ?? "bearer",
    apiHeaderName: item.apiHeaderName ?? "X-API-Key",
    secret: "",
    publicKey: "",
    passphrase: "",
    projectIds: [...item.projectIds],
  };
}

function credentialKindFromParam(value: string | undefined): CredentialKind {
  return kindOptions.some((option) => option.kind === value)
    ? (value as CredentialKind)
    : "password";
}

function secretFieldKey(draft: Draft): MessageKey {
  if (draft.kind === "ssh" && draft.sshAuthentication === "private-key") {
    return "settings.vault.field.privateKey";
  }
  if (
    draft.kind === "password" ||
    (draft.kind === "ssh" && draft.sshAuthentication === "password")
  ) {
    return "settings.vault.field.password";
  }
  if (draft.kind === "api-token") return "settings.vault.field.apiToken";
  return "settings.vault.field.secretContent";
}

function sshCredentialsForDraft(draft: Draft): SshCredentials | undefined {
  if (draft.kind !== "ssh" || !draft.secret) return undefined;
  if (draft.sshAuthentication === "password") {
    return { kind: "password", password: draft.secret };
  }
  return {
    kind: "private-key",
    privateKey: draft.secret,
    ...(draft.publicKey ? { publicKey: draft.publicKey } : {}),
    ...(draft.passphrase ? { passphrase: draft.passphrase } : {}),
  };
}

function sshConnectionTestFailureKey(error: unknown): MessageKey {
  if (!(error instanceof SshConnectionTestError)) {
    return "settings.vault.testConnectionFailedDetail";
  }
  switch (error.code) {
    case "authentication_failed":
      return "settings.vault.testConnectionAuthenticationFailed";
    case "host_key_failed":
      return "settings.vault.testConnectionHostKeyFailed";
    case "timeout":
      return "settings.vault.testConnectionTimeout";
    case "unavailable":
      return "settings.vault.testConnectionUnavailable";
    default:
      return "settings.vault.testConnectionFailedDetail";
  }
}

export function CredentialVaultScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { projectId: projectIdParam } = useLocalSearchParams<{
    projectId?: string;
  }>();
  const initialProjectId =
    typeof projectIdParam === "string" ? projectIdParam : null;
  const credentialVaultItems = useSessionStateSelector(
    (session) => session.credentialVaultItems,
  );
  const credentialVaultLoading = useSessionStateSelector(
    (session) => session.credentialVaultLoading,
  );

  const sortedItems = useMemo(
    () =>
      [...credentialVaultItems].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    [credentialVaultItems],
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const openNew = () => {
    router.push({
      pathname: "/settings/vault-editor",
      params: initialProjectId ? { projectId: initialProjectId } : {},
    });
  };

  const openItem = (item: CredentialVaultItem) => {
    router.push({
      pathname: "/settings/vault-editor",
      params: {
        credentialId: item.id,
        ...(initialProjectId ? { projectId: initialProjectId } : {}),
      },
    });
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
        right={
          <IconButton
            icon="add"
            label={t("settings.vault.add")}
            onPress={openNew}
            palette={palette}
          />
        }
        title={t("settings.vault.title")}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel palette={palette}>
          {t("settings.vault.saved")}
        </SectionLabel>
        {credentialVaultLoading ? (
          <LoadingIndicator
            accessibilityLabel={t("settings.vault.reading")}
            palette={palette}
            variant="list"
          />
        ) : sortedItems.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>
              {t("settings.vault.empty")}
            </Text>
            <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
              {t("settings.vault.emptyDetail")}
            </Text>
          </View>
        ) : (
          sortedItems.map((item) => {
            const kind = kindOptions.find(
              (option) => option.kind === item.kind,
            )!;
            return (
              <ListRow
                icon={kind.icon}
                key={item.id}
                onPress={() => openItem(item)}
                palette={palette}
                title={item.label}
                value={t(kind.labelKey)}
              />
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export function CredentialVaultEditorScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const {
    credentialId: credentialIdParam,
    projectId: projectIdParam,
    kind: kindParam,
  } = useLocalSearchParams<{
    credentialId?: string;
    projectId?: string;
    kind?: string;
  }>();
  const credentialId =
    typeof credentialIdParam === "string" ? credentialIdParam : null;
  const projectId = typeof projectIdParam === "string" ? projectIdParam : null;
  const state = useAppStateSelector(selectCredentialEditorState);
  const {
    createCredential,
    probeSshHostKey,
    testSshConnection,
    updateCredential,
    removeCredential,
  } = useAppActions();
  const credentialVaultItems = useSessionStateSelector(
    (session) => session.credentialVaultItems,
  );
  const credentialVaultLoading = useSessionStateSelector(
    (session) => session.credentialVaultLoading,
  );
  const editing = credentialId
    ? (credentialVaultItems.find((item) => item.id === credentialId) ?? null)
    : null;
  const draftKey = credentialId ?? "new";
  const defaultDraft = editing
    ? draftFor(editing)
    : {
        ...emptyDraft(credentialKindFromParam(kindParam)),
        projectIds:
          projectId && Boolean(state.projects[projectId]) ? [projectId] : [],
      };
  const [draftState, setDraftState] = useState<{
    key: string;
    value: Draft;
  } | null>(null);
  const draft = draftState?.key === draftKey ? draftState.value : defaultDraft;
  const setDraft = (update: (value: Draft) => Draft) => {
    setDraftState((current) => ({
      key: draftKey,
      value: update(current?.key === draftKey ? current.value : defaultDraft),
    }));
  };
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else {
      router.replace({
        pathname: "/settings/vault",
        params: projectId ? { projectId } : {},
      });
    }
  };
  const ready = credentialId ? Boolean(editing) : true;
  const requiresReplacement = Boolean(
    editing &&
    (editing.kind !== draft.kind ||
      (editing.kind === "ssh" &&
        draft.kind === "ssh" &&
        editing.sshAuthentication !== draft.sshAuthentication)),
  );
  const needsSecret = !editing || requiresReplacement;
  const apiMetadataReady =
    draft.kind !== "api-token" ||
    draft.apiAuthentication !== "header" ||
    Boolean(draft.apiHeaderName.trim());
  const sshMetadataReady =
    draft.kind !== "ssh" ||
    Boolean(
      draft.sshHost.trim() && draft.sshPort.trim() && draft.username.trim(),
    );
  const canSave = Boolean(
    draft.label.trim() &&
    apiMetadataReady &&
    sshMetadataReady &&
    (!needsSecret || draft.secret.length > 0),
  );
  const draftSshCredentials = sshCredentialsForDraft(draft);
  const savedCredentialProjectId =
    editing?.kind === "ssh" && !requiresReplacement
      ? editing.projectIds[0]
      : undefined;
  const canTestSsh = Boolean(
    draft.kind === "ssh" &&
    sshMetadataReady &&
    (draftSshCredentials || savedCredentialProjectId),
  );

  const confirmSshHostKey = async (
    endpoint: ReturnType<typeof parseSshCredentialEndpoint>,
    probed: SshHostKey,
    intent: "save" | "test",
  ) => {
    if (sameSshHostKey(draft.sshHostKey, probed)) return true;
    return new Promise<boolean>((resolve) => {
      const changed = Boolean(draft.sshHostKey);
      Alert.alert(
        t(
          changed
            ? "settings.vault.fingerprintChanged"
            : "settings.vault.confirmHost",
        ),
        `${draft.username.trim()}@${endpoint.host}:${endpoint.port}\n${probed.algorithm} ${probed.fingerprint}`,
        [
          {
            text: t("settings.common.cancel"),
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: t(
              intent === "test"
                ? changed
                  ? "settings.vault.trustAndTest"
                  : "settings.vault.confirmTest"
                : changed
                  ? "settings.vault.trustFingerprint"
                  : "settings.vault.confirmSave",
            ),
            style: changed ? "destructive" : "default",
            onPress: () => resolve(true),
          },
        ],
        { cancelable: false },
      );
    });
  };

  const testConnection = async () => {
    if (!canTestSsh || saving || testing || draft.kind !== "ssh") return;
    setTesting(true);
    setError(null);
    try {
      const endpoint = parseSshCredentialEndpoint(
        formatSshCredentialEndpoint(
          draft.sshHost,
          draft.sshPort,
          draft.sshRoot,
        ),
      );
      const probed = await probeSshHostKey(endpoint);
      if (!(await confirmSshHostKey(endpoint, probed, "test"))) return;
      const result = await testSshConnection({
        ...endpoint,
        username: draft.username,
        expectedHostKey: probed,
        ...(draftSshCredentials
          ? { credentials: draftSshCredentials }
          : {
              credentialId: editing!.id,
              projectId: savedCredentialProjectId!,
            }),
      });
      setDraft((value) => ({ ...value, sshHostKey: probed }));
      Alert.alert(
        t("settings.vault.testConnectionSucceeded"),
        t("settings.vault.testConnectionSucceededDetail", result),
      );
    } catch (caught) {
      Alert.alert(
        t("settings.vault.testConnectionFailed"),
        t(sshConnectionTestFailureKey(caught)),
      );
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave || saving || testing) return;
    setSaving(true);
    setError(null);
    try {
      let sshHostKey = draft.sshHostKey;
      let endpointValue = draft.endpoint;
      if (draft.kind === "ssh") {
        endpointValue = formatSshCredentialEndpoint(
          draft.sshHost,
          draft.sshPort,
          draft.sshRoot,
        );
        const endpoint = parseSshCredentialEndpoint(endpointValue);
        const probed = await probeSshHostKey(endpoint);
        if (!(await confirmSshHostKey(endpoint, probed, "save"))) return;
        sshHostKey = probed;
      }
      const secret = draft.secret
        ? draft.kind === "password"
          ? ({ kind: "password", password: draft.secret } as const)
          : draft.kind === "ssh"
            ? draft.sshAuthentication === "password"
              ? ({
                  kind: "ssh",
                  authentication: "password",
                  password: draft.secret,
                } as const)
              : ({
                  kind: "ssh",
                  authentication: "private-key",
                  privateKey: draft.secret,
                  ...(draft.publicKey ? { publicKey: draft.publicKey } : {}),
                  ...(draft.passphrase ? { passphrase: draft.passphrase } : {}),
                } as const)
            : draft.kind === "api-token"
              ? ({ kind: "api-token", token: draft.secret } as const)
              : ({ kind: "secret-text", value: draft.secret } as const)
        : undefined;
      const metadata = {
        label: draft.label,
        kind: draft.kind,
        service: draft.service,
        username: draft.username,
        endpoint: endpointValue,
        sshAuthentication: draft.sshAuthentication,
        sshHostKey,
        apiAuthentication: draft.apiAuthentication,
        apiHeaderName: draft.apiHeaderName,
        ...(editing?.agentAccess ? { agentAccess: editing.agentAccess } : {}),
        projectIds: draft.projectIds,
      };
      if (editing) {
        await updateCredential(editing.id, {
          ...metadata,
          ...(secret ? { secret } : {}),
        });
      } else {
        await createCredential({
          ...metadata,
          source: "manual",
          secret: secret!,
        });
      }
      goBack();
    } catch (caught) {
      setError(localizedErrorMessage(caught, t("settings.vault.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = () => {
    if (!editing || saving || testing) return;
    Alert.alert(
      t("settings.vault.deleteTitle"),
      t("settings.vault.deleteConfirm"),
      [
        { text: t("settings.common.cancel"), style: "cancel" },
        {
          text: t("settings.common.delete"),
          style: "destructive",
          onPress: () => {
            setSaving(true);
            void removeCredential(editing.id)
              .then(goBack)
              .catch((caught: unknown) =>
                setError(
                  localizedErrorMessage(
                    caught,
                    t("settings.vault.deleteFailed"),
                  ),
                ),
              )
              .finally(() => setSaving(false));
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
        title={t(credentialId ? "settings.vault.edit" : "settings.vault.add")}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.safeArea}
      >
        {!ready ? (
          credentialVaultLoading ? (
            <LoadingIndicator
              accessibilityLabel={t("settings.vault.readingRecord")}
              palette={palette}
              style={styles.editorLoading}
              variant="screen"
            />
          ) : (
            <View style={styles.editorLoading}>
              <Text
                style={[styles.emptyText, { color: palette.textSecondary }]}
              >
                {t("settings.vault.recordMissing")}
              </Text>
            </View>
          )
        ) : (
          <ScrollView
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.form}>
              <Field
                label={t("settings.vault.field.name")}
                onChangeText={(label) =>
                  setDraft((value) => ({ ...value, label }))
                }
                palette={palette}
                placeholder={t("settings.vault.nameExample")}
                value={draft.label}
              />

              <Text style={[styles.label, { color: palette.text }]}>
                {t("settings.vault.type")}
              </Text>
              <View style={styles.kindRow}>
                {kindOptions.map((option) => (
                  <Pill
                    key={option.kind}
                    onPress={() =>
                      setDraft((value) =>
                        value.kind === option.kind
                          ? value
                          : {
                              ...value,
                              kind: option.kind,
                              secret: "",
                              publicKey: "",
                              passphrase: "",
                            },
                      )
                    }
                    palette={palette}
                    selected={draft.kind === option.kind}
                  >
                    {t(option.labelKey)}
                  </Pill>
                ))}
              </View>

              {draft.kind === "password" || draft.kind === "api-token" ? (
                <Field
                  label={
                    draft.kind === "password"
                      ? t("settings.vault.serviceOrSiteOptional")
                      : t("settings.vault.serviceOptional")
                  }
                  onChangeText={(service) =>
                    setDraft((value) => ({ ...value, service }))
                  }
                  palette={palette}
                  placeholder={
                    draft.kind === "password" ? "example.com" : "GitHub"
                  }
                  value={draft.service}
                />
              ) : null}

              {draft.kind === "ssh" ? (
                <>
                  <Field
                    keyboardType="url"
                    label={t("settings.vault.sshHost")}
                    onChangeText={(sshHost) =>
                      setDraft((value) => ({ ...value, sshHost }))
                    }
                    palette={palette}
                    placeholder={t("settings.vault.sshHostExample")}
                    value={draft.sshHost}
                  />
                  <Field
                    label={t("settings.vault.field.username")}
                    onChangeText={(username) =>
                      setDraft((value) => ({ ...value, username }))
                    }
                    palette={palette}
                    placeholder={t("settings.vault.sshUsernameExample")}
                    value={draft.username}
                  />
                  <Field
                    keyboardType="number-pad"
                    label={t("settings.vault.sshPort")}
                    maxLength={5}
                    onChangeText={(sshPort) =>
                      setDraft((value) => ({ ...value, sshPort }))
                    }
                    palette={palette}
                    placeholder="22"
                    value={draft.sshPort}
                  />
                </>
              ) : draft.kind !== "secret-text" ? (
                <Field
                  label={
                    draft.kind === "api-token"
                      ? t("settings.vault.field.keyAccountOptional")
                      : t("settings.vault.field.accountOptional")
                  }
                  onChangeText={(username) =>
                    setDraft((value) => ({ ...value, username }))
                  }
                  palette={palette}
                  placeholder="name@example.com"
                  value={draft.username}
                />
              ) : null}

              {draft.kind === "api-token" ? (
                <>
                  <Field
                    keyboardType="url"
                    label={t("settings.vault.apiAddress")}
                    onChangeText={(endpoint) =>
                      setDraft((value) => ({ ...value, endpoint }))
                    }
                    palette={palette}
                    placeholder="https://api.example.com"
                    value={draft.endpoint}
                  />
                  <Text style={[styles.label, { color: palette.text }]}>
                    {t("settings.vault.authMethod")}
                  </Text>
                  <View style={styles.kindRow}>
                    <Pill
                      onPress={() =>
                        setDraft((value) => ({
                          ...value,
                          apiAuthentication: "bearer",
                        }))
                      }
                      palette={palette}
                      selected={draft.apiAuthentication === "bearer"}
                    >
                      {t("settings.vault.bearer")}
                    </Pill>
                    <Pill
                      onPress={() =>
                        setDraft((value) => ({
                          ...value,
                          apiAuthentication: "header",
                        }))
                      }
                      palette={palette}
                      selected={draft.apiAuthentication === "header"}
                    >
                      {t("settings.vault.customHeader")}
                    </Pill>
                  </View>
                  {draft.apiAuthentication === "header" ? (
                    <Field
                      label={t("settings.vault.headerName")}
                      onChangeText={(apiHeaderName) =>
                        setDraft((value) => ({ ...value, apiHeaderName }))
                      }
                      palette={palette}
                      placeholder="X-API-Key"
                      value={draft.apiHeaderName}
                    />
                  ) : null}
                </>
              ) : null}

              {draft.kind === "ssh" ? (
                <>
                  <Text style={[styles.label, { color: palette.text }]}>
                    {t("settings.vault.authMethod")}
                  </Text>
                  <View style={styles.kindRow}>
                    {(["password", "private-key"] as const).map(
                      (authentication) => (
                        <Pill
                          key={authentication}
                          onPress={() =>
                            setDraft((value) =>
                              value.sshAuthentication === authentication
                                ? value
                                : {
                                    ...value,
                                    sshAuthentication: authentication,
                                    secret: "",
                                    publicKey: "",
                                    passphrase: "",
                                  },
                            )
                          }
                          palette={palette}
                          selected={draft.sshAuthentication === authentication}
                        >
                          {t(
                            authentication === "password"
                              ? "settings.vault.field.password"
                              : "settings.vault.field.privateKey",
                          )}
                        </Pill>
                      ),
                    )}
                  </View>
                </>
              ) : null}

              <Field
                label={
                  editing
                    ? t("settings.vault.newSecret", {
                        field: t(secretFieldKey(draft)),
                        optional: requiresReplacement
                          ? ""
                          : t("settings.vault.optional"),
                      })
                    : t(secretFieldKey(draft))
                }
                multiline={
                  draft.kind === "ssh" &&
                  draft.sshAuthentication === "private-key"
                }
                onChangeText={(secretValue) =>
                  setDraft((value) => ({ ...value, secret: secretValue }))
                }
                palette={palette}
                placeholder={
                  draft.kind === "ssh" &&
                  draft.sshAuthentication === "private-key"
                    ? t("settings.vault.pastePrivateKey")
                    : editing && !requiresReplacement
                      ? t("settings.vault.replaceEmpty")
                      : undefined
                }
                secureTextEntry={
                  !(
                    draft.kind === "ssh" &&
                    draft.sshAuthentication === "private-key"
                  )
                }
                value={draft.secret}
              />
              {draft.kind === "ssh" &&
              draft.sshAuthentication === "private-key" &&
              (!editing || requiresReplacement || Boolean(draft.secret)) ? (
                <>
                  <Field
                    label={t("settings.vault.field.publicKey")}
                    multiline
                    onChangeText={(publicKey) =>
                      setDraft((value) => ({ ...value, publicKey }))
                    }
                    palette={palette}
                    value={draft.publicKey}
                  />
                  <Field
                    label={t("settings.vault.passphrase")}
                    onChangeText={(passphrase) =>
                      setDraft((value) => ({ ...value, passphrase }))
                    }
                    palette={palette}
                    secureTextEntry
                    value={draft.passphrase}
                  />
                </>
              ) : null}

              {draft.kind === "ssh" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    busy: testing,
                    disabled: !canTestSsh || saving || testing,
                  }}
                  disabled={!canTestSsh || saving || testing}
                  onPress={() => void testConnection()}
                  style={({ pressed }) => [
                    styles.testButton,
                    { borderColor: palette.accent },
                    (!canTestSsh || saving || testing) && { opacity: 0.36 },
                    pressed && { backgroundColor: palette.accentSoft },
                  ]}
                >
                  {testing ? (
                    <LoadingIndicator
                      color={palette.accent}
                      palette={palette}
                      variant="inline"
                    />
                  ) : null}
                  <Text style={[styles.testText, { color: palette.accent }]}>
                    {t(
                      testing
                        ? "settings.vault.testingConnection"
                        : "settings.vault.testConnection",
                    )}
                  </Text>
                </Pressable>
              ) : null}

              <SectionLabel palette={palette}>
                {t("settings.vault.allowedProjects")}
              </SectionLabel>
              {Object.values(state.projects).map((project) => {
                const granted = draft.projectIds.includes(project.id);
                return (
                  <View
                    key={project.id}
                    style={[
                      styles.projectRow,
                      { borderBottomColor: palette.border },
                    ]}
                  >
                    <Text style={[styles.projectName, { color: palette.text }]}>
                      {project.name}
                    </Text>
                    <AppSwitch
                      accessibilityLabel={t(
                        granted
                          ? "settings.vault.granted"
                          : "settings.vault.notGranted",
                        { project: project.name },
                      )}
                      onValueChange={(enabled) =>
                        setDraft((value) => ({
                          ...value,
                          projectIds: enabled
                            ? [...new Set([...value.projectIds, project.id])]
                            : value.projectIds.filter(
                                (id) => id !== project.id,
                              ),
                        }))
                      }
                      trackColor={{
                        false: palette.borderStrong,
                        true: palette.accent,
                      }}
                      value={granted}
                    />
                  </View>
                );
              })}

              {error ? (
                <Text style={[styles.error, { color: palette.danger }]}>
                  {error}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={!canSave || saving || testing}
                onPress={() => void save()}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: palette.text },
                  (!canSave || saving || testing) && { opacity: 0.36 },
                  pressed && { opacity: 0.68 },
                ]}
              >
                {saving ? (
                  <LoadingIndicator
                    color={palette.background}
                    palette={palette}
                    variant="inline"
                  />
                ) : null}
                <Text style={[styles.saveText, { color: palette.background }]}>
                  {t(saving ? "settings.vault.saving" : "settings.vault.save")}
                </Text>
              </Pressable>

              {editing ? (
                <Pressable
                  accessibilityLabel={t("settings.vault.delete")}
                  accessibilityRole="button"
                  disabled={saving || testing}
                  onPress={confirmRemove}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    { borderColor: palette.danger },
                    pressed && { opacity: 0.64 },
                  ]}
                >
                  <Text style={[styles.deleteText, { color: palette.danger }]}>
                    {t("settings.vault.delete")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  palette,
  multiline = false,
  ...props
}: ComponentProps<typeof TextInput> & {
  label: string;
  palette: ReturnType<typeof useAppPalette>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        placeholderTextColor={palette.textTertiary}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            color: palette.text,
          },
        ]}
        textAlignVertical={multiline ? "top" : "center"}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  editorContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  editorLoading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  empty: { alignItems: "center", gap: spacing.xs, padding: spacing.xl },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  form: { gap: spacing.md, paddingBottom: spacing.md },
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  multilineInput: { minHeight: 132, paddingVertical: spacing.sm },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  projectRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 62,
    paddingVertical: spacing.xs,
  },
  projectName: { flex: 1, fontSize: 14, fontWeight: "600" },
  error: { fontSize: 13, lineHeight: 19 },
  saveButton: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 50,
  },
  saveText: { fontSize: 15, fontWeight: "700" },
  testButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  testText: { fontSize: 14, fontWeight: "700", textAlign: "center" },
  deleteButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  deleteText: { fontSize: 14, fontWeight: "600", textAlign: "center" },
});
