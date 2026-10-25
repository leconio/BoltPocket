import { type Href, useRouter } from "expo-router";
import { ListRow, SectionLabel } from "@/components/ui";
import { useI18n } from "@/i18n/i18n-provider";
import type { AppPalette } from "@/theme/tokens";

export function LibrarySettingsList({
  palette,
  projectId,
}: {
  palette: AppPalette;
  projectId: string | null;
}) {
  const router = useRouter();
  const { preference, t } = useI18n();
  return (
    <>
      <SectionLabel palette={palette}>
        {t("library.settings.group.settings")}
      </SectionLabel>
      <ListRow
        icon="hardware-chip-outline"
        onPress={() => router.push("/settings/model")}
        palette={palette}
        title={t("library.settings.model")}
      />
      <ListRow
        icon="download-outline"
        onPress={() => router.push("/settings/local-models")}
        palette={palette}
        title={t("settings.local.title")}
      />
      <ListRow
        icon="globe-outline"
        onPress={() => router.push("/settings/browser")}
        palette={palette}
        title={t("library.settings.browser")}
      />
      <ListRow
        icon="phone-portrait-outline"
        onPress={() => router.push("/settings/device" as Href)}
        palette={palette}
        title={t("library.settings.device")}
      />
      <ListRow
        icon="language-outline"
        onPress={() => router.push("/settings/language" as Href)}
        palette={palette}
        title={t("library.settings.language")}
        value={t(
          preference === "system"
            ? "settings.language.system"
            : preference === "zh-CN"
              ? "settings.language.chinese"
              : "settings.language.english",
        )}
      />
      <SectionLabel palette={palette}>
        {t("library.settings.group.personalization")}
      </SectionLabel>
      <ListRow
        icon="sparkles-outline"
        onPress={() =>
          projectId
            ? router.push({ pathname: "/memory", params: { projectId } })
            : router.push("/memory")
        }
        palette={palette}
        title={t("library.settings.memory")}
      />
      <ListRow
        icon="extension-puzzle-outline"
        onPress={() =>
          projectId
            ? router.push({ pathname: "/skills", params: { projectId } })
            : router.push("/skills")
        }
        palette={palette}
        title={t("library.settings.skills")}
      />
      <SectionLabel palette={palette}>
        {t("library.settings.group.services")}
      </SectionLabel>
      <ListRow
        icon="git-network-outline"
        onPress={() => router.push("/mcp")}
        palette={palette}
        title="MCP"
      />
      {projectId ? (
        <>
          <ListRow
            icon="link-outline"
            onPress={() =>
              router.push({
                pathname: "/connections",
                params: { projectId },
              })
            }
            palette={palette}
            title={t("library.settings.connections")}
          />
        </>
      ) : null}
      <SectionLabel palette={palette}>
        {t("library.settings.group.security")}
      </SectionLabel>
      <ListRow
        icon="shield-checkmark-outline"
        onPress={() => router.push("/settings/privacy" as Href)}
        palette={palette}
        title={t("privacy.center.title")}
      />
      <ListRow
        icon="information-circle-outline"
        onPress={() => router.push("/settings/about" as Href)}
        palette={palette}
        title={t("library.settings.about")}
      />
    </>
  );
}
