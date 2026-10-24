import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import { ScreenHeader } from "@/components/ui";
import {
  builtInProjectResourcePack,
  isBuiltInProjectResourcePackId,
} from "@/domain/builtin-project-resources";
import { useI18n } from "@/i18n/i18n-provider";
import { localizedErrorMessage } from "@/i18n/translate";
import { projectResourceCache } from "@/infrastructure/browser/expo-project-resource-cache";
import {
  createAppStateFieldsSelector,
  useAppStateSelector,
} from "@/providers/app-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

const selectProjectResourceFileState = createAppStateFieldsSelector("projects");

type LoadedFile =
  | { status: "loading" }
  | { status: "image"; uri: string }
  | { status: "text"; content: string }
  | { status: "binary" }
  | { status: "error"; message: string };

function displayBytes(value: number) {
  if (value < 1_024) return `${value} B`;
  return `${(value / 1_024).toFixed(value < 10 * 1_024 ? 1 : 0)} KiB`;
}

export function ProjectResourceFileScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const {
    projectId,
    packId,
    fileIndex: fileIndexParam,
  } = useLocalSearchParams<{
    projectId: string;
    packId: string;
    fileIndex: string;
  }>();
  const state = useAppStateSelector(selectProjectResourceFileState);
  const project = state.projects[projectId];
  const pack = isBuiltInProjectResourcePackId(packId)
    ? builtInProjectResourcePack(packId)
    : undefined;
  const fileIndex = Number(fileIndexParam);
  const file =
    pack && Number.isInteger(fileIndex) && fileIndex >= 0
      ? pack.files[fileIndex]
      : undefined;
  const resourceKey = pack && file ? `${pack.id}:${file.path}` : null;
  const [loadedState, setLoadedState] = useState<{
    key: string | null;
    value: LoadedFile;
  }>({
    key: resourceKey,
    value: resourceKey
      ? { status: "loading" }
      : {
          status: "error",
          message: t("project.resourceFile.missing"),
        },
  });
  const isText = Boolean(
    file &&
    (file.mimeType.startsWith("text/") ||
      file.mimeType === "application/json" ||
      file.mimeType === "application/xml"),
  );
  const loaded: LoadedFile = !resourceKey
    ? { status: "error", message: t("project.resourceFile.missing") }
    : loadedState.key === resourceKey
      ? loadedState.value
      : { status: "loading" };

  useEffect(() => {
    let active = true;
    if (!pack || !file || !resourceKey) return undefined;
    void (
      file.mimeType.startsWith("image/")
        ? projectResourceCache
            .fileUri(pack.id, file.path)
            .then<LoadedFile>((uri) => ({ status: "image", uri }))
        : isText
          ? projectResourceCache
              .readText(pack.id, file.path)
              .then<LoadedFile>((content) => ({ status: "text", content }))
          : Promise.resolve<LoadedFile>({ status: "binary" })
    ).then(
      (result) => {
        if (active) setLoadedState({ key: resourceKey, value: result });
      },
      (error: unknown) => {
        if (active) {
          setLoadedState({
            key: resourceKey,
            value: {
              status: "error",
              message: localizedErrorMessage(
                error,
                t("project.resourceFile.readFailed"),
              ),
            },
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [file, isText, pack, resourceKey, t]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else {
      router.replace({
        pathname: "/project-resources/[projectId]/[packId]" as never,
        params: { projectId, packId },
      });
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
        subtitle={pack?.name ?? project?.name}
        title={file?.path.split("/").at(-1) ?? t("project.resourceFile.title")}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {file ? (
          <Text style={[styles.meta, { color: palette.textSecondary }]}>
            {file.mimeType} · {displayBytes(file.byteLength)}
          </Text>
        ) : null}
        {loaded.status === "loading" ? (
          <View style={styles.centered}>
            <LoadingIndicator palette={palette} variant="media" />
          </View>
        ) : loaded.status === "image" ? (
          <View
            style={[
              styles.imageFrame,
              {
                backgroundColor: palette.codeSurface,
                borderColor: palette.border,
              },
            ]}
          >
            <Image
              contentFit="contain"
              source={{ uri: loaded.uri }}
              style={styles.image}
            />
          </View>
        ) : loaded.status === "text" ? (
          <Text
            selectable
            style={[
              styles.code,
              { backgroundColor: palette.codeSurface, color: palette.text },
            ]}
          >
            {loaded.content}
          </Text>
        ) : loaded.status === "binary" ? (
          <View style={styles.centered}>
            <Ionicons
              color={palette.textTertiary}
              name="document-outline"
              size={30}
            />
            <Text style={[styles.message, { color: palette.textSecondary }]}>
              {t("project.resourceFile.binaryOnly")}
            </Text>
          </View>
        ) : (
          <View style={styles.centered}>
            <Text style={[styles.message, { color: palette.danger }]}>
              {loaded.message}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxl },
  meta: { fontSize: 12, marginBottom: spacing.md },
  centered: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 260,
  },
  imageFrame: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    height: 360,
    overflow: "hidden",
    padding: spacing.md,
  },
  image: { height: "100%", width: "100%" },
  code: {
    borderRadius: radii.md,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.md,
  },
  message: { fontSize: 14, textAlign: "center" },
});
