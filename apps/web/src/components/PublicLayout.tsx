import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Toolbar,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ThemeSwitcher } from "./ThemeSwitcher.js";
import { LogoGlyph } from "./LogoGlyph.js";
import { VersionFooter } from "./VersionFooter.js";

/** 未ログインの公開ページ用の軽量レイアウト（ログイン導線のみ） */
export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ minHeight: "100vh", overflowX: "hidden" }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 0.5 }}>
          {/* 幅が足りないときはロゴ文字から先に詰める（右側の導線を守る, #316） */}
          <Box
            component={RouterLink}
            to="/"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              color: "inherit",
              textDecoration: "none",
              minWidth: 0,
            }}
          >
            <LogoGlyph size={34} />
            <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
              events lab
            </Typography>
          </Box>
          <Chip
            label="BETA"
            size="small"
            sx={{
              ml: 1,
              height: 18,
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
              bgcolor: "#FB923C",
              color: "#0E1426",
            }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <ThemeSwitcher />
            <Button
              color="inherit"
              component={RouterLink}
              to="/login"
              sx={{ whiteSpace: "nowrap" }}
            >
              {t("login.signIn")}
            </Button>
          </Box>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        {children}
      </Container>
      <VersionFooter />
    </Box>
  );
}
