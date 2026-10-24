import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingIndicator } from "@/components/loading-indicator";
import { AppIcon } from "@/components/app-icon";
import {
  IconButton,
  ListRow,
  ScreenHeader,
  SectionLabel,
} from "@/components/ui";
import type { SkillMarketOwnedPublication } from "@/application/ports/skill-market-publication";
import {
  isAccountAuthenticationRejectedAfterSignInError,
  runWithAccountAuthenticationRecovery,
} from "@/application/account-authentication-recovery";
import { isAccountAuthenticationRequiredError } from "@/application/ports/authentication";
import { LoginScreen } from "@/features/auth/login-screen";
import { useI18n } from "@/i18n/i18n-provider";
import type { MessageKey } from "@/i18n/messages";
import type { AuthenticatedAdminRole } from "@/application/ports/authentication";
import {
  useAuthenticationActions,
  useAuthenticationState,
} from "@/providers/authentication-provider";
import { useAppServices } from "@/providers/runtime-services-provider";
import {
  isAuthenticationError,
  type AuthenticationErrorCode,
} from "@/infrastructure/auth/casdoor-authentication";
import { radii, spacing, useAppPalette } from "@/theme/tokens";

type OwnedSkillsState = Readonly<{
  error:
    "authentication-required" | "request-failed" | "service-rejected" | null;
  loading: boolean;
  profileSubject: string | null;
  skills: readonly SkillMarketOwnedPublication[];
}>;

type OwnedSkillsRecovery = "none" | "service-retry" | "sign-in";

export function AccountScreen() {
  const { t } = useI18n();
  const palette = useAppPalette();
  const router = useRouter();
  const { skillMarketPublication } = useAppServices();
  const profile = useAuthenticationState(
    (authentication) => authentication.profile,
  );
  const { deleteAccount, refreshProfile, signIn, signOut } =
    useAuthenticationActions();
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ownedSkillsState, setOwnedSkillsState] = useState<OwnedSkillsState>({
    error: null,
    loading: false,
    profileSubject: null,
    skills: [],
  });
  const ownedSkillsRequestId = useRef(0);
  const [withdrawingEntryId, setWithdrawingEntryId] = useState<string | null>(
    null,
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(drawer)");
  }, [router]);

  const profileSubject = profile?.subject ?? null;
  const loadOwnedSkills = useCallback(
    async (recovery: OwnedSkillsRecovery = "none") => {
      if (!profileSubject) return;
      const requestId = ++ownedSkillsRequestId.current;
      try {
        const result =
          recovery === "sign-in"
            ? await runWithAccountAuthenticationRecovery({
                operation: () => skillMarketPublication.listOwned(),
                signIn,
              })
            : await skillMarketPublication.listOwned();
        if (requestId !== ownedSkillsRequestId.current) return;
        if (!result) {
          setOwnedSkillsState({
            error: "authentication-required",
            loading: false,
            profileSubject,
            skills: [],
          });
          return;
        }
        setOwnedSkillsState({
          error: null,
          loading: false,
          profileSubject,
          skills: result.skills,
        });
      } catch (error) {
        if (requestId !== ownedSkillsRequestId.current) return;
        setOwnedSkillsState({
          error: isAccountAuthenticationRejectedAfterSignInError(error)
            ? "service-rejected"
            : isAccountAuthenticationRequiredError(error)
              ? recovery === "service-retry"
                ? "service-rejected"
                : "authentication-required"
              : "request-failed",
          loading: false,
          profileSubject,
          skills: [],
        });
      }
    },
    [profileSubject, signIn, skillMarketPublication],
  );

  const retryOwnedSkills = useCallback(() => {
    if (!profileSubject) return;
    const currentError =
      ownedSkillsState.profileSubject === profileSubject
        ? ownedSkillsState.error
        : null;
    const recovery: OwnedSkillsRecovery =
      currentError === "authentication-required"
        ? "sign-in"
        : currentError === "service-rejected"
          ? "service-retry"
          : "none";
    setOwnedSkillsState({
      error: null,
      loading: true,
      profileSubject,
      skills: [],
    });
    void loadOwnedSkills(recovery);
  }, [loadOwnedSkills, ownedSkillsState, profileSubject]);

  useEffect(() => {
    if (!profileSubject) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return loadOwnedSkills();
    });
    return () => {
      cancelled = true;
      ownedSkillsRequestId.current += 1;
    };
  }, [loadOwnedSkills, profileSubject]);

  const {
    error: skillsError,
    loading: skillsLoading,
    skills: ownedSkills,
  } = ownedSkillsState.profileSubject === profileSubject
    ? ownedSkillsState
    : {
        error: null,
        loading: profileSubject !== null,
        skills: [],
      };

  if (!profile) {
    return <LoginScreen enabled={!signingOut && !deleting} onBack={goBack} />;
  }

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshProfile();
    } catch {
      Alert.alert(t("auth.account.refreshFailed"), t("auth.error.network"));
    } finally {
      setRefreshing(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert(
      t("auth.account.signOutTitle"),
      t("auth.account.signOutDetail"),
      [
        { text: t("auth.account.cancel"), style: "cancel" },
        {
          text: t("auth.account.signOut"),
          style: "destructive",
          onPress: () => {
            setSigningOut(true);
            void signOut().then(goBack, () => {
              setSigningOut(false);
              Alert.alert(
                t("auth.account.signOutFailed"),
                t("auth.error.secureStorage"),
              );
            });
          },
        },
      ],
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(t("auth.account.deleteTitle"), t("auth.account.deleteDetail"), [
      { text: t("auth.account.cancel"), style: "cancel" },
      {
        text: t("auth.account.delete"),
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          void deleteAccount().then(goBack, (error: unknown) => {
            setDeleting(false);
            const code: AuthenticationErrorCode = isAuthenticationError(error)
              ? error.code
              : "server";
            Alert.alert(
              t("auth.account.deleteFailed"),
              t(accountDeletionErrorKey(code)),
            );
          });
        },
      },
    ]);
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
        title={t("auth.account.title")}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <ProfileAvatar
            avatarUrl={profile.avatarUrl}
            displayName={profile.displayName}
            palette={palette}
          />
          <Text style={[styles.displayName, { color: palette.text }]}>
            {profile.displayName}
          </Text>
          <Text style={[styles.username, { color: palette.textSecondary }]}>
            {profile.email ?? profile.username}
          </Text>
        </View>

        <SectionLabel palette={palette}>
          {t("auth.account.profile")}
        </SectionLabel>
        <ListRow
          icon="person-outline"
          palette={palette}
          title={t("auth.account.nickname")}
          value={profile.displayName}
        />
        {profile.email ? (
          <ListRow
            icon="mail-outline"
            palette={palette}
            title={t("auth.account.email")}
            value={profile.email}
          />
        ) : null}
        <ListRow
          icon="shield-checkmark-outline"
          palette={palette}
          title={t("auth.account.provider")}
          value="Casdoor"
        />
        <ListRow
          icon="people-outline"
          palette={palette}
          title={t("auth.account.role")}
          value={accountRoleLabel(profile.adminRole, t)}
        />

        <SectionLabel palette={palette}>
          {t("auth.account.mySkills")}
        </SectionLabel>
        {skillsLoading ? (
          <View style={styles.skillsState}>
            <LoadingIndicator palette={palette} variant="inline" />
            <Text
              style={[styles.skillsStateText, { color: palette.textSecondary }]}
            >
              {t("auth.account.mySkillsLoading")}
            </Text>
          </View>
        ) : skillsError ? (
          <View style={styles.skillsState}>
            <Text
              style={[styles.skillsStateText, { color: palette.textSecondary }]}
            >
              {skillsError === "authentication-required"
                ? t("auth.account.mySkillsSessionExpired")
                : skillsError === "service-rejected"
                  ? t("auth.error.sessionRejected")
                  : t("auth.account.mySkillsLoadFailed")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={retryOwnedSkills}
              style={({ pressed }) => [
                styles.skillRetry,
                { borderColor: palette.borderStrong },
                pressed && { backgroundColor: palette.codeSurface },
              ]}
            >
              <Text style={[styles.skillRetryText, { color: palette.text }]}>
                {skillsError === "authentication-required"
                  ? t("auth.account.mySkillsSignInAgain")
                  : t("auth.account.mySkillsRetry")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <OwnedSkillsSection
            palette={palette}
            skills={ownedSkills}
            onWithdraw={(skill) =>
              confirmWithdrawSkill(skill, {
                translate: t,
                withdrawingEntryId,
                setWithdrawingEntryId,
                withdraw: skillMarketPublication.withdraw.bind(
                  skillMarketPublication,
                ),
                reload: loadOwnedSkills,
              })
            }
          />
        )}

        <Pressable
          accessibilityRole="button"
          disabled={refreshing || signingOut || deleting}
          onPress={() => void refresh()}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: palette.borderStrong },
            pressed && { backgroundColor: palette.codeSurface },
          ]}
        >
          {refreshing ? (
            <LoadingIndicator palette={palette} variant="inline" />
          ) : (
            <Ionicons color={palette.text} name="refresh-outline" size={18} />
          )}
          <Text style={[styles.secondaryButtonText, { color: palette.text }]}>
            {t("auth.account.refresh")}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={refreshing || signingOut || deleting}
          onPress={confirmSignOut}
          style={({ pressed }) => [
            styles.signOutButton,
            { backgroundColor: palette.dangerSoft },
            pressed && { opacity: 0.7 },
          ]}
        >
          {signingOut ? (
            <LoadingIndicator
              color={palette.danger}
              palette={palette}
              variant="inline"
            />
          ) : (
            <Ionicons color={palette.danger} name="log-out-outline" size={18} />
          )}
          <Text style={[styles.signOutText, { color: palette.danger }]}>
            {t("auth.account.signOut")}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={refreshing || signingOut || deleting}
          onPress={confirmDeleteAccount}
          style={({ pressed }) => [
            styles.deleteButton,
            { borderColor: palette.danger },
            pressed && { opacity: 0.7 },
          ]}
        >
          {deleting ? (
            <LoadingIndicator
              color={palette.danger}
              palette={palette}
              variant="inline"
            />
          ) : (
            <Ionicons color={palette.danger} name="trash-outline" size={18} />
          )}
          <Text style={[styles.signOutText, { color: palette.danger }]}>
            {t("auth.account.delete")}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileAvatar({
  avatarUrl,
  displayName,
  palette,
}: Readonly<{
  avatarUrl: string | null;
  displayName: string;
  palette: ReturnType<typeof useAppPalette>;
}>) {
  if (avatarUrl) {
    return (
      <Image
        contentFit="cover"
        source={{ uri: avatarUrl }}
        style={styles.avatar}
      />
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        styles.avatarFallback,
        { backgroundColor: palette.accentSoft },
      ]}
    >
      <Text style={[styles.avatarInitial, { color: palette.accent }]}>
        {displayName.trim().charAt(0).toLocaleUpperCase() || "i"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  identity: { alignItems: "center", paddingBottom: spacing.xl },
  avatar: { borderRadius: 42, height: 84, width: 84 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 32, fontWeight: "700" },
  displayName: { fontSize: 24, fontWeight: "700", marginTop: spacing.md },
  username: { fontSize: 14, marginTop: spacing.xxs },
  secondaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.xl,
    minHeight: 50,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: "600" },
  signOutButton: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 50,
  },
  signOutText: { fontSize: 15, fontWeight: "700" },
  deleteButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 50,
  },
  skillsState: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  skillsStateText: { fontSize: 14, textAlign: "center" },
  skillRetry: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  skillRetryText: { fontSize: 14, fontWeight: "600" },
  skillsGroupLabel: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  skillItem: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingVertical: spacing.sm,
  },
  skillItemIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  skillItemCopy: { flex: 1, minWidth: 0 },
  skillItemTitle: { fontSize: 15, fontWeight: "700" },
  skillItemDetail: { fontSize: 12, marginTop: 3 },
});

function OwnedSkillsSection({
  palette,
  skills,
  onWithdraw,
}: Readonly<{
  palette: ReturnType<typeof useAppPalette>;
  skills: readonly SkillMarketOwnedPublication[];
  onWithdraw: (skill: SkillMarketOwnedPublication) => void;
}>) {
  const { t } = useI18n();
  const reviewing = useMemo(
    () =>
      skills.filter((skill) => skill.reviewing || skill.status === "reviewing"),
    [skills],
  );
  const uploaded = useMemo(
    () => skills.filter((skill) => skill.published || !skill.reviewing),
    [skills],
  );
  if (skills.length === 0) {
    return (
      <Text style={[styles.skillsStateText, { color: palette.textSecondary }]}>
        {t("auth.account.mySkillsEmpty")}
      </Text>
    );
  }
  return (
    <View>
      <Text style={[styles.skillsGroupLabel, { color: palette.textSecondary }]}>
        {t("auth.account.mySkillsUploaded")}
      </Text>
      {uploaded.length === 0 ? (
        <Text
          style={[styles.skillsStateText, { color: palette.textSecondary }]}
        >
          {t("auth.account.mySkillsNoneUploaded")}
        </Text>
      ) : (
        uploaded.map((skill) => (
          <OwnedSkillRow
            key={skill.entryId}
            onWithdraw={onWithdraw}
            palette={palette}
            skill={skill}
          />
        ))
      )}
      <Text style={[styles.skillsGroupLabel, { color: palette.textSecondary }]}>
        {t("auth.account.mySkillsReviewing")}
      </Text>
      {reviewing.length === 0 ? (
        <Text
          style={[styles.skillsStateText, { color: palette.textSecondary }]}
        >
          {t("auth.account.mySkillsNoneReviewing")}
        </Text>
      ) : (
        reviewing.map((skill) => (
          <OwnedSkillRow
            key={skill.entryId}
            onWithdraw={onWithdraw}
            palette={palette}
            skill={skill}
          />
        ))
      )}
    </View>
  );
}

function OwnedSkillRow({
  palette,
  skill,
  onWithdraw,
}: Readonly<{
  palette: ReturnType<typeof useAppPalette>;
  skill: SkillMarketOwnedPublication;
  onWithdraw: (skill: SkillMarketOwnedPublication) => void;
}>) {
  const { t } = useI18n();
  const statusLabel =
    skill.status === "published"
      ? t("auth.account.mySkillsStatusPublished")
      : skill.status === "reviewing"
        ? t("auth.account.mySkillsStatusReviewing")
        : skill.status === "rejected"
          ? t("auth.account.mySkillsStatusRejected")
          : skill.status === "withdrawn"
            ? t("auth.account.mySkillsStatusWithdrawn")
            : t("auth.account.mySkillsStatusSuspended");
  return (
    <View style={[styles.skillItem, { borderBottomColor: palette.border }]}>
      <View
        style={[styles.skillItemIcon, { backgroundColor: palette.accentSoft }]}
      >
        <AppIcon color={palette.accent} name="sparkles-outline" size={18} />
      </View>
      <View style={styles.skillItemCopy}>
        <Text
          numberOfLines={1}
          style={[styles.skillItemTitle, { color: palette.text }]}
        >
          {skill.title}
        </Text>
        <Text
          numberOfLines={2}
          style={[styles.skillItemDetail, { color: palette.textSecondary }]}
        >
          {skill.skillId} · {statusLabel}
        </Text>
      </View>
      {skill.canWithdraw ? (
        <IconButton
          disabled={false}
          icon="arrow-undo-outline"
          label={t("auth.account.mySkillsWithdraw")}
          onPress={() => onWithdraw(skill)}
          palette={palette}
        />
      ) : null}
    </View>
  );
}

async function confirmWithdrawSkill(
  skill: SkillMarketOwnedPublication,
  options: Readonly<{
    translate: (key: MessageKey) => string;
    withdrawingEntryId: string | null;
    setWithdrawingEntryId: (value: string | null) => void;
    withdraw: (entryId: string, expectedRevision: string) => Promise<unknown>;
    reload: () => Promise<void>;
  }>,
) {
  if (options.withdrawingEntryId !== null) return;
  Alert.alert(
    options.translate("auth.account.mySkillsWithdrawTitle"),
    options.translate("auth.account.mySkillsWithdrawDetail"),
    [
      { text: options.translate("auth.account.cancel"), style: "cancel" },
      {
        text: options.translate("auth.account.mySkillsWithdraw"),
        style: "destructive",
        onPress: () => {
          options.setWithdrawingEntryId(skill.entryId);
          void options
            .withdraw(skill.entryId, skill.revision)
            .then(
              () => options.reload(),
              () =>
                Alert.alert(
                  options.translate("auth.account.mySkillsWithdrawFailed"),
                  options.translate("auth.error.network"),
                ),
            )
            .finally(() => options.setWithdrawingEntryId(null));
        },
      },
    ],
  );
}

function accountDeletionErrorKey(code: AuthenticationErrorCode) {
  switch (code) {
    case "network":
      return "auth.error.network" as const;
    case "secure_storage":
      return "auth.error.secureStorage" as const;
    case "session_expired":
      return "auth.error.sessionExpired" as const;
    default:
      return "auth.error.server" as const;
  }
}

function accountRoleLabel(
  role: AuthenticatedAdminRole | null,
  translate: (key: MessageKey) => string,
): string {
  switch (role) {
    case "admin":
      return translate("auth.account.roleAdmin");
    case "reviewer":
      return translate("auth.account.roleReviewer");
    case "viewer":
      return translate("auth.account.roleViewer");
    default:
      return translate("auth.account.roleUser");
  }
}
