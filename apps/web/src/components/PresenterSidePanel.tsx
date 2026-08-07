import { Suspense, lazy } from "react";
import {
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
  const [open, setOpen] = usePresenterPanel();
  return (
    <Button
      size="small"
      variant={open ? "contained" : "outlined"}
      startIcon={<ForumOutlinedIcon />}
      onClick={() => setOpen(!open)}
    >
      チャット・Q&A{open ? "を閉じる" : "を開く"}
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
  const [, setOpen] = usePresenterPanel();
  const { event, myRole, canChat, chatAvailable } = useEventChatAccess(eventId);
  // イベント配下のUIは myRole のみで判定（サイト管理者でも staff でなければ操作UIを出さない）
  const isStaff = myRole === "staff";
  const { data: qa } = useEventQa(eventId, canChat);
  const vote = useVoteQuestion(eventId);
  const update = useUpdateQuestion(eventId);
  const pick = usePickQuestion(eventId);

  const picked =
    qa?.questions.find((q) => q.id === qa.pickedQuestionId) ?? null;

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
          会場の反応
        </Typography>
        <Tooltip title="パネルを閉じる">
          <IconButton size="small" onClick={() => setOpen(false)} aria-label="パネルを閉じる">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {!canChat ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          参加が確定しているメンバーのみ利用できます。
        </Typography>
      ) : (
        <>
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
                  canChat={canChat}
                  variant="page"
                />
              </Suspense>
            ) : (
              <Typography variant="body2" color="text.secondary">
                このイベントではチャットは使えません。
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
              Q&A（{(qa?.questions ?? []).filter((q) => !q.answered).length}）
            </Typography>
            {/* 発表中に画面共有・投影されることがあるので、匿名投稿の投稿者名は
                出さない（revealAuthor 相当の指定は渡さず既定のままにすること） */}
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
              <QaQuestionList
                questions={qa?.questions ?? []}
                pickedQuestionId={qa?.pickedQuestionId}
                canVote={qa?.canPost}
                isStaff={isStaff}
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
