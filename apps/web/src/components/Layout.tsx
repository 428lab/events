import { useEffect, useState } from "react";
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
  Tooltip,
  Typography,
  ListSubheader,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { useBundleReload } from "../lib/useBundleReload.js";
import { useNavCollapse } from "../lib/useNavCollapse.js";
import type { User } from "@eventer/shared";
import { useIsAdmin, useLogout } from "../api/hooks.js";
import { useAdminInquiryUnreadCount } from "../api/inquiryHooks.js";
import { useAbuseUnreviewedCount } from "../api/abuseHooks.js";
import { ThemeSwitcher } from "./ThemeSwitcher.js";
import { NotificationBell } from "./NotificationBell.js";
import { LogoGlyph } from "./LogoGlyph.js";
import { VersionFooter } from "./VersionFooter.js";

/**
 * 横並びナビとハンバーガーで同じものを出すため、項目は1か所で定義する。
 * （別々に書いていると片方に追加し忘れて到達できない項目ができる）
 */
const NAV_ITEMS = [
  { to: "/communities", label: "コミュニティ" },
  { to: "/venues", label: "会場" },
  { to: "/decks", label: "スライド" },
  { to: "/live-sets", label: "配信" },
  // マイページは自分のプロフィールページに統合したので、ここは設定に置き換えた。
  // 自分のページへは右上のアイコンから行く (#319)
  { to: "/account", label: "設定" },
] as const;

type AdminItem = {
  to: string;
  label: string;
  /** 未読件数バッジの種別 */
  badge?: "inquiry" | "abuse";
};

const ADMIN_ITEMS: readonly AdminItem[] = [
  { to: "/admin/inquiries", label: "問い合わせ管理", badge: "inquiry" },
  { to: "/admin/settings", label: "運用設定" },
  { to: "/admin/kpi", label: "KPI" },
  { to: "/admin/trending", label: "注目" },
  { to: "/admin/stats", label: "統計" },
  { to: "/admin/abuse", label: "要確認", badge: "abuse" },
  { to: "/admin/moderation", label: "コンテンツの対処" },
  { to: "/admin/audit-logs", label: "監査ログ" },
];

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
  // 異常行動の未確認件数 (#259)。「運用」のバッジは1つしか出せないので合算するが、
  // 合算値だけだと内訳（問い合わせなのか要確認なのか）が分からないため
  // ツールチップで内訳を出す。メニューを開けば項目ごとの件数も見える
  const { data: abuseUnread } = useAbuseUnreviewedCount(isAdmin);
  const adminBadge = (adminUnread ?? 0) + (abuseUnread ?? 0);
  const adminBadgeTitle = adminBadge
    ? `問い合わせ未読 ${adminUnread ?? 0} 件 / 要確認 ${abuseUnread ?? 0} 件`
    : "";
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const closeMenu = () => setAnchor(null);
  const doLogout = () =>
    logout.mutate(undefined, { onSuccess: () => navigate("/login") });
  const badgeCount = (kind: AdminItem["badge"]) =>
    kind === "inquiry" ? (adminUnread ?? 0) : kind === "abuse" ? (abuseUnread ?? 0) : 0;

  // 幅に収まらなくなったらハンバーガーへ畳む (#316)
  const { containerRef, contentRef, collapsed } = useNavCollapse<
    HTMLDivElement,
    HTMLDivElement
  >();

  // 表示形態が切り替わったら、開きっぱなしのメニューは閉じる。
  // 消えた要素にアンカーされたままにしないため
  useEffect(() => {
    if (collapsed) setAdminAnchor(null);
    else setAnchor(null);
  }, [collapsed]);

  return (
    <Box sx={{ minHeight: "100vh", overflowX: "hidden" }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 0.5 }}>
          {/* 幅が足りないときはロゴ文字から先に詰める（右側の操作系を守る） */}
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

          {/* デスクトップ: 横並びナビ。
              収まらなくなったら畳むが、幅を測り続けるため DOM には残す */}
          <Box
            ref={containerRef}
            sx={{
              // flex-basis は 0。畳んでいる（= 見えない）ナビの幅を
              // 主張してロゴを押し縮めないようにする。
              // ここの幅がそのまま「ナビに使える幅」になる
              flex: "1 1 0%",
              minWidth: 0,
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              overflow: "hidden",
            }}
          >
            <Box
              ref={contentRef}
              aria-hidden={collapsed || undefined}
              sx={{
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
                visibility: collapsed ? "hidden" : "visible",
                pointerEvents: collapsed ? "none" : undefined,
              }}
            >
              {isAdmin && (
                <Chip
                  label="運営管理者"
                  size="small"
                  color="secondary"
                  sx={{ mr: 0.5, color: "#fff" }}
                />
              )}
              {NAV_ITEMS.map((item) => (
                <Button
                  key={item.to}
                  color="inherit"
                  component={RouterLink}
                  to={item.to}
                  sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
                >
                  {item.label}
                </Button>
              ))}
              {isAdmin && (
                <Tooltip title={adminBadgeTitle}>
                  <Button
                    color="inherit"
                    onClick={(e) => setAdminAnchor(e.currentTarget)}
                    endIcon={<ExpandMoreIcon />}
                    sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
                  >
                    <Badge badgeContent={adminBadge} color="error">
                      運用
                    </Badge>
                  </Button>
                </Tooltip>
              )}
              <Button
                color="inherit"
                onClick={doLogout}
                sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
              >
                ログアウト
              </Button>
            </Box>
          </Box>

          {/* お知らせ・テーマ・アカウントとハンバーガーは常に手前に残す */}
          <Box
            sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}
          >
            <NotificationBell />
            <ThemeSwitcher />
            {/* 自分のページを開く。設定は横並びナビ／メニューの「設定」から (#319) */}
            <Avatar
              component={RouterLink}
              to={`/users/${encodeURIComponent(user.username)}`}
              src={user.avatarUrl ?? undefined}
              title="自分のプロフィール"
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
            {collapsed && (
              <IconButton
                color="inherit"
                edge="end"
                onClick={(e) => setAnchor(e.currentTarget)}
                aria-label="メニュー"
              >
                <MenuIcon />
              </IconButton>
            )}
          </Box>

          <Menu
            anchorEl={adminAnchor}
            open={Boolean(adminAnchor)}
            onClose={() => setAdminAnchor(null)}
          >
            {ADMIN_ITEMS.map((item) => (
              <MenuItem
                key={item.to}
                component={RouterLink}
                to={item.to}
                onClick={() => setAdminAnchor(null)}
              >
                {item.label}
                {Boolean(badgeCount(item.badge)) && (
                  <Chip
                    size="small"
                    color="error"
                    label={badgeCount(item.badge)}
                    sx={{ ml: 1, height: 18 }}
                  />
                )}
              </MenuItem>
            ))}
          </Menu>

          {/* 折りたたみ時のメニュー。横並びナビの項目をすべて含む */}
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
            {NAV_ITEMS.map((item) => (
              <MenuItem
                key={item.to}
                component={RouterLink}
                to={item.to}
                onClick={closeMenu}
              >
                {item.label}
              </MenuItem>
            ))}
            <MenuItem
              component={RouterLink}
              to="/notifications"
              onClick={closeMenu}
            >
              お知らせ
            </MenuItem>
            <MenuItem component={RouterLink} to="/inquiries" onClick={closeMenu}>
              お問い合わせ
            </MenuItem>
            {isAdmin && (
              <ListSubheader sx={{ lineHeight: "32px", bgcolor: "transparent" }}>
                運用
              </ListSubheader>
            )}
            {isAdmin &&
              ADMIN_ITEMS.map((item) => (
                <MenuItem
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  onClick={closeMenu}
                  sx={{ pl: 3 }}
                >
                  {item.label}
                  {Boolean(badgeCount(item.badge)) && (
                    <Chip
                      size="small"
                      color="error"
                      label={badgeCount(item.badge)}
                      sx={{ ml: 1, height: 18 }}
                    />
                  )}
                </MenuItem>
              ))}
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
