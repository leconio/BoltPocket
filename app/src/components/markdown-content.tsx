import Markdown, {
  createMarkdownIt,
  type MarkdownStyleMap,
  type RenderRules,
} from "@ronradtke/react-native-markdown-display";
import { useCallback, useMemo } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextProps,
  type StyleProp,
  type ViewStyle,
  View,
  useColorScheme,
} from "react-native";

import { normalizeMarkdownUrl } from "@/components/markdown-policy";
import { useBrowserActions } from "@/features/browser/browser-provider";
import { Alert } from "react-native";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey, MessageValues } from "@/i18n/messages";
import { localizedErrorMessage } from "@/i18n/translate";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

export type MarkdownVariant =
  "body" | "conversation" | "detail" | "secondary" | "compact" | "user";

type MarkdownContentProps = {
  children: string;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  textAlign?: "left" | "center";
  variant?: MarkdownVariant;
};

const markdownParser = createMarkdownIt({ typographer: false });

function SelectableMarkdownText(props: TextProps) {
  return <Text {...props} selectable />;
}

function createSafeRenderRules(
  openUrl: (url: string) => void,
  t: (key: MessageKey, values?: MessageValues) => string,
  listSafe: boolean,
): RenderRules {
  return {
    code_block: (node, _children, _parents, styles) => {
      const content = node.content.endsWith("\n")
        ? node.content.slice(0, -1)
        : node.content;
      if (listSafe) {
        return (
          <View
            key={node.key}
            style={{ maxWidth: "100%", minWidth: 0, overflow: "hidden" }}
          >
            <Text
              selectable
              style={[styles.code_block, { flexShrink: 1, minWidth: 0 }]}
            >
              {content}
            </Text>
          </View>
        );
      }
      return (
        <ScrollView
          horizontal
          key={node.key}
          showsHorizontalScrollIndicator={false}
        >
          <Text selectable style={styles.code_block}>
            {content}
          </Text>
        </ScrollView>
      );
    },
    table: (node, children, _parents, styles) => {
      if (listSafe) {
        return (
          <View
            key={node.key}
            style={[
              styles._VIEW_SAFE_table,
              { maxWidth: "100%", minWidth: 0, overflow: "hidden" },
            ]}
          >
            {children}
          </View>
        );
      }
      return (
        <ScrollView
          contentContainerStyle={{ minWidth: 300 }}
          horizontal
          key={node.key}
          showsHorizontalScrollIndicator={false}
        >
          <View style={[styles._VIEW_SAFE_table, { minWidth: 300 }]}>
            {children}
          </View>
        </ScrollView>
      );
    },
    link: (node, children, _parents, styles) => {
      const url = normalizeMarkdownUrl(node.attributes.href ?? "");
      if (!url) {
        return (
          <Text key={node.key} style={styles.text}>
            {children}
          </Text>
        );
      }
      return (
        <Pressable
          accessibilityRole="link"
          key={node.key}
          onPress={() => openUrl(url)}
        >
          <Text style={styles.link}>{children}</Text>
        </Pressable>
      );
    },
    blocklink: (node, children, _parents, styles) => {
      const url = normalizeMarkdownUrl(node.attributes.href ?? "");
      if (!url) return <View key={node.key}>{children}</View>;
      return (
        <Pressable
          accessibilityLabel={node.attributes.title || url}
          accessibilityRole="link"
          key={node.key}
          onPress={() => openUrl(url)}
          style={styles.blocklink}
        >
          {children}
        </Pressable>
      );
    },
    image: (node, _children, _parents, styles) => {
      const alt =
        node.attributes.alt?.trim() || t("common.markdown.unnamedImage");
      return (
        <Text key={node.key} style={styles.image_alt}>
          {t("common.markdown.imageAlt", { alt })}
        </Text>
      );
    },
  };
}

function createMarkdownStyles(
  palette: ReturnType<typeof useAppPalette>,
  variant: MarkdownVariant,
  textAlign: "left" | "center",
): MarkdownStyleMap {
  const compact = variant === "compact";
  const conversation = variant === "conversation" || variant === "detail";
  const user = variant === "user";
  const secondary = variant === "secondary" || compact;
  const fontSize = compact
    ? 13
    : conversation
      ? 16
      : variant === "user"
        ? 15
        : 15.5;
  const lineHeight = compact
    ? 19
    : conversation
      ? 27
      : variant === "user"
        ? 23
        : 25;
  const color = secondary ? palette.textSecondary : palette.text;
  const blockGap = user ? 0 : compact ? spacing.xxs : spacing.xs;
  const monoFont = Platform.select({ ios: "Menlo", android: "monospace" });

  return {
    body: { color, flexShrink: 1, fontSize, lineHeight, minWidth: 0 },
    text: {
      color,
      flexShrink: 1,
      fontSize,
      lineHeight,
      minWidth: 0,
      textAlign,
    },
    textgroup: {
      color,
      flexShrink: 1,
      fontSize,
      lineHeight,
      minWidth: 0,
      textAlign,
    },
    paragraph: {
      marginBottom: blockGap,
      marginTop: 0,
    },
    heading1: {
      color: palette.text,
      fontSize: compact ? 19 : conversation ? 25 : 24,
      fontWeight: "700",
      lineHeight: compact ? 25 : conversation ? 33 : 31,
      marginBottom: blockGap,
      marginTop: user ? 0 : compact ? spacing.xs : spacing.md,
    },
    heading2: {
      color: palette.text,
      fontSize: compact ? 17 : conversation ? 22 : 21,
      fontWeight: "700",
      lineHeight: compact ? 23 : conversation ? 29 : 28,
      marginBottom: blockGap,
      marginTop: user ? 0 : spacing.sm,
    },
    heading3: {
      color: palette.text,
      fontSize: compact ? 15 : 18,
      fontWeight: "700",
      lineHeight: compact ? 21 : 25,
      marginBottom: blockGap,
      marginTop: user ? 0 : spacing.sm,
    },
    heading4: { color: palette.text, fontSize, fontWeight: "700" },
    heading5: { color: palette.text, fontSize, fontWeight: "700" },
    heading6: { color: palette.textSecondary, fontSize, fontWeight: "700" },
    strong: { color, fontWeight: "700" },
    em: { color, fontStyle: "italic" },
    s: { color: palette.textSecondary, textDecorationLine: "line-through" },
    link: { color: palette.accent, textDecorationLine: "underline" },
    blocklink: {
      borderBottomColor: palette.borderStrong,
      borderBottomWidth: 0,
    },
    image_alt: {
      color: palette.textSecondary,
      fontSize: compact ? 12 : 13,
      fontStyle: "italic",
      lineHeight,
    },
    blockquote: {
      backgroundColor: palette.codeSurface,
      borderColor: palette.borderStrong,
      borderLeftWidth: 3,
      borderRadius: radii.sm,
      marginBottom: blockGap,
      marginLeft: 0,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    bullet_list: { marginBottom: blockGap },
    ordered_list: { marginBottom: blockGap },
    bullet_list_icon: {
      color: palette.textSecondary,
      marginLeft: spacing.xxs,
      marginRight: spacing.xs,
    },
    ordered_list_icon: {
      color: palette.textSecondary,
      marginLeft: spacing.xxs,
      marginRight: spacing.xs,
    },
    code_inline: {
      backgroundColor: palette.codeSurface,
      borderColor: palette.borderStrong,
      borderRadius: 5,
      borderWidth: 0,
      color: palette.text,
      fontFamily: monoFont,
      fontSize: compact ? 12 : 13.5,
      padding: 0,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    code_block: {
      backgroundColor: palette.codeSurface,
      borderColor: palette.border,
      borderRadius: radii.sm,
      borderWidth: 1,
      color: palette.text,
      fontFamily: monoFont,
      fontSize: compact ? 12 : 13,
      lineHeight: compact ? 18 : 20,
      marginBottom: blockGap,
      padding: spacing.sm,
    },
    fence: {
      borderColor: palette.border,
      borderRadius: radii.sm,
      borderWidth: 1,
      marginBottom: blockGap,
    },
    fence_header: {
      backgroundColor: palette.surfaceRaised,
      borderBottomColor: palette.border,
    },
    fence_language_label: {
      color: palette.textSecondary,
      fontFamily: monoFont,
    },
    fence_code: { backgroundColor: palette.codeSurface },
    fence_token: {
      fontFamily: monoFont,
      fontSize: compact ? 12 : 13,
      lineHeight: compact ? 18 : 20,
    },
    table: {
      borderColor: palette.borderStrong,
      borderRadius: radii.sm,
      borderWidth: 1,
      marginBottom: blockGap,
    },
    tr: { borderBottomColor: palette.border, borderBottomWidth: 1 },
    th: { backgroundColor: palette.codeSurface, padding: spacing.xs },
    td: { padding: spacing.xs },
    hr: {
      backgroundColor: palette.borderStrong,
      height: 1,
      marginBottom: blockGap,
      marginTop: blockGap,
    },
  };
}

export function MarkdownContent({
  children,
  containerStyle,
  testID,
  textAlign = "left",
  variant = "body",
}: MarkdownContentProps) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const { open: openBrowser } = useBrowserActions();
  const colorScheme: "dark" | "light" =
    useColorScheme() === "dark" ? "dark" : "light";
  const openMarkdownUrl = useCallback(
    (value: string) => {
      const url = normalizeMarkdownUrl(value);
      if (!url) {
        Alert.alert(
          t("common.markdown.linkOpenFailed"),
          t("common.markdown.unsafeLink"),
        );
        return;
      }
      try {
        openBrowser(url);
      } catch (error) {
        Alert.alert(
          t("common.markdown.linkOpenFailed"),
          localizedErrorMessage(error, t("common.markdown.linkUnavailable")),
        );
      }
    },
    [openBrowser, t],
  );
  const safeRenderRules = useMemo(
    () =>
      createSafeRenderRules(
        openMarkdownUrl,
        t,
        variant !== "body" && variant !== "detail",
      ),
    [openMarkdownUrl, t, variant],
  );
  const styles = useMemo(
    () => createMarkdownStyles(palette, variant, textAlign),
    [palette, textAlign, variant],
  );

  if (!children) return null;

  const sharedProps = {
    allowedImageHandlers: [] as string[],
    colorScheme,
    defaultImageHandler: null,
    markdownit: markdownParser,
    rules: safeRenderRules,
    style: styles,
    textcomponent: SelectableMarkdownText,
  };

  return (
    <View
      style={[markdownContainerStyles.container, containerStyle]}
      testID={testID}
    >
      <Markdown {...sharedProps}>{children}</Markdown>
    </View>
  );
}

const markdownContainerStyles = StyleSheet.create({
  container: { minWidth: 0 },
});
