import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import SendIcon from "@mui/icons-material/Send";
import type { EventRole } from "@eventer/shared";
import { QA_QUESTION_MAX } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import {
  useEventQa,
  usePickQuestion,
  usePostQuestion,
  useUpdateQuestion,
  useVoteQuestion,
} from "../api/eventQaHooks.js";
import { CounterTextField } from "./CounterTextField.js";
import { QaPickedQuestion, QaQuestionList } from "./QaQuestionList.js";

/** イベントQ&A (#216) のセクション。
 * 質問の投稿・投票は参加確定メンバー、回答済み・ピックアップ・非表示はスタッフ。
 * 表示部分は QaQuestionList / QaPickedQuestion に切り出してあり、
 * 投影用画面とプレゼンターのサイドパネル (#215) から同じものを使える。 */
export function EventQa({
  eventId,
  myRole,
  canPost,
}: {
  eventId: string;
  myRole: EventRole | null;
  /** 参加確定メンバーか（閲覧も参加確定メンバーのみ） */
  canPost: boolean;
}) {
  // イベント配下のUIは myRole のみで判定（サイト管理者でもイベントスタッフでなければ
  // 操作UIを出さない）。匿名投稿の投稿者が見えるかどうかはサーバーが決めている
  const isStaff = myRole === "staff";
  const { data } = useEventQa(eventId, canPost);
  const post = usePostQuestion(eventId);
  const vote = useVoteQuestion(eventId);
  const update = useUpdateQuestion(eventId);
  const pick = usePickQuestion(eventId);
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;

  const picked =
    data.questions.find((q) => q.id === data.pickedQuestionId) ?? null;
  // choice のときだけ投稿者が選べる。real/anon はサーバーが投稿時に寄せる
  const canChooseAnonymity = data.anonymity === "choice";
  const willBeAnonymous =
    data.anonymity === "anon" || (canChooseAnonymity && anonymous);

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    setError(null);
    post.mutate(
      { body: text, anonymous: canChooseAnonymity ? anonymous : false },
      {
        onSuccess: () => setBody(""),
        onError: (err) =>
          setError(
            err instanceof ApiError && err.status === 409
              ? "このイベントの Q&A は現在受け付けていません。"
              : "質問の投稿に失敗しました。",
          ),
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}
        >
          <HelpOutlineIcon fontSize="small" />
          Q&A（{data.questions.filter((q) => !q.answered).length}）
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1.5 }}
        >
          聞きたいことを投稿し、聞きたい質問に投票できます。票の多い質問が上に並びます。
          {data.anonymity === "anon" && "このイベントの質問は匿名で投稿されます。"}
          {data.anonymity === "real" && "このイベントの質問は名前つきで投稿されます。"}
        </Typography>

        <Stack spacing={2}>
          {picked && (
            <Box sx={{ py: 2, borderRadius: 2, bgcolor: "action.hover" }}>
              <QaPickedQuestion
                question={picked}
                onClear={isStaff ? () => pick.mutate(null) : undefined}
              />
            </Box>
          )}

          {data.canPost ? (
            <Box>
              {error && (
                <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
              <CounterTextField
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="質問を書く…"
                max={QA_QUESTION_MAX}
                multiline
                minRows={2}
                fullWidth
                size="small"
              />
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ mt: 1 }}
              >
                {canChooseAnonymity ? (
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={anonymous}
                        onChange={(e) => setAnonymous(e.target.checked)}
                      />
                    }
                    label={
                      <Typography variant="body2">
                        匿名で投稿する（運営には投稿者が分かります）
                      </Typography>
                    }
                  />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {willBeAnonymous
                      ? "この質問は匿名で投稿されます（運営には投稿者が分かります）"
                      : "この質問は名前つきで投稿されます"}
                  </Typography>
                )}
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SendIcon />}
                  disabled={!body.trim() || post.isPending}
                  onClick={submit}
                >
                  質問する
                </Button>
              </Stack>
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              このイベントの Q&A は現在受け付けていません。
            </Typography>
          )}

          <QaQuestionList
            questions={data.questions}
            pickedQuestionId={data.pickedQuestionId}
            canVote={data.canPost}
            isStaff={isStaff}
            onVote={(q, voted) => vote.mutate({ questionId: q.id, voted })}
            onAnswered={
              isStaff
                ? (q, answered) => update.mutate({ questionId: q.id, answered })
                : undefined
            }
            onHidden={
              isStaff
                ? (q, hidden) => update.mutate({ questionId: q.id, hidden })
                : undefined
            }
            onPick={isStaff ? (id) => pick.mutate(id) : undefined}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
