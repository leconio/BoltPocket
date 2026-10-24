import { useColorScheme } from "react-native";

export type AppPalette = {
  background: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentPressed: string;
  accentSoft: string;
  accentText: string;
  overlay: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  addition: string;
  additionSoft: string;
  deletion: string;
  deletionSoft: string;
  codeSurface: string;
};

const light: AppPalette = {
  background: "#f7f7f5",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  text: "#171816",
  textSecondary: "#62645f",
  textTertiary: "#6f716c",
  border: "#e6e7e2",
  borderStrong: "#d4d6cf",
  accent: "#176b55",
  accentPressed: "#105441",
  accentSoft: "#e4f2ec",
  accentText: "#ffffff",
  overlay: "rgba(20, 22, 19, 0.42)",
  danger: "#b83b3b",
  dangerSoft: "#faeaea",
  success: "#277558",
  successSoft: "#e5f4ed",
  addition: "#176b45",
  additionSoft: "#e5f5eb",
  deletion: "#a93434",
  deletionSoft: "#fbeaea",
  codeSurface: "#f0f1ed",
};

const dark: AppPalette = {
  background: "#111210",
  surface: "#1a1b18",
  surfaceRaised: "#22231f",
  text: "#f0f1ed",
  textSecondary: "#b3b5ae",
  textTertiary: "#858880",
  border: "#30322d",
  borderStrong: "#41443d",
  accent: "#72c5a7",
  accentPressed: "#91d4ba",
  accentSoft: "#173e32",
  accentText: "#0b241c",
  overlay: "rgba(0, 0, 0, 0.66)",
  danger: "#f08b87",
  dangerSoft: "#472221",
  success: "#75c5a5",
  successSoft: "#183b30",
  addition: "#7bd2a0",
  additionSoft: "#173727",
  deletion: "#f0938f",
  deletionSoft: "#42201f",
  codeSurface: "#20221e",
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

export function useAppPalette() {
  return useColorScheme() === "dark" ? dark : light;
}
