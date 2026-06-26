import { useState } from "react";
import {
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import type { User } from "@eventer/shared";
import { useIsAdmin, useLogout } from "../api/hooks.js";
import { useAdminInquiryUnreadCount } from "../api/inquiryHooks.js";
import { ThemeSwitcher } from "./ThemeSwitcher.js";
import { NotificationBell } from "./NotificationBell.js";
import { LogoGlyph } from "./LogoGlyph.js";
import { VersionFooter } from "./VersionFooter.js";

export function Layout({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const logout = useLogout();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { data: adminUnread } = useAdminInquiryUnreadCount(isAdmin);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const closeMenu = () => setAnchor(null);
  const doLogout = () =>
    logout.mutate(undefined, { onSuccess: () => navigate("/login") });

  return (
    <Box sx={{ minHeight: "100vh", overflowX: "hidden" }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 0.5 }}>
          <Box
            component={RouterLink}
            to="/me"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              color: "inherit",
              textDecoration: "none",
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
              bgcolor: "#FB923C",
              color: "#0E1426",
            }}
          />
          <Box sx={{ flexGrow: 1 }} />

          {isAdmin && (
            <Chip
              label="運営管理者"
              size="small"
              color="secondary"
              sx={{ mr: 0.5, color: "#fff", display: { xs: "none", sm: "flex" } }}
            />
          )}

          {/* デスクトップ: 横並びナビ */}
          <Box sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center" }}>
            <Button color="inherit" component={RouterLink} to="/events">
              イベント
            </Button>
            <Button color="inherit" component={RouterLink} to="/me">
              マイページ
            </Button>
            {isAdmin && (
              <Button color="inherit" component={RouterLink} to="/admin/inquiries">
                <Badge badgeContent={adminUnread ?? 0} color="error">
                  問い合わせ管理
                </Badge>
              </Button>
            )}
          </Box>

          <NotificationBell />
          <ThemeSwitcher />
          <Avatar
            component={RouterLink}
            to="/account"
            src={user.avatarUrl ?? undefined}
            title="アカウント設定"
            sx={{
              width: 32,
              height: 32,
              mx: 0.5,
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            {(user.globalName ?? user.username).charAt(0)}
          </Avatar>

          <Button
            color="inherit"
            onClick={doLogout}
            sx={{ display: { xs: "none", sm: "inline-flex" } }}
          >
            ログアウト
          </Button>

          {/* モバイル: ハンバーガーメニュー */}
          <IconButton
            color="inherit"
            edge="end"
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ display: { xs: "inline-flex", sm: "none" } }}
            aria-label="メニュー"
          >
            <MenuIcon />
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
            <MenuItem component={RouterLink} to="/events" onClick={closeMenu}>
              イベント
            </MenuItem>
            <MenuItem component={RouterLink} to="/me" onClick={closeMenu}>
              マイページ
            </MenuItem>
            <MenuItem component={RouterLink} to="/inquiries" onClick={closeMenu}>
              お問い合わせ
            </MenuItem>
            {isAdmin && (
              <MenuItem
                component={RouterLink}
                to="/admin/inquiries"
                onClick={closeMenu}
              >
                問い合わせ管理
                {Boolean(adminUnread) && (
                  <Chip
                    size="small"
                    color="error"
                    label={adminUnread}
                    sx={{ ml: 1, height: 18 }}
                  />
                )}
              </MenuItem>
            )}
            <MenuItem component={RouterLink} to="/account" onClick={closeMenu}>
              アカウント設定
            </MenuItem>
            <MenuItem
              onClick={() => {
                closeMenu();
                doLogout();
              }}
            >
              ログアウト
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        {children}
      </Container>
      <VersionFooter />
    </Box>
  );
}
