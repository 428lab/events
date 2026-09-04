import { Suspense, lazy } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useTranslation } from "react-i18next";
import {
  useEventQa,
  usePickQuestion,
  useUpdateQuestion,
  useVoteQuestion,
} from "../api/eventQaHooks.js";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";
import { usePresenterPanel } from "../lib/usePresenterPanel.js";
import { QaPickedQuestion, QaQuestionList } from "./QaQuestionList.js";

// nostr-tools（暗号ライブラリ）が大きいため遅延読み込みで分離する（チャット専用ページと同様）
const EventChat = lazy(() =>
  import("./EventChat.js").then((m) => ({ default: m.EventChat })),
);

/** サイドパネルの表示切替ボタン (#215)。発表ビューと配信コントロールで同じものを使う */
export function PresenterPanelToggle() {
  const { t } = useTranslation();
  const [open, setOpen] = usePresenterPanel();
  return (
    <Button
      size="small"
      variant={open ? "contained" : "outlined"}
      startIcon={<ForumOutlinedIcon />}
      onClick={() => setOpen(!open)}
    >
      {t(open ? "eventSocial.panelToggleClose" : "eventSocial.panelToggleOpen")}
    </Button>
  );
}

/**
 * 登壇者向けサイドパネル (#215)。話しながら会場の反応・質問を拾えるように、
 * チャット（上）と Q&A（下）を細い列にまとめて出す。
 * 表示部品は投影用画面・イベントページと共通のものを使い、
 * チャットのリレー接続はこの中の EventChat 1本だけに保つ
 * （同じ画面に他のチャットを同時に置かないこと）。
 */
export function PresenterSidePanel({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const [, setOpen] = usePresenterPanel();
  const { event, myRole, canChat, chatAvailable } = useEventChatAccess(eventId);
  const { data: qa } = useEventQa(eventId, canChat);
  // Q&A の操作UIはサーバーの canModerate をそのまま使う（EventQa と同じ基準）。
  // canModerate は「そのイベントの参加確定 staff メンバー」＝ myRole === "staff" と
  // 同じ条件で、サイト管理者やコミュニティ管理者というだけでは true にならない
  const isStaff = qa?.canModerate ?? false;
  const vote = useVoteQuestion(eventId);
  const update = useUpdateQuestion(eventId);
  const pick = usePickQuestion(eventId);

  // このパネルは発表中に画面共有・投影されることがあるので、
  // モデレーションで非表示にした本文は並べない（解除はイベント詳細のQ&Aで行う）。
  // staff には hidden 付きの質問もサーバーから届くため、ここで落とす
  const questions = (qa?.questions ?? []).filter((q) => !q.hidden);
  // Q&A を OFF にしたイベントではピックアップも出さない（投影用画面と揃える）
  const picked =
    (qa?.qaEnabled
      ? questions.find((q) => q.id === qa.pickedQuestionId)
      : null) ?? null;

  return (
    <Paper
      variant="outlined"
      sx={{
        flex: "0 0 auto",
        width: { xs: "100%", md: 340 },
        display: "flex",
        flexDirection: "column",
        p: 1.5,
        position: { md: "sticky" },
        top: { md: 88 },
        height: { xs: 560, md: "calc(100vh - 120px)" },
        minHeight: 0,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ flexShrink: 0 }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          {t("eventSocial.panelHeading")}
        </Typography>
        <Tooltip title={t("eventSocial.panelClose")}>
          <IconButton
            size="small"
            onClick={() => setOpen(false)}
            aria-label={t("eventSocial.panelClose")}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {!canChat ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("eventSocial.panelMembersOnly")}
        </Typography>
      ) : (
        <>
          {/* 「解除できない」で当日詰まらないよう、失敗は黙って捨てない */}
          {pick.isError && (
            <Alert
              severity="warning"
              sx={{ mt: 1, flexShrink: 0 }}
              onClose={() => pick.reset()}
            >
              {t("eventSocial.qaPickFailed")}
            </Alert>
          )}
          {picked && (
            <Box
              sx={{
                flexShrink: 0,
                py: 1,
                mt: 1,
                maxHeight: 220,
                overflowY: "auto",
                borderRadius: 1.5,
                bgcolor: "action.hover",
              }}
            >
              {/* 幅が狭いので等倍より小さく。解除は staff のみ */}
              <QaPickedQuestion
                question={picked}
                scale={0.45}
                onClear={isStaff ? () => pick.mutate(null) : undefined}
              />
            </Box>
          )}

          {/* チャット（上半分）。リレー接続はこの1本だけ */}
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              mt: 1,
            }}
          >
            {chatAvailable && event ? (
              <Suspense fallback={null}>
                <EventChat
                  eventId={eventId}
                  event={event}
                  myRole={myRole}
                  variant="page"
                />
              </Suspense>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t("eventSocial.panelChatUnavailable")}
              </Typography>
            )}
          </Box>

          <Divider sx={{ my: 1, flexShrink: 0 }} />

          {/* Q&A（下半分）。幅が狭いので dense */}
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Typography
              variant="subtitle2"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                mb: 0.5,
                flexShrink: 0,
              }}
            >
              <HelpOutlineIcon fontSize="small" />
              {/* 件数も非表示ぶんを除いた数（staff だけ数がズレるのを防ぐ） */}
              {t("eventSocial.qaHeading", {
                n: questions.filter((q) => !q.answered).length,
              })}
            </Typography>
            {/* 発表中に画面共有・投影されることがあるので、匿名投稿の投稿者名は
                出さない（revealAuthor 相当の指定は渡さず既定のままにすること）。
                「自分」チップも出さない（登壇者が匿名で投げた質問が本人のものだと分かる） */}
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
              <QaQuestionList
                questions={questions}
                pickedQuestionId={picked?.id ?? null}
                canVote={qa?.canPost}
                isStaff={isStaff}
                showMineChip={false}
                dense
                onVote={(q, voted) => vote.mutate({ questionId: q.id, voted })}
                onAnswered={
                  isStaff
                    ? (q, answered) =>
                        update.mutate({ questionId: q.id, answered })
                    : undefined
                }
                onHidden={
                  isStaff
                    ? (q, hidden) => update.mutate({ questionId: q.id, hidden })
                    : undefined
                }
                onPick={isStaff ? (id) => pick.mutate(id) : undefined}
              />
            </Box>
          </Box>
        </>
      )}
    </Paper>
  );
}
