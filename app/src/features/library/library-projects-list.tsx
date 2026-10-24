import type { ReactElement } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { PageEmptyState, SectionLabel } from "@/components/ui";
import type { Project } from "@/domain/models";
import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, type AppPalette } from "@/theme/tokens";

export function LibraryProjectsList({
  projects,
  selectedProjectId,
  palette,
  onSelect,
  header,
  emptyDescription,
}: {
  emptyDescription: string;
  header: ReactElement;
  projects: Project[];
  selectedProjectId: string | null;
  palette: AppPalette;
  onSelect: (projectId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <FlatList
      contentContainerStyle={[
        styles.content,
        projects.length === 0 && styles.emptyContent,
      ]}
      data={projects}
      keyExtractor={(project) => project.id}
      keyboardDismissMode={
        process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"
      }
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        <PageEmptyState description={emptyDescription} palette={palette} />
      }
      ListHeaderComponent={
        <>
          {header}
          <SectionLabel palette={palette}>
            {t("library.projects.all")}
          </SectionLabel>
        </>
      }
      renderItem={({ item: project }) => {
        const selected = project.id === selectedProjectId;
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => onSelect(project.id)}
            style={({ pressed }) => [
              styles.projectCard,
              { borderBottomColor: palette.border },
              selected && { backgroundColor: palette.accentSoft },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View
              style={[
                styles.projectSymbol,
                {
                  backgroundColor: selected
                    ? palette.accent
                    : palette.codeSurface,
                },
              ]}
            >
              <Text
                style={[
                  styles.projectSymbolText,
                  {
                    color: selected
                      ? palette.accentText
                      : palette.textSecondary,
                  },
                ]}
              >
                {project.symbol}
              </Text>
            </View>
            <View style={styles.projectCopy}>
              <Text style={[styles.projectTitle, { color: palette.text }]}>
                {project.name}
              </Text>
            </View>
            <AppIcon
              color={palette.textTertiary}
              name="chevron-forward"
              size={18}
            />
          </Pressable>
        );
      }}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  emptyContent: { flexGrow: 1 },
  projectCard: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  projectSymbol: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  projectSymbolText: { fontSize: 12, fontWeight: "700" },
  projectCopy: { flex: 1 },
  projectTitle: { fontSize: 15, fontWeight: "600" },
});
