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
  ListSubheader,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { useBundleReload } from "../lib/useBundleReload.js";
import type { User } from "@eventer/shared";
import { useIsAdmin, useLogout } from "../api/hooks.js";
import { useAdminInquiryUnreadCount } from "../api/inquiryHooks.js";
import { useAbuseUnreviewedCount } from "../api/abuseHooks.js";
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
  const { pathname } = useLocation();
  // デプロイ後の古いバンドルは次の遷移で自動リロード (#143)
  useBundleReload();
  // スライド/配信セット編集は作業領域を最大化するため全幅
  const wide =
    (pathname.startsWith("/decks/") || pathname.startsWith("/live-sets/")) &&
    pathname.endsWith("/edit");
  const isAdmin = useIsAdmin();
  const [adminAnchor, setAdminAnchor] = useState<null | HTMLElement>(null);
  const { data: adminUnread } = useAdminInquiryUnreadCount(isAdmin);
  // 異常行動の未確認件数 (#259)。「運用」のバッジは問い合わせと合算して出す
  const { data: abuseUnread } = useAbuseUnreviewedCount(isAdmin);
  const adminBadge = (adminUnread ?? 0) + (abuseUnread ?? 0);
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
            to="/"
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
            <Button color="inherit" component={RouterLink} to="/communities">
              コミュニティ
            </Button>
            <Button color="inherit" component={RouterLink} to="/venues">
              会場
            </Button>
            <Button color="inherit" component={RouterLink} to="/decks">
              スライド
            </Button>
            <Button color="inherit" component={RouterLink} to="/live-sets">
              配信
            </Button>
            <Button color="inherit" component={RouterLink} to="/me">
              マイページ
            </Button>
            {isAdmin && (
              <>
                <Button
                  color="inherit"
                  onClick={(e) => setAdminAnchor(e.currentTarget)}
                  endIcon={<ExpandMoreIcon />}
                >
                  <Badge badgeContent={adminBadge} color="error">
                    運用
                  </Badge>
                </Button>
                <Menu
                  anchorEl={adminAnchor}
                  open={Boolean(adminAnchor)}
                  onClose={() => setAdminAnchor(null)}
                >
                  <MenuItem
                    component={RouterLink}
                    to="/admin/inquiries"
                    onClick={() => setAdminAnchor(null)}
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
                  <MenuItem
                    component={RouterLink}
                    to="/admin/settings"
                    onClick={() => setAdminAnchor(null)}
                  >
                    運用設定
                  </MenuItem>
                  <MenuItem
                    component={RouterLink}
                    to="/admin/kpi"
                    onClick={() => setAdminAnchor(null)}
                  >
                    KPI
                  </MenuItem>
                  <MenuItem
                    component={RouterLink}
                    to="/admin/stats"
                    onClick={() => setAdminAnchor(null)}
                  >
                    統計
                  </MenuItem>
                  <MenuItem
                    component={RouterLink}
                    to="/admin/abuse"
                    onClick={() => setAdminAnchor(null)}
                  >
                    要確認
                    {Boolean(abuseUnread) && (
                      <Chip
                        size="small"
                        color="error"
                        label={abuseUnread}
                        sx={{ ml: 1, height: 18 }}
                      />
                    )}
                  </MenuItem>
                  <MenuItem
                    component={RouterLink}
                    to="/admin/audit-logs"
                    onClick={() => setAdminAnchor(null)}
                  >
                    監査ログ
                  </MenuItem>
                </Menu>
              </>
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
            <MenuItem component={RouterLink} to="/communities" onClick={closeMenu}>
              コミュニティ
            </MenuItem>
            <MenuItem component={RouterLink} to="/venues" onClick={closeMenu}>
              会場
            </MenuItem>
            <MenuItem component={RouterLink} to="/decks" onClick={closeMenu}>
              スライド
            </MenuItem>
            <MenuItem component={RouterLink} to="/live-sets" onClick={closeMenu}>
              配信
            </MenuItem>
            <MenuItem component={RouterLink} to="/me" onClick={closeMenu}>
              マイページ
            </MenuItem>
            <MenuItem component={RouterLink} to="/inquiries" onClick={closeMenu}>
              お問い合わせ
            </MenuItem>
            {isAdmin && (
              <ListSubheader sx={{ lineHeight: "32px", bgcolor: "transparent" }}>
                運用
              </ListSubheader>
            )}
            {isAdmin && (
              <MenuItem
                component={RouterLink}
                to="/admin/inquiries"
                onClick={closeMenu}
                sx={{ pl: 3 }}
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
            {isAdmin && (
              <MenuItem component={RouterLink} to="/admin/kpi" onClick={closeMenu} sx={{ pl: 3 }}>
                KPI
              </MenuItem>
            )}
            {isAdmin && (
              <MenuItem component={RouterLink} to="/admin/stats" onClick={closeMenu} sx={{ pl: 3 }}>
                統計
              </MenuItem>
            )}
            {isAdmin && (
              <MenuItem
                component={RouterLink}
                to="/admin/settings"
                onClick={closeMenu}
                sx={{ pl: 3 }}
              >
                運用設定
              </MenuItem>
            )}
            {isAdmin && (
              <MenuItem
                component={RouterLink}
                to="/admin/abuse"
                onClick={closeMenu}
                sx={{ pl: 3 }}
              >
                要確認
                {Boolean(abuseUnread) && (
                  <Chip
                    size="small"
                    color="error"
                    label={abuseUnread}
                    sx={{ ml: 1, height: 18 }}
                  />
                )}
              </MenuItem>
            )}
            {isAdmin && (
              <MenuItem
                component={RouterLink}
                to="/admin/audit-logs"
                onClick={closeMenu}
                sx={{ pl: 3 }}
              >
                監査ログ
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
      <Container maxWidth={wide ? false : "md"} sx={{ py: 4 }}>
        {children}
      </Container>
      <VersionFooter />
    </Box>
  );
}
