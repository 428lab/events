import {
  AppBar,
  Avatar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import type { User } from "@eventer/shared";
import { useLogout } from "../api/hooks.js";

export function Layout({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "grey.50" }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/me"
            sx={{ color: "inherit", textDecoration: "none", fontWeight: 700 }}
          >
            events lab
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Button color="inherit" component={RouterLink} to="/events">
            イベント
          </Button>
          <Button color="inherit" component={RouterLink} to="/me">
            マイページ
          </Button>
          <Avatar
            src={user.avatarUrl ?? undefined}
            sx={{ width: 32, height: 32, mx: 1 }}
          >
            {(user.globalName ?? user.username).charAt(0)}
          </Avatar>
          <Button
            color="inherit"
            onClick={() =>
              logout.mutate(undefined, { onSuccess: () => navigate("/login") })
            }
          >
            ログアウト
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        {children}
      </Container>
    </Box>
  );
}
