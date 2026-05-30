import { createTheme } from "@mui/material/styles";

// DESIGN.md "Natsumatsuri（夏祭り）": 夜祭のダーク基調 × 提灯ティール × 灯りのアンバー
const night = "#0E1426"; // 夜空（背景）
const surface = "#1A2238"; // 提灯まわりの面
const surface2 = "#222C46";
const teal = "#2DD4BF"; // 提灯の灯り（ブランド/操作）
const tealDark = "#14B8A6";
const amber = "#FB923C"; // 灯り・お祭りアクセント
const textHigh = "#EAF0F7";
const textMuted = "#97A3BC";
const line = "#2A3350";

const font = '"Plus Jakarta Sans", system-ui, sans-serif';

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: teal, dark: tealDark, contrastText: "#06231D" },
    secondary: { main: amber, contrastText: "#2A1400" },
    success: { main: "#34D399" },
    warning: { main: "#FBBF24" },
    error: { main: "#FB7185" },
    text: { primary: textHigh, secondary: textMuted },
    background: { default: night, paper: surface },
    divider: line,
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
        containedPrimary: { "&:hover": { backgroundColor: tealDark } },
      },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 999, fontWeight: 700 } },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: {
          backgroundColor: surface,
          borderColor: line,
          borderRadius: 14,
          backgroundImage: "none",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
        rounded: { borderRadius: 14 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: `linear-gradient(90deg, #0B3A34 0%, ${night} 60%)`,
          borderBottom: `1px solid ${line}`,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { backgroundColor: surface2 } },
    },
  },
});
