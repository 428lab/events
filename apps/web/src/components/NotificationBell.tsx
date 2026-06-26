import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Typography,
} from "@mui/material";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { useNavigate } from "react-router-dom";
import type { Notification } from "@eventer/shared";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useNotificationUnreadCount,
} from "../api/notificationHooks.js";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}日前`;
  return new Date(ts).toLocaleDateString("ja-JP");
}

/** お知らせ（抽選結果・繰り上げ・受賞・問い合わせ返信）の通知ベル。push ではなくアプリ内通知 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const open = Boolean(anchor);
  const { data: count } = useNotificationUnreadCount();
  const { data: notifications } = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const onClickItem = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    setAnchor(null);
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <IconButton
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label="お知らせ"
        title="お知らせ"
      >
        <Badge badgeContent={count ?? 0} color="error">
          <NotificationsNoneIcon />
        </Badge>
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 340, maxWidth: "92vw" } } }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1,
          }}
        >
          <Typography variant="subtitle2" fontWeight={700}>
            お知らせ
          </Typography>
          {Boolean(count) && (
            <Button size="small" onClick={() => markAll.mutate()}>
              すべて既読
            </Button>
          )}
        </Box>
        <Divider />
        {notifications && notifications.length > 0 ? (
          <List dense sx={{ maxHeight: 420, overflowY: "auto", py: 0 }}>
            {notifications.map((n) => (
              <ListItemButton
                key={n.id}
                onClick={() => onClickItem(n)}
                sx={{
                  alignItems: "flex-start",
                  flexDirection: "column",
                  gap: 0.25,
                  bgcolor: n.read ? "transparent" : "action.hover",
                  borderLeft: "3px solid",
                  borderLeftColor: n.read ? "transparent" : "primary.main",
                }}
              >
                <Typography variant="body2" fontWeight={n.read ? 400 : 700}>
                  {n.title}
                </Typography>
                {n.body && (
                  <Typography variant="caption" color="text.secondary">
                    {n.body}
                  </Typography>
                )}
                <Typography variant="caption" color="text.disabled">
                  {relativeTime(n.createdAt)}
                </Typography>
              </ListItemButton>
            ))}
          </List>
        ) : (
          <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              お知らせはありません
            </Typography>
          </Box>
        )}
        <Divider />
        <Button
          fullWidth
          size="small"
          onClick={() => {
            setAnchor(null);
            navigate("/inquiries");
          }}
          sx={{ py: 1, borderRadius: 0 }}
        >
          お問い合わせ
        </Button>
      </Popover>
    </>
  );
}
