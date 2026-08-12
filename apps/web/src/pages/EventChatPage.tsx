import { Suspense, lazy } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SlideshowOutlinedIcon from "@mui/icons-material/SlideshowOutlined";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";

// nostr-tools（暗号ライブラリ）が大きいため遅延読み込みで分離する
// （EventDetailPage と同様。静的importするとメインバンドルに混入する）
const EventChat = lazy(() =>
  import("../components/EventChat.js").then((m) => ({ default: m.EventChat })),
);

/**
 * イベントチャット専用ページ (#215)。イベントページ内のカードより
 * 縦に広く使える。プレゼン中の別画面表示などにも使う。
 */
export function EventChatPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { event, myRole, canChat, chatAvailable, isLoading, isError } =
    useEventChatAccess(id);

  if (isLoading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (isError || !event) {
    return (
      <Alert severity="error">{t("eventSocial.chatEventNotFound")}</Alert>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        // Layout の Container(py:4)＋AppBar を差し引いて縦いっぱいに使う。
        // dvh はモバイルの動的ツールバー分を除いた実表示高（非対応環境は vh）
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
          {event.title}
        </Typography>
        {chatAvailable && (
          // 投影用画面 (#215)。プロジェクターやウィンドウキャプチャ用に別タブで開く
          <Button
            size="small"
            startIcon={<SlideshowOutlinedIcon />}
            component={RouterLink}
            to={`/events/${id}/chat/screen`}
            target="_blank"
            rel="noopener"
            sx={{ flexShrink: 0 }}
          >
            {t("eventSocial.chatPageScreenView")}
          </Button>
        )}
      </Stack>
      {chatAvailable ? (
        <Suspense fallback={null}>
          <EventChat
            eventId={id}
            event={event}
            myRole={myRole}
            canChat={canChat}
            variant="page"
          />
        </Suspense>
      ) : (
        <Alert severity="info">{t("eventSocial.chatPageUnavailable")}</Alert>
      )}
    </Box>
  );
}
