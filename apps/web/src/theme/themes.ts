import { createTheme, type Theme } from "@mui/material/styles";

const font = '"Plus Jakarta Sans", system-ui, sans-serif';

export interface ThemeTokens {
  mode: "light" | "dark";
  primary: string;
  primaryDark: string;
  primaryText: string;
  secondary: string;
  secondaryText: string;
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  border: string;
  appbarFrom: string;
  appbarTo: string;
}

function makeTheme(t: ThemeTokens): Theme {
  return createTheme({
    palette: {
      mode: t.mode,
      primary: { main: t.primary, dark: t.primaryDark, contrastText: t.primaryText },
      secondary: { main: t.secondary, contrastText: t.secondaryText },
      success: { main: "#34D399" },
      warning: { main: "#FBBF24" },
      error: { main: "#FB7185" },
      text: { primary: t.text, secondary: t.muted },
      background: { default: t.bg, paper: t.surface },
      divider: t.border,
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: font,
      h3: { fontWeight: 800, letterSpacing: "-0.02em" },
      h4: { fontWeight: 800, letterSpacing: "-0.02em" },
      h5: { fontWeight: 800, letterSpacing: "-0.01em" },
      h6: { fontWeight: 700, letterSpacing: "-0.01em" },
      subtitle1: { fontWeight: 700 },
      subtitle2: { fontWeight: 700 },
      button: { fontWeight: 700, letterSpacing: "0.02em" },
      body1: { lineHeight: 1.6 },
      overline: { fontWeight: 700, letterSpacing: "0.08em" },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 999, textTransform: "none", paddingInline: 18 },
          containedPrimary: { "&:hover": { backgroundColor: t.primaryDark } },
        },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 999, fontWeight: 700 } } },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          root: {
            backgroundColor: t.surface,
            borderColor: t.border,
            borderRadius: 14,
            backgroundImage: "none",
          },
        },
      },
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: "none" }, rounded: { borderRadius: 14 } },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: `linear-gradient(90deg, ${t.appbarFrom} 0%, ${t.appbarTo} 60%)`,
            borderBottom: `1px solid ${t.border}`,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: { root: { backgroundColor: t.surface2 } },
      },
    },
  });
}

export interface ThemeDef {
  key: string;
  label: string;
  theme: Theme;
  /** 背景花火に使う色（暗いテーマのみ） */
  fireworks: string[] | null;
}

export const THEMES: Record<string, ThemeDef> = {
  natsumatsuri: {
    key: "natsumatsuri",
    label: "夏祭り",
    fireworks: ["#2DD4BF", "#FB923C", "#FB7185", "#FBBF24", "#FFFFFF"],
    theme: makeTheme({
      mode: "dark",
      primary: "#2DD4BF",
      primaryDark: "#14B8A6",
      primaryText: "#06231D",
      secondary: "#FB923C",
      secondaryText: "#2A1400",
      bg: "#0E1426",
      surface: "#1A2238",
      surface2: "#222C46",
      text: "#EAF0F7",
      muted: "#97A3BC",
      border: "#2A3350",
      appbarFrom: "#0B3A34",
      appbarTo: "#0E1426",
    }),
  },
  neon: {
    key: "neon",
    label: "ネオン",
    fireworks: ["#22D3EE", "#E879F9", "#A78BFA", "#FFFFFF"],
    theme: makeTheme({
      mode: "dark",
      primary: "#22D3EE",
      primaryDark: "#06B6D4",
      primaryText: "#04181C",
      secondary: "#E879F9",
      secondaryText: "#2A0A2E",
      bg: "#0B0A1F",
      surface: "#17152E",
      surface2: "#221F40",
      text: "#ECEAFF",
      muted: "#9D98C7",
      border: "#2C2950",
      appbarFrom: "#3B1E63",
      appbarTo: "#0B0A1F",
    }),
  },
  sakura: {
    key: "sakura",
    label: "桜",
    fireworks: null,
    theme: makeTheme({
      mode: "light",
      primary: "#EC4899",
      primaryDark: "#DB2777",
      primaryText: "#FFFFFF",
      secondary: "#F59E0B",
      secondaryText: "#2A1400",
      bg: "#FFF5F8",
      surface: "#FFFFFF",
      surface2: "#FFFFFF",
      text: "#3A1530",
      muted: "#9C7088",
      border: "#F3D6E2",
      appbarFrom: "#F472B6",
      appbarTo: "#EC4899",
    }),
  },
  cool: {
    key: "cool",
    label: "クール",
    fireworks: null,
    theme: makeTheme({
      mode: "light",
      primary: "#4F46E5",
      primaryDark: "#4338CA",
      primaryText: "#FFFFFF",
      secondary: "#06B6D4",
      secondaryText: "#04222A",
      bg: "#F6F7FB",
      surface: "#FFFFFF",
      surface2: "#FFFFFF",
      text: "#0E1020",
      muted: "#6B7280",
      border: "#E6E8EF",
      appbarFrom: "#4F46E5",
      appbarTo: "#6D5DF6",
    }),
  },
};

export const DEFAULT_THEME_KEY = "natsumatsuri";
export const THEME_LIST = Object.values(THEMES);
