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
import {
  EVENT_QUESTION_LIMIT,
  EVENT_QUESTION_USER_LIMIT,
  QA_QUESTION_MAX,
} from "@eventer/shared";
import { ApiError } from "../api/client.js";
import {
  useDeleteQuestion,
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
 * 投影用画面とプレゼンターのサイドパネル (#215) から同じものを使える。
 *
 * 匿名投稿の投稿者を出すのは**この画面だけ**（revealAuthor を渡すのはここだけ）。
 * 投影に使う画面では渡さないこと。 */
export function EventQa({
  eventId,
  canPost,
}: {
  eventId: string;
  /** 参加確定メンバーか（閲覧も参加確定メンバーのみ） */
  canPost: boolean;
}) {
  const { data } = useEventQa(eventId, canPost);
  const post = usePostQuestion(eventId);
  const vote = useVoteQuestion(eventId);
  const update = useUpdateQuestion(eventId);
  const pick = usePickQuestion(eventId);
  const del = useDeleteQuestion(eventId);
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;

  // 操作UIの有無と匿名投稿者の見え方は、どちらもサーバーの判定をそのまま使う
  // （画面側で条件を書くと、サーバーが返す範囲とズレる）
  const canModerate = data.canModerate;

  const picked =
    data.questions.find((q) => q.id === data.pickedQuestionId) ?? null;
  // choice のときだけ投稿者が選べる。real/anon はサーバーが投稿時に寄せる
  const canChooseAnonymity = data.anonymity === "choice";
  const willBeAnonymous =
    data.anonymity === "anon" || (canChooseAnonymity && anonymous);

  /** 投稿が断られた理由を伝える。上限は「なぜ出せないか」が分からないと
   * 何度も押すことになるので、件数まで出す */
  const postErrorMessage = (err: unknown): string => {
    if (!(err instanceof ApiError) || err.status !== 409) {
      return "質問の投稿に失敗しました。";
    }
    switch ((err.body as { error?: string } | null)?.error) {
      case "question_limit":
        return `このイベントの質問は${EVENT_QUESTION_LIMIT}件までです。`;
      case "question_user_limit":
        return `1人が投稿できる質問は${EVENT_QUESTION_USER_LIMIT}件までです。自分の質問を取り消すと投稿できます。`;
      default:
        return "このイベントの Q&A は現在受け付けていません。";
    }
  };

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    setError(null);
    post.mutate(
      { body: text, anonymous: canChooseAnonymity ? anonymous : false },
      {
        onSuccess: () => setBody(""),
        onError: (err) => setError(postErrorMessage(err)),
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
                revealAuthor={data.revealsAuthor}
                onClear={canModerate ? () => pick.mutate(null) : undefined}
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
              {/* 匿名でも「参加者が少なければ消去法で分かる」ことは先に伝えておく */}
              {(canChooseAnonymity || willBeAnonymous) && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  参加者が少ないイベントでは、誰の質問か推測されることがあります。
                </Typography>
              )}
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
            isStaff={canModerate}
            // 本人だけが見ている画面なので、スタッフに届いた投稿者を出してよい
            // （投影画面・サイドパネル (#215) では渡さないこと）
            revealAuthor={data.revealsAuthor}
            onVote={(q, voted) => vote.mutate({ questionId: q.id, voted })}
            onAnswered={
              canModerate
                ? (q, answered) => update.mutate({ questionId: q.id, answered })
                : undefined
            }
            onHidden={
              canModerate
                ? (q, hidden) => update.mutate({ questionId: q.id, hidden })
                : undefined
            }
            onPick={canModerate ? (id) => pick.mutate(id) : undefined}
            onDelete={(q) => {
              if (
                window.confirm(
                  "この質問を取り消しますか？（投票も一緒に消えます。元に戻せません）",
                )
              ) {
                del.mutate(q.id);
              }
            }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
