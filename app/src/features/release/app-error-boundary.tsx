import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

type State = { failed: boolean; resetKey: number };

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { failed: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Never log exception payloads: model output and connector content may be
    // present in component props. A future telemetry adapter must redact first.
  }

  reset = () => {
    this.setState(({ resetKey }) => ({
      failed: false,
      resetKey: resetKey + 1,
    }));
  };

  render() {
    if (this.state.failed) return <AppCrashFallback onRetry={this.reset} />;
    return (
      <View key={this.state.resetKey} style={styles.flex}>
        {this.props.children}
      </View>
    );
  }
}

function AppCrashFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  const palette = useAppPalette();
  return (
    <View style={[styles.fallback, { backgroundColor: palette.background }]}>
      <Text style={[styles.title, { color: palette.text }]}>
        {t("release.crash.title")}
      </Text>
      <Text style={[styles.detail, { color: palette.textSecondary }]}>
        {t("release.crash.detail")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: palette.accent },
          pressed && { backgroundColor: palette.accentPressed },
        ]}
      >
        <Text style={[styles.buttonText, { color: palette.accentText }]}>
          {t("release.crash.retry")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  detail: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
    maxWidth: 480,
    textAlign: "center",
  },
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: 48,
    minWidth: 140,
    paddingHorizontal: spacing.lg,
  },
  buttonText: { fontSize: 15, fontWeight: "700" },
});
