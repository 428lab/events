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
import { ThemeSwitcher } from "./ThemeSwitcher.js";
import { VersionFooter } from "./VersionFooter.js";

/** 未ログインの公開ページ用の軽量レイアウト（ログイン導線のみ） */
export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", overflowX: "hidden" }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 0.5 }}>
          <Box
            component={RouterLink}
            to="/"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <Box
              component="img"
              src="/logo.svg"
              alt=""
              sx={{ width: 30, height: 30, borderRadius: 1, display: "block" }}
            />
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
              bgcolor: "#FB923C",
              color: "#0E1426",
            }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <ThemeSwitcher />
          <Button color="inherit" component={RouterLink} to="/login">
            ログイン
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        {children}
      </Container>
      <VersionFooter />
    </Box>
  );
}
