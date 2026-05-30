import {
  AppBar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

/** 未ログインの公開ページ用の軽量レイアウト（ログイン導線のみ） */
export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ color: "inherit", textDecoration: "none", fontWeight: 700 }}
          >
            events lab
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Button color="inherit" component={RouterLink} to="/login">
            ログイン
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        {children}
      </Container>
    </Box>
  );
}
