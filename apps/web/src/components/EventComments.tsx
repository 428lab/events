import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SendIcon from "@mui/icons-material/Send";
import { Link as RouterLink } from "react-router-dom";
import type { EventRole } from "@eventer/shared";
import { EVENT_COMMENT_LIMIT } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { useMe } from "../api/hooks.js";
import {
  useAddEventComment,
  useDeleteEventComment,
  useEventComments,
} from "../api/eventCommentHooks.js";
import { Markdown } from "./Markdown.js";
import { MarkdownEditor } from "./MarkdownEditor.js";
import { formatDateTime } from "../lib/format.js";

/** イベントのコメント欄。閲覧はイベントが見える人全員、投稿は参加確定者のみ */
export function EventComments({
  eventId,
  myRole,
  canComment,
}: {
  eventId: string;
  myRole: EventRole | null;
  canComment: boolean;
}) {
  const { data: me } = useMe();
  // イベント配下のUIは myRole のみで判定（サイト管理者でもイベントスタッフでなければ操作UIを出さない）
  const isStaff = myRole === "staff";
  const { data: comments } = useEventComments(eventId, true);
  const addComment = useAddEventComment(eventId);
  const delComment = useDeleteEventComment(eventId);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    setError(null);
    addComment.mutate(text, {
      onSuccess: () => setBody(""),
      onError: (err) =>
        setError(
          err instanceof ApiError && err.status === 409
            ? `コメントは1イベントにつき${EVENT_COMMENT_LIMIT}件までです。`
            : "コメントの投稿に失敗しました。",
        ),
    });
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1.5 }}
        >
          <ChatBubbleOutlineIcon fontSize="small" />
          コメント（{comments?.length ?? 0}）
        </Typography>

        <Stack spacing={2}>
          {!comments ? (
            <Typography variant="body2" color="text.secondary">
              読み込み中…
            </Typography>
          ) : comments.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              まだコメントはありません。
            </Typography>
          ) : (
            comments.map((c) => (
              <Stack key={c.id} direction="row" spacing={1} alignItems="flex-start">
                <Avatar
                  src={c.userAvatarUrl ?? undefined}
                  component={c.username ? RouterLink : "div"}
                  to={c.username ? `/users/${c.username}` : undefined}
                  sx={{ width: 32, height: 32, fontSize: 14, textDecoration: "none" }}
                >
                  {c.userName.charAt(0)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={0.75}
                    alignItems="baseline"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Typography variant="body2" fontWeight={600}>
                      {c.userName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(c.createdAt)}
                    </Typography>
                  </Stack>
                  <Markdown>{c.body}</Markdown>
                </Box>
                {(c.userId === me?.id || isStaff) && (
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (window.confirm("このコメントを削除しますか？")) {
                        delComment.mutate(c.id);
                      }
                    }}
                    title="コメントを削除"
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Stack>
            ))
          )}

          {canComment ? (
            <Box>
              {error && (
                <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
              <MarkdownEditor
                value={body}
                onChange={setBody}
                placeholder="コメントを追加…（Markdown が使えます）"
                minRows={2}
              />
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SendIcon />}
                  disabled={!body.trim() || addComment.isPending}
                  onClick={submit}
                >
                  投稿
                </Button>
              </Stack>
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              コメントするにはこのイベントへの参加確定が必要です。
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
