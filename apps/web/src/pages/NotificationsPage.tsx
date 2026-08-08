import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Pagination,
  Stack,
  Typography,
} from "@mui/material";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { useNavigate } from "react-router-dom";
import {
  NOTIFICATION_TYPE_LABELS,
  type Notification,
  type NotificationType,
} from "@eventer/shared";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationPage,
  useNotificationUnreadCount,
} from "../api/notificationHooks.js";
import { formatDateTime } from "../lib/format.js";
import { notificationLinkTo } from "../lib/notificationLink.js";

/** 種別の見出し。将来増えた種別はラベル無し（本文だけ）で出す */
function typeLabel(type: string): string | null {
  return NOTIFICATION_TYPE_LABELS[type as NotificationType] ?? null;
}

/**
 * 1件ぶんの表示。
 *
 * どの種別も「見出し(title)＋本文(body)＋遷移先(link)」の形で作られているので
 * 見せ方は共通で、種別ごとに変わるのは肩書きのラベルだけ。本文は途中で切らずに
 * 全部出す（一斉連絡は最大2000字あり、リンク先のイベントページにも本文は無い）。
 * 改行をそのまま活かすため pre-wrap。
 */
function NotificationCard({
  n,
  onRead,
}: {
  n: Notification;
  onRead: (id: string) => void;
}) {
  const navigate = useNavigate();
  const label = typeLabel(n.type);

  const open = () => {
    if (!n.read) onRead(n.id);
    navigate(notificationLinkTo(n.link));
  };

  return (
    <Card
      variant="outlined"
      sx={{
        borderLeft: "3px solid",
        borderLeftColor: n.read ? "transparent" : "primary.main",
        bgcolor: n.read ? undefined : "action.hover",
      }}
    >
      <CardContent>
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            {label && <Chip size="small" label={label} />}
            {!n.read && <Chip size="small" color="primary" label="未読" />}
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {formatDateTime(n.createdAt)}
            </Typography>
          </Stack>

          <Typography
            variant="subtitle1"
            fontWeight={n.read ? 600 : 700}
            sx={{ overflowWrap: "anywhere" }}
          >
            {n.title}
          </Typography>

          {n.body && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            >
              {n.body}
            </Typography>
          )}

          {(n.link || !n.read) && (
            <Stack
              direction="row"
              spacing={1}
              justifyContent="flex-end"
              flexWrap="wrap"
              useFlexGap
            >
              {!n.read && (
                <Button size="small" onClick={() => onRead(n.id)}>
                  既読にする
                </Button>
              )}
              {n.link && (
                <Button size="small" variant="outlined" onClick={open}>
                  開く
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * お知らせの一覧 (#294)。
 *
 * これまで受け取った連絡は通知ベルのドロップダウンでしか読めず、閉じると
 * 読み直せなかった。会場変更のような当日の連絡を後から確認できる場所として、
 * 本文を最後まで読める形で残す。表示されるのは本人あての通知だけ。
 */
export function NotificationsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useNotificationPage(page);
  const { data: unread } = useNotificationUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <Stack spacing={2.5}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        spacing={1}
      >
        <Typography
          variant="h5"
          fontWeight={700}
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <NotificationsNoneIcon fontSize="medium" />
          お知らせ
        </Typography>
        {Boolean(unread) && (
          <Button
            size="small"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
          >
            すべて既読
          </Button>
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        受け取ったお知らせが新しい順に並びます。日付で自動的に消えることはありません。
        ここに出るのはあなた宛てのお知らせだけです。
      </Typography>

      {isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : data.notifications.length === 0 ? (
        <Typography color="text.secondary">お知らせはまだありません。</Typography>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary">
            全 {data.total} 件{Boolean(unread) && ` / 未読 ${unread} 件`}
          </Typography>
          <Stack spacing={1.5}>
            {data.notifications.map((n) => (
              <NotificationCard
                key={n.id}
                n={n}
                onRead={(id) => markRead.mutate(id)}
              />
            ))}
          </Stack>
          {pageCount > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center" }}>
              <Pagination
                count={pageCount}
                page={page}
                onChange={(_e, p) => setPage(p)}
                color="primary"
              />
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}
