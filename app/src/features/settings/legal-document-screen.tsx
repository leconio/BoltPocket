import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MarkdownContent } from "@/components/markdown-content";
import { ScreenHeader } from "@/components/ui";
import { loadComplianceConfig } from "@/config/compliance";
import {
  complianceDocument,
  isComplianceDocumentId,
} from "@/domain/compliance-documents";
import { useI18n } from "@/i18n/i18n-provider";
import { spacing, useAppPalette } from "@/theme/tokens";

export function LegalDocumentScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const { locale } = useI18n();
  const { document: rawDocument } = useLocalSearchParams<{
    document?: string;
  }>();
  const documentId = isComplianceDocumentId(rawDocument)
    ? rawDocument
    : "privacy";
  const document = complianceDocument(
    documentId,
    loadComplianceConfig(),
    locale,
  );
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings/about" as Href);
  };

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScreenHeader onBack={goBack} palette={palette} title={document.title} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <MarkdownContent variant="conversation">
          {document.markdown}
        </MarkdownContent>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
});
