import { Suspense, lazy } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";

// nostr-tools（暗号ライブラリ）が大きいため遅延読み込みで分離する
// （EventChatPage と同様。静的importするとメインバンドルに混入する）
const StaffChat = lazy(() =>
  import("../components/StaffChat.js").then((m) => ({ default: m.StaffChat })),
);

/**
 * スタッフチャット専用ページ (#382)。設計は docs/staff-chat.md 9。
 *
 * 公開前（draft）から使える。参加者チャット（/events/:id/chat #215）とは
 * **別の部屋**として並び、公開の前後で中身が移ることはない（設計 9.1）。
 *
 * 見えるのは `myRole === "staff"` の人だけ。**サイト管理者かどうかは混ぜない**
 * （イベント配下の画面はイベント内の役割だけで判定する #275）。
 * 直接 URL で開かれてもここで止まり、サーバー側も同じ判定で 403 を返す。
 */
export function StaffChatPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useEvent(id);
  const event = data?.event ?? null;
  const isStaff = data?.myRole === "staff";

  if (isLoading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (isError || !event) {
    return <Alert severity="error">{t("eventSocial.chatEventNotFound")}</Alert>;
  }
  if (!isStaff) {
    return <Alert severity="info">{t("staffOps.staffChatStaffOnly")}</Alert>;
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        // Layout の Container(py:4)＋AppBar を差し引いて縦いっぱいに使う
        // （EventChatPage と同じ計算）
        height: "calc(100vh - 180px)",
        "@supports (height: 100dvh)": { height: "calc(100dvh - 180px)" },
        minHeight: 360,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Tooltip title={t("eventSocial.chatPageBackToEvent")}>
          <IconButton
            size="small"
            component={RouterLink}
            to={`/events/${id}`}
            aria-label={t("eventSocial.chatPageBackToEvent")}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {t("staffOps.staffChatTitle")}
          {" — "}
          {event.title}
        </Typography>
      </Stack>
      <Suspense fallback={null}>
        <StaffChat eventId={id} />
      </Suspense>
    </Box>
  );
}
