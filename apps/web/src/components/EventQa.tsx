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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
  // （画面側で条件を書くと、サーバーが返す範囲とズレる）。
  // canModerate が true なのは「そのイベントの参加確定 staff メンバー」だけで、
  // サイト管理者やコミュニティ管理者というだけでは操作UIは出ない
  // （登壇者サイドパネル (#215) も同じ値を見ている）
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
      return t("eventSocial.qaPostFailed");
    }
    switch ((err.body as { error?: string } | null)?.error) {
      case "question_limit":
        return t("eventSocial.qaLimit", { n: EVENT_QUESTION_LIMIT });
      case "question_user_limit":
        return t("eventSocial.qaUserLimit", { n: EVENT_QUESTION_USER_LIMIT });
      default:
        return t("eventSocial.qaClosed");
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
          {t("eventSocial.qaHeading", {
            n: data.questions.filter((q) => !q.answered).length,
          })}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1.5 }}
        >
          {t("eventSocial.qaIntro")}
          {data.anonymity === "anon" && t("eventSocial.qaAnonAll")}
          {data.anonymity === "real" && t("eventSocial.qaRealAll")}
        </Typography>

        <Stack spacing={2}>
          {/* 「解除できない」で当日詰まらないよう、失敗は黙って捨てない */}
          {pick.isError && (
            <Alert severity="warning" onClose={() => pick.reset()}>
              {t("eventSocial.qaPickFailed")}
            </Alert>
          )}
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
                placeholder={t("eventSocial.qaPlaceholder")}
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
                        {t("eventSocial.qaAnonToggle")}
                      </Typography>
                    }
                  />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {willBeAnonymous
                      ? t("eventSocial.qaWillBeAnon")
                      : t("eventSocial.qaWillBeReal")}
                  </Typography>
                )}
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SendIcon />}
                  disabled={!body.trim() || post.isPending}
                  onClick={submit}
                >
                  {t("eventSocial.qaSubmit")}
                </Button>
              </Stack>
              {/* 匿名でも「参加者が少なければ消去法で分かる」ことは先に伝えておく */}
              {(canChooseAnonymity || willBeAnonymous) && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  {t("eventSocial.qaAnonWarning")}
                </Typography>
              )}
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t("eventSocial.qaClosed")}
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
              if (window.confirm(t("eventSocial.qaDeleteConfirm"))) {
                del.mutate(q.id);
              }
            }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
