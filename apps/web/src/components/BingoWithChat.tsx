import { lazy, Suspense, type ReactNode } from "react";
import { Alert, Box, CircularProgress } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";

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

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 360px" },
        gap: 3,
        alignItems: "start",
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
          position: { md: "sticky" },
          top: { md: 16 },
          height: { xs: 520, md: "calc(100vh - 48px)" },
          "@supports (height: 100dvh)": {
            height: { xs: 520, md: "calc(100dvh - 48px)" },
          },
          minHeight: 400,
          maxHeight: 720,
          p: 2,
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
