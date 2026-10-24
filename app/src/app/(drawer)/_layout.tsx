import { Drawer } from "expo-router/drawer";
import { useWindowDimensions } from "react-native";

import { AppDrawerContent } from "@/features/navigation/app-drawer-content";
import { useAppPalette } from "@/theme/tokens";

export default function DrawerLayout() {
  const palette = useAppPalette();
  const { width } = useWindowDimensions();

  return (
    <Drawer
      drawerContent={(props) => <AppDrawerContent {...props} />}
      screenOptions={{
        drawerStyle: {
          backgroundColor: palette.surface,
          width: Math.min(width * 0.9, 372),
        },
        drawerType: "front",
        freezeOnBlur: true,
        headerShown: false,
        overlayColor: palette.overlay,
        sceneStyle: { backgroundColor: palette.background },
        swipeEdgeWidth: 48,
      }}
    >
      <Drawer.Screen name="index" />
    </Drawer>
  );
}
