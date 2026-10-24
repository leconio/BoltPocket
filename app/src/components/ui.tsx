import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type SwitchProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, type IconName } from "@/components/app-icon";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useI18n } from "@/i18n/i18n-provider";
import { radii, spacing, type AppPalette } from "@/theme/tokens";

export type { IconName } from "@/components/app-icon";

type IconButtonProps = {
  icon: IconName;
  label: string;
  palette: AppPalette;
  onPress: () => void;
  filled?: boolean;
  disabled?: boolean;
};

export function IconButton({
  icon,
  label,
  palette,
  onPress,
  filled = false,
  disabled = false,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        filled && { backgroundColor: palette.text },
        pressed && { opacity: 0.64 },
        disabled && { opacity: 0.34 },
      ]}
    >
      <AppIcon
        color={filled ? palette.background : palette.text}
        name={icon}
        size={20}
      />
    </Pressable>
  );
}

export function AppSwitch({ hitSlop = 8, style, ...props }: SwitchProps) {
  return (
    <View style={[styles.switchTarget, style]}>
      <Switch {...props} hitSlop={hitSlop} />
    </View>
  );
}

type HeaderProps = {
  palette: AppPalette;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
};

export function ScreenHeader({
  palette,
  title,
  subtitle,
  onBack,
  right,
}: HeaderProps) {
  const { t } = useI18n();
  const [leftActionWidth, setLeftActionWidth] = useState(onBack ? 44 : 0);
  const [rightActionWidth, setRightActionWidth] = useState(0);
  const measureLeftActions = useCallback((event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setLeftActionWidth((current) => (current === width ? current : width));
  }, []);
  const measureRightActions = useCallback((event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setRightActionWidth((current) => (current === width ? current : width));
  }, []);
  const balancedActionInset =
    spacing.xs + Math.max(leftActionWidth, rightActionWidth) + spacing.xxs;

  return (
    <View
      style={[
        styles.header,
        {
          borderBottomColor: palette.border,
          paddingHorizontal: balancedActionInset,
        },
      ]}
    >
      <View
        onLayout={measureLeftActions}
        style={[styles.headerSide, styles.headerLeft]}
      >
        {onBack ? (
          <IconButton
            icon="chevron-back"
            label={t("common.navigation.back")}
            onPress={onBack}
            palette={palette}
          />
        ) : null}
      </View>
      <View style={styles.headerTitleWrap}>
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={[styles.headerTitle, { color: palette.text }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={2}
            style={[styles.headerSubtitle, { color: palette.textSecondary }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View
        onLayout={measureRightActions}
        style={[styles.headerSide, styles.headerRight]}
      >
        {right}
      </View>
    </View>
  );
}

type BottomSheetProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  palette: AppPalette;
  onClose: () => void;
  onDismiss?: () => void;
}>;

export function BottomSheet({
  visible,
  title,
  palette,
  onClose,
  onDismiss,
  children,
}: BottomSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: viewportHeight } = useWindowDimensions();
  const [transition] = useState(() => new Animated.Value(0));
  const renderedRef = useRef(visible);
  const visibleRef = useRef(visible);
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    visibleRef.current = visible;
    transition.stopAnimation();
    if (visible) {
      const needsMount = !renderedRef.current;
      if (!renderedRef.current) {
        renderedRef.current = true;
      }
      if (reduceMotion) {
        transition.setValue(1);
        if (!needsMount) return;
        const frame = requestAnimationFrame(() => setRendered(true));
        return () => cancelAnimationFrame(frame);
      }
      const animation = Animated.timing(transition, {
        duration: 240,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      });
      const frame = requestAnimationFrame(() => {
        if (needsMount) setRendered(true);
        animation.start();
      });
      return () => {
        cancelAnimationFrame(frame);
        animation.stop();
      };
    }
    if (!renderedRef.current) {
      transition.setValue(0);
      return;
    }
    if (reduceMotion) {
      transition.setValue(0);
      const frame = requestAnimationFrame(() => {
        if (!visibleRef.current) {
          renderedRef.current = false;
          setRendered(false);
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    const animation = Animated.timing(transition, {
      duration: 180,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    });
    const finishDismissal = () => {
      if (!visibleRef.current) {
        renderedRef.current = false;
        setRendered(false);
      }
    };
    // Fabric can stop a native-driver completion callback during a Modal
    // transition. Keep a JS fallback so a dismissed sheet cannot remain as a
    // stale, non-interactive overlay.
    const dismissalFallback = setTimeout(finishDismissal, 260);
    animation.start(({ finished }) => {
      if (finished) finishDismissal();
    });
    return () => {
      clearTimeout(dismissalFallback);
      animation.stop();
    };
  }, [reduceMotion, transition, visible]);

  const sheetTranslateY = transition.interpolate({
    extrapolate: "clamp",
    inputRange: [0, 1],
    outputRange: [Math.max(480, viewportHeight), 0],
  });

  return (
    <Modal
      animationType="none"
      onDismiss={onDismiss}
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={rendered}
    >
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"}
        pointerEvents={visible ? "auto" : "none"}
        style={styles.modalRoot}
      >
        <Animated.View
          pointerEvents={visible ? "auto" : "none"}
          style={[StyleSheet.absoluteFill, { opacity: transition }]}
        >
          <Pressable
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            onPress={onClose}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: palette.overlay },
            ]}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: palette.surface, borderColor: palette.border },
            { transform: [{ translateY: sheetTranslateY }] },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>
              {title}
            </Text>
            <IconButton
              icon="close"
              label={t("common.sheet.close")}
              onPress={onClose}
              palette={palette}
            />
          </View>
          <ScrollView
            automaticallyAdjustKeyboardInsets={false}
            bounces={false}
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: Math.max(spacing.lg, insets.bottom) },
            ]}
            keyboardDismissMode={
              process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type ListRowProps = {
  palette: AppPalette;
  icon: IconName;
  title: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  destructive?: boolean;
  horizontalInset?: boolean;
  secondaryAction?: Readonly<{
    icon: IconName;
    label: string;
    onPress: () => void;
  }>;
};

export function ListRow({
  palette,
  icon,
  title,
  detail,
  value,
  onPress,
  onLongPress,
  destructive = false,
  horizontalInset = false,
  secondaryAction,
}: ListRowProps) {
  const content = (
    <>
      <View
        style={[
          styles.rowIcon,
          {
            backgroundColor: destructive
              ? palette.dangerSoft
              : palette.codeSurface,
          },
        ]}
      >
        <AppIcon
          color={destructive ? palette.danger : palette.textSecondary}
          name={icon}
          size={18}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text
          numberOfLines={3}
          style={[
            styles.rowTitle,
            { color: destructive ? palette.danger : palette.text },
          ]}
        >
          {title}
        </Text>
        {detail ? (
          <Text
            numberOfLines={4}
            style={[styles.rowDetail, { color: palette.textSecondary }]}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, { color: palette.textSecondary }]}>
          {value}
        </Text>
      ) : null}
      {secondaryAction ? (
        <Pressable
          accessibilityLabel={secondaryAction.label}
          accessibilityRole="button"
          hitSlop={6}
          onPress={(event) => {
            event.stopPropagation();
            secondaryAction.onPress();
          }}
          style={({ pressed }) => [
            styles.rowSecondaryAction,
            pressed && { backgroundColor: palette.codeSurface },
          ]}
        >
          <AppIcon
            color={palette.textSecondary}
            name={secondaryAction.icon}
            size={19}
          />
        </Pressable>
      ) : null}
      {onPress ? (
        <AppIcon
          color={palette.textTertiary}
          name="chevron-forward"
          size={17}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[
          styles.row,
          horizontalInset && styles.rowHorizontalInset,
          { borderBottomColor: palette.border },
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={[title, detail, value].filter(Boolean).join(", ")}
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={420}
      style={({ pressed }) => [
        styles.row,
        horizontalInset && styles.rowHorizontalInset,
        { borderBottomColor: palette.border },
        pressed && { backgroundColor: palette.codeSurface },
      ]}
    >
      {content}
    </Pressable>
  );
}

type PillProps = PropsWithChildren<{
  palette: AppPalette;
  onPress?: () => void;
  selected?: boolean;
  icon?: IconName;
}>;

export function Pill({
  palette,
  children,
  onPress,
  selected = false,
  icon,
}: PillProps) {
  const content = (
    <>
      {icon ? (
        <AppIcon
          color={selected ? palette.accent : palette.textSecondary}
          name={icon}
          size={14}
        />
      ) : null}
      <Text
        style={[
          styles.pillText,
          { color: selected ? palette.accent : palette.textSecondary },
        ]}
      >
        {children}
      </Text>
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[
          styles.pill,
          {
            backgroundColor: selected
              ? palette.accentSoft
              : palette.codeSurface,
            borderColor: selected ? palette.accent : palette.border,
          },
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: selected ? palette.accentSoft : palette.codeSurface,
          borderColor: selected ? palette.accent : palette.border,
        },
        pressed && { opacity: 0.65 },
      ]}
    >
      {content}
    </Pressable>
  );
}

export function SectionLabel({
  children,
  palette,
}: PropsWithChildren<{ palette: AppPalette }>) {
  return (
    <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
      {children}
    </Text>
  );
}

export function PageEmptyState({
  action,
  description,
  palette,
  tone = "default",
}: {
  action?: Readonly<{
    icon?: IconName;
    label: string;
    onPress: () => void;
  }>;
  description: string;
  palette: AppPalette;
  tone?: "default" | "error";
}) {
  const isError = tone === "error";
  return (
    <View
      accessibilityLiveRegion={isError ? "polite" : undefined}
      accessibilityRole={isError ? "alert" : undefined}
      style={styles.emptyState}
    >
      <Text
        selectable={isError}
        style={[
          styles.emptyDescription,
          { color: isError ? palette.danger : palette.textSecondary },
        ]}
      >
        {description}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.emptyAction,
            { borderColor: palette.borderStrong },
            pressed && { backgroundColor: palette.codeSurface },
          ]}
        >
          <AppIcon color={palette.text} name={action.icon ?? "add"} size={16} />
          <Text style={[styles.emptyActionText, { color: palette.text }]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  switchTarget: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 51,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 56,
    position: "relative",
  },
  headerSide: {
    bottom: 0,
    justifyContent: "center",
    position: "absolute",
    top: 0,
    zIndex: 1,
  },
  headerLeft: {
    alignItems: "flex-start",
    left: spacing.xs,
  },
  headerRight: {
    alignItems: "center",
    flexDirection: "row",
    right: spacing.xs,
  },
  headerTitleWrap: {
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    minWidth: 0,
    paddingVertical: spacing.xxs,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
    textAlign: "center",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: "82%",
    overflow: "hidden",
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
  },
  sheetContent: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingVertical: spacing.sm,
  },
  rowHorizontalInset: { paddingHorizontal: spacing.md },
  rowIcon: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  rowCopy: {
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 20,
  },
  rowDetail: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  rowValue: {
    fontSize: 13,
    flexShrink: 1,
    fontVariant: ["tabular-nums"],
    maxWidth: 112,
    minWidth: 0,
    textAlign: "right",
  },
  rowSecondaryAction: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  pill: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "500",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.25,
    marginBottom: spacing.xs,
    marginTop: spacing.lg,
    textTransform: "uppercase",
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyDescription: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  emptyAction: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xxs,
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  emptyActionText: { fontSize: 13, fontWeight: "600" },
});
