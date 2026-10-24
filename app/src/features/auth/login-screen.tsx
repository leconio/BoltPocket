import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import { authenticationErrorMessageKey } from "@/features/auth/authentication-error-message";
import { useI18n } from "@/i18n/i18n-provider";
import {
  useAuthenticationActions,
  useAuthenticationState,
} from "@/providers/authentication-provider";
import { useAppPalette } from "@/theme/tokens";

export function LoginScreen({
  enabled = true,
  onBack,
}: Readonly<{
  enabled?: boolean;
  onBack: () => void;
}>) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const status = useAuthenticationState(
    (authentication) => authentication.status,
  );
  const { signIn } = useAuthenticationActions();
  const activeAttempt = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || status === "loading" || activeAttempt.current) return;
    activeAttempt.current = true;
    let mounted = true;
    void signIn().then(
      (profile) => {
        if (mounted && !profile) onBack();
      },
      (error: unknown) => {
        if (!mounted) return;
        Alert.alert(
          t("auth.login.title"),
          t(authenticationErrorMessageKey(error)),
          [
            {
              onPress: onBack,
              style: "cancel",
              text: t("auth.account.cancel"),
            },
            {
              onPress: () => {
                activeAttempt.current = false;
                setAttempt((value) => value + 1);
              },
              text: t("auth.login.retry"),
            },
          ],
          { cancelable: false },
        );
      },
    );
    return () => {
      mounted = false;
    };
  }, [attempt, enabled, onBack, signIn, status, t]);

  return (
    <SafeAreaView
      edges={["top"]}
      mode="margin"
      style={[styles.loading, { backgroundColor: palette.background }]}
    >
      <LoadingIndicator palette={palette} variant="screen" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
});
