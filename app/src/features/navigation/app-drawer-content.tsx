import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import appIcon from "@/assets/boltpocket/icon.png";
import { authenticationErrorMessageKey } from "@/features/auth/authentication-error-message";
import { useBrowserActions } from "@/features/browser/browser-provider";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import {
  useAuthenticationActions,
  useAuthenticationState,
} from "@/providers/authentication-provider";
import { radii, spacing, useAppPalette } from "@/theme/tokens";
import { LOCAL_INFERENCE } from "@/config/local-inference";

const shortcuts = [
  {
    kind: "route",
    route: "/memory",
    labelKey: "home.drawer.memory" satisfies MessageKey,
    icon: "sparkles-outline" as const,
  },
  {
    kind: "route",
    route: "/skills",
    labelKey: "home.drawer.skills" satisfies MessageKey,
    icon: "extension-puzzle-outline" as const,
  },
  {
    kind: "route",
    route: "/mcp",
    labelKey: "home.drawer.mcp" satisfies MessageKey,
    icon: "git-network-outline" as const,
  },
  {
    kind: "browser",
    labelKey: "home.drawer.browser" satisfies MessageKey,
    icon: "globe-outline" as const,
  },
  {
    kind: "route",
    route: "/settings/vault",
    labelKey: "library.settings.vault" satisfies MessageKey,
    icon: "key-outline" as const,
  },
] as const;

type AppDrawerContentProps = {
  navigation: {
    closeDrawer: () => void;
  };
};

export function AppDrawerContent({ navigation }: AppDrawerContentProps) {
  const { t } = useI18n();
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { open: openBrowser } = useBrowserActions();
  const { signIn } = useAuthenticationActions();
  const profile = useAuthenticationState(
    (authentication) => authentication.profile,
  );
  const status = useAuthenticationState(
    (authentication) => authentication.status,
  );

  const accountName = profile
    ? profile.displayName
    : status === "loading"
      ? t("home.drawer.account")
      : t("home.drawer.signIn");
  const accountDetail = profile
    ? (profile.email ?? `@${profile.username}`)
    : status === "loading"
      ? t("home.drawer.accountLoading")
      : t("home.drawer.signInDetail");

  const close = () => navigation.closeDrawer();

  const openMarket = () => {
    close();
    requestAnimationFrame(() => router.setParams({ market: "1" }));
  };

  const openRoute = (
    route: "/mcp" | "/memory" | "/skills" | "/settings" | "/settings/vault",
  ) => {
    close();
    router.push(route);
  };

  const openAccount = () => {
    close();
    if (profile || status === "loading") {
      requestAnimationFrame(() => router.push("/account"));
      return;
    }
    void signIn().then(
      (signedIn) => {
        if (signedIn) {
          requestAnimationFrame(() => router.push("/account"));
        }
      },
      (error: unknown) => {
        Alert.alert(
          t("auth.login.title"),
          t(authenticationErrorMessageKey(error)),
        );
      },
    );
  };

  return (
    // Keep the top system region clear without nesting another native
    // safe-area node inside the drawer navigator.
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.surface,
          marginTop: insets.top,
        },
      ]}
    >
      <View style={styles.brandRow}>
        <Image contentFit="cover" source={appIcon} style={styles.brandMark} />
        <Text style={[styles.brandName, { color: palette.text }]}>
          {t("common.brand.name")}
        </Text>
        <Pressable
          accessibilityLabel={t("home.drawer.collapse")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={close}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && { opacity: 0.55 },
          ]}
        >
          <Ionicons color={palette.text} name="close" size={22} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!LOCAL_INFERENCE && (
          <Pressable
            accessibilityRole="button"
            onPress={openMarket}
            style={({ pressed }) => [
              styles.market,
              {
                backgroundColor: palette.accentSoft,
                borderColor: palette.accent,
              },
              pressed && { opacity: 0.68 },
            ]}
          >
            <View style={styles.marketIcon}>
              <Ionicons
                color={palette.accent}
                name="storefront-outline"
                size={21}
              />
            </View>
            <Text style={[styles.marketText, { color: palette.text }]}>
              {t("home.drawer.market")}
            </Text>
            <Ionicons color={palette.accent} name="chevron-forward" size={18} />
          </Pressable>
        )}
        <View style={styles.shortcuts}>
          {shortcuts.map((shortcut) => (
            <Pressable
              accessibilityRole="button"
              key={shortcut.labelKey}
              onPress={() => {
                if (shortcut.kind === "browser") {
                  close();
                  openBrowser();
                } else {
                  openRoute(shortcut.route);
                }
              }}
              style={({ pressed }) => [
                styles.shortcut,
                { borderColor: palette.border },
                pressed && { backgroundColor: palette.codeSurface },
              ]}
            >
              <Ionicons
                color={palette.textSecondary}
                name={shortcut.icon}
                size={20}
              />
              <Text style={[styles.shortcutText, { color: palette.text }]}>
                {t(shortcut.labelKey)}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.accountFooter, { borderTopColor: palette.border }]}>
        {!LOCAL_INFERENCE && (
          <Pressable
            accessibilityLabel={accountName}
            accessibilityRole="button"
            onPress={openAccount}
            style={({ pressed }) => [
              styles.accountRow,
              pressed && { backgroundColor: palette.codeSurface },
            ]}
          >
            {profile?.avatarUrl ? (
              <Image
                contentFit="cover"
                source={{ uri: profile.avatarUrl }}
                style={styles.avatar}
              />
            ) : (
              <View
                style={[
                  styles.avatar,
                  {
                    backgroundColor: profile
                      ? palette.accentSoft
                      : palette.codeSurface,
                  },
                ]}
              >
                {profile ? (
                  <Text
                    style={[styles.avatarInitial, { color: palette.accent }]}
                  >
                    {profile.displayName.trim().charAt(0).toLocaleUpperCase() ||
                      "i"}
                  </Text>
                ) : (
                  <Ionicons
                    color={palette.textSecondary}
                    name="person-outline"
                    size={19}
                  />
                )}
              </View>
            )}
            <View style={styles.accountCopy}>
              <Text
                numberOfLines={1}
                style={[styles.accountName, { color: palette.text }]}
              >
                {accountName}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.accountUsername,
                  { color: palette.textSecondary },
                ]}
              >
                {accountDetail}
              </Text>
            </View>
          </Pressable>
        )}
        <Pressable
          accessibilityLabel={t("home.drawer.settings")}
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => openRoute("/settings")}
          style={({ pressed }) => [
            styles.accountSettings,
            pressed && { backgroundColor: palette.codeSurface },
          ]}
        >
          <Ionicons
            color={palette.textSecondary}
            name="settings-outline"
            size={20}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    height: 56,
  },
  brandMark: {
    borderRadius: radii.sm,
    height: 32,
    width: 32,
  },
  brandName: { flex: 1, fontSize: 19, fontWeight: "600" },
  iconButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  scrollContent: { paddingBottom: spacing.lg },
  market: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  marketIcon: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  marketText: { flex: 1, fontSize: 14, fontWeight: "700" },
  shortcuts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  shortcut: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexBasis: "45%",
    flexGrow: 1,
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 72,
  },
  shortcutText: { fontSize: 12, fontWeight: "500" },
  accountFooter: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  accountRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  accountSettings: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  avatar: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  avatarInitial: { fontSize: 15, fontWeight: "700" },
  accountCopy: { flex: 1 },
  accountName: { fontSize: 14, fontWeight: "600" },
  accountUsername: { fontSize: 11, marginTop: 2 },
});
