import Ionicons from "@react-native-vector-icons/ionicons";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

export type IconName = ComponentProps<typeof Ionicons>["name"];

const sfSymbolByIcon: Partial<Record<IconName, SFSymbol>> = {
  add: "plus",
  "add-circle-outline": "plus.circle",
  "alert-circle": "exclamationmark.circle.fill",
  "aperture-outline": "circle.dotted",
  "apps-outline": "square.grid.2x2",
  "arrow-back": "arrow.left",
  "arrow-forward": "arrow.right",
  "bookmark-outline": "bookmark",
  bookmark: "bookmark.fill",
  "camera-outline": "camera",
  checkmark: "checkmark",
  "checkmark-circle": "checkmark.circle.fill",
  "checkmark-circle-outline": "checkmark.circle",
  "chevron-back": "chevron.left",
  "chevron-down": "chevron.down",
  "chevron-forward": "chevron.right",
  "chevron-up": "chevron.up",
  close: "xmark",
  "cloud-outline": "cloud",
  "code-slash-outline": "chevron.left.forwardslash.chevron.right",
  "compass-outline": "safari",
  "create-outline": "square.and.pencil",
  "document-attach-outline": "doc.badge.plus",
  "document-text-outline": "doc.text",
  "ellipsis-horizontal": "ellipsis",
  "ellipsis-vertical": "ellipsis",
  "extension-puzzle-outline": "puzzlepiece.extension",
  "folder-open-outline": "folder",
  "folder-outline": "folder",
  "git-compare-outline": "arrow.triangle.branch",
  "git-commit-outline": "point.bottomleft.forward.to.point.topright.scurvepath",
  "git-network-outline": "point.3.connected.trianglepath.dotted",
  "globe-outline": "globe",
  "hardware-chip-outline": "cpu",
  "images-outline": "photo.on.rectangle.angled",
  "information-circle-outline": "info.circle",
  "key-outline": "key",
  "language-outline": "character.bubble",
  "layers-outline": "square.3.layers.3d",
  "library-outline": "books.vertical",
  "list-outline": "list.bullet",
  "link-outline": "link",
  "map-outline": "map",
  "open-outline": "arrow.up.right.square",
  "options-outline": "slider.horizontal.3",
  "person-outline": "person",
  pin: "pin.fill",
  "pin-outline": "pin",
  "refresh-outline": "arrow.clockwise",
  refresh: "arrow.clockwise",
  search: "magnifyingglass",
  "shield-checkmark-outline": "checkmark.shield",
  "storefront-outline": "storefront",
  "server-outline": "server.rack",
  "settings-outline": "gear",
  "sparkles-outline": "sparkles",
  "trash-outline": "trash",
};

export function AppIcon({
  color,
  name,
  size = 20,
}: {
  color: ColorValue;
  name: IconName;
  size?: number;
}) {
  const fallback = (
    <Ionicons accessible={false} color={color} name={name} size={size} />
  );
  const symbol = sfSymbolByIcon[name];
  if (process.env.EXPO_OS !== "ios" || !symbol) return fallback;
  return (
    <SymbolView
      accessible={false}
      fallback={fallback}
      importantForAccessibility="no-hide-descendants"
      name={symbol}
      resizeMode="scaleAspectFit"
      size={size}
      tintColor={color}
      weight="regular"
    />
  );
}
