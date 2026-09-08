import { lazy, Suspense, type ReactNode } from "react";
import { Alert, Box, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";
import { useVisibleViewport } from "../lib/useVisibleViewport.js";

// 暗号・接続のコードをメインバンドルに取り込まない。
const EventChat = lazy(() =>
  import("./EventChat.js").then((m) => ({ default: m.EventChat })),
);

/** 個人が操作するビンゴ画面用。投影画面には使わない (#499)。 */
export function BingoWithChat({
  eventId,
  children,
}: {
  eventId: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { event, myRole, chatAvailable, isLoading, isError } =
    useEventChatAccess(eventId);
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("md"));
  const docked = mobile && chatAvailable && Boolean(event);
  const viewport = useVisibleViewport(docked);
  const dockHeight = Math.min(viewport.height, Math.max(200, Math.min(320, viewport.height * 0.38)));

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 360px" },
        gap: 3,
        alignItems: "start",
        // 固定チャットの裏まで本文をスクロールできる余白を確保する。
        pb: docked ? `${dockHeight + 16}px` : 0,
        ...(docked ? { "--bingo-card-cell-size": "40px", "--bingo-history-height": "60px" } : {}),
      }}
    >
      <Box sx={{ minWidth: 0 }}>{children}</Box>
      <Box
        component="aside"
        aria-label={t("eventSocial.chatHeading")}
        sx={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          position: docked ? "fixed" : { md: "sticky" },
          top: docked ? viewport.top + viewport.height - dockHeight : { md: 16 },
          ...(docked ? {
            left: viewport.left,
            width: viewport.width,
            zIndex: theme.zIndex.appBar + 1,
            bgcolor: "background.paper",
            boxShadow: 4,
          } : {}),
          height: docked ? dockHeight : { xs: 520, md: "calc(100vh - 48px)" },
          "@supports (height: 100dvh)": {
            height: docked ? dockHeight : { xs: 520, md: "calc(100dvh - 48px)" },
          },
          minHeight: docked ? 0 : 400,
          maxHeight: docked ? viewport.height : 720,
          boxSizing: "border-box",
          p: docked ? 1.5 : 2,
          ...(docked ? { pb: "calc(12px + env(safe-area-inset-bottom, 0px))" } : {}),
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          // 参加案内やエラーが増えた場合も隠さない。接続後の履歴は
          // EventChat(page) 内のスクロール領域が引き受ける。
          overflowY: "auto",
        }}
      >
        {isLoading ? (
          <CircularProgress size={24} aria-label={t("common.loading")} />
        ) : isError ? (
          <Alert severity="error">{t("eventSocial.chatEventNotFound")}</Alert>
        ) : chatAvailable && event ? (
          <Suspense fallback={<CircularProgress size={24} aria-label={t("common.loading")} />}>
            {/* 抽選の更新では維持し、別イベントへ移ったときだけ接続と入力を切り替える。 */}
            <EventChat key={eventId} eventId={eventId} event={event} myRole={myRole} variant="page" />
          </Suspense>
        ) : (
          <Alert severity="info">{t("eventSocial.chatPageUnavailable")}</Alert>
        )}
      </Box>
    </Box>
  );
}
