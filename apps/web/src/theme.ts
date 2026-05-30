import { createTheme } from "@mui/material/styles";

// DESIGN.md "Spotlight" の design tokens を MUI テーマに反映
const ink = "#0E1020";
const indigo = "#4F46E5";
const indigoDark = "#4338CA";
const rose = "#F43F75";
const neutral = "#F6F7FB";
const border = "#E6E8EF";
const muted = "#6B7280";

const font = '"Plus Jakarta Sans", system-ui, sans-serif';

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: indigo, dark: indigoDark, contrastText: "#FFFFFF" },
    secondary: { main: rose, contrastText: "#FFFFFF" },
    success: { main: "#16A34A" },
    warning: { main: "#D97706" },
    text: { primary: ink, secondary: muted },
    background: { default: neutral, paper: "#FFFFFF" },
    divider: border,
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
        containedPrimary: {
          "&:hover": { backgroundColor: indigoDark },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 999, fontWeight: 600 } },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: { borderColor: border, borderRadius: 14 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: `linear-gradient(90deg, ${indigo}, #6D5DF6)`,
        },
      },
    },
    MuiPaper: {
      styleOverrides: { rounded: { borderRadius: 14 } },
    },
  },
});
