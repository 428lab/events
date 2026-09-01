import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PreSurveyQuestion } from "@eventer/shared";
import {
  usePublicPreSurvey,
  useSubmitPreSurvey,
} from "../api/preSurveyHooks.js";
import { LinkifiedText } from "../components/LinkifiedText.js";
import { useMe } from "../api/hooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { i18next } from "../i18n/index.js";

/**
 * 開催前アンケートの回答ページ (#444)。`/s/:token`（未ログイン可）。
 *
 * 画面に出るのはサーバーが返した「主催者が書いたものだけ」（タイトル・説明・質問）。
 * イベント本体の情報はサーバー応答に無い（漏れ防止はサーバーの責務。
 * docs/pre-event-survey.md §3.2）。送信は1回きりで編集は無い。
 */
export function PreSurveyPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const { data, isLoading, isError } = usePublicPreSurvey(token);
  const submit = useSubmitPreSurvey(token);
  const { data: me } = useMe();
  // 質問ID → 入力値（select/text は string、checkbox は string[]）
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  // 記名の同意 (#448)。既定オフ。チェックしない限りアカウントは保存されない
  const [named, setNamed] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (isLoading) return <Typography>{t("common.loading")}</Typography>;
  if (isError || !data) {
    return <Alert severity="info">{t("preSurvey.notFound")}</Alert>;
  }
  if (data.status === "closed") {
    return (
      <Stack spacing={2}>
        <Typography variant="h5" fontWeight={700}>
          {data.title}
        </Typography>
        <Alert severity="info">{t("preSurvey.closed")}</Alert>
      </Stack>
    );
  }
  if (done) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ py: 6 }}>
        <CheckCircleOutlineIcon color="success" sx={{ fontSize: 56 }} />
        <Typography variant="h5" fontWeight={700}>
          {t("preSurvey.doneHeading")}
        </Typography>
        <Typography color="text.secondary">{t("preSurvey.doneNote")}</Typography>
      </Stack>
    );
  }

  const setValue = (id: string, v: string | string[]) =>
    setValues((cur) => ({ ...cur, [id]: v }));

  const onSubmit = () => {
    setFailure(null);
    // required の空チェックだけ手元で先に（サーバーも同じ検証を持つ。正はサーバー）
    for (const q of data.questions) {
      const v = values[q.id];
      const empty =
        v === undefined || (typeof v === "string" ? v.trim() === "" : v.length === 0);
      if (q.required && empty) {
        setFailure(t("preSurvey.submitFailedRequired"));
        return;
      }
    }
    submit.mutate(
      {
        named: Boolean(me) && named,
        answers: data.questions
          .filter((q) => values[q.id] !== undefined)
          .map((q) => ({ questionId: q.id, value: values[q.id]! })),
      },
      {
        onSuccess: () => setDone(true),
        onError: (e) =>
          setFailure(
            errorMessage(e, {
              required_missing: i18next.t("preSurvey.submitFailedRequired"),
              closed: i18next.t("preSurvey.submitFailedClosed"),
              survey_full: i18next.t("preSurvey.submitFailedFull"),
              default: i18next.t("preSurvey.submitFailed"),
            }),
          ),
      },
    );
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 640, mx: "auto" }}>
      <Typography variant="h5" fontWeight={700}>
        {data.title}
      </Typography>
      {data.description && (
        <Typography color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
          {/* 説明中の URL は新しいタブで開くリンクに（判定は shared を共用） */}
          <LinkifiedText text={data.description} />
        </Typography>
      )}
      <Stack spacing={2}>
        {data.questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={values[q.id]}
            onChange={(v) => setValue(q.id, v)}
          />
        ))}
      </Stack>
      {/* 記名の同意 (#448)。ログイン中の人にだけ出す。チェックしなければ
          匿名のまま（アカウント情報は送信されない・保存されない） */}
      {me && (
        <FormControlLabel
          control={
            <Checkbox checked={named} onChange={(e) => setNamed(e.target.checked)} />
          }
          label={t("preSurvey.namedOptIn")}
        />
      )}
      {failure && (
        <Alert severity="error" onClose={() => setFailure(null)}>
          {failure}
        </Alert>
      )}
      <Box>
        <Button
          variant="contained"
          size="large"
          disabled={submit.isPending}
          onClick={onSubmit}
        >
          {submit.isPending ? t("preSurvey.submitting") : t("preSurvey.submit")}
        </Button>
      </Box>
    </Stack>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: PreSurveyQuestion;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const { t } = useTranslation();
  const label = (
    <>
      {question.question}
      {question.required && (
        <Typography component="span" color="error" variant="caption" sx={{ ml: 0.5 }}>
          {t("preSurvey.required")}
        </Typography>
      )}
    </>
  );
  return (
    <Card variant="outlined">
      <CardContent>
        <FormControl fullWidth>
          <FormLabel sx={{ mb: 1 }}>{label}</FormLabel>
          {question.qtype === "text" && (
            <TextField
              multiline
              minRows={2}
              value={(value as string) ?? ""}
              placeholder={t("preSurvey.textPlaceholder")}
              inputProps={{ maxLength: 2000 }}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
          {question.qtype === "select" && (
            <RadioGroup
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
            >
              {question.options.map((opt) => (
                <FormControlLabel key={opt} value={opt} control={<Radio />} label={opt} />
              ))}
            </RadioGroup>
          )}
          {question.qtype === "checkbox" &&
            question.options.map((opt) => {
              const picked = (value as string[]) ?? [];
              return (
                <FormControlLabel
                  key={opt}
                  control={
                    <Checkbox
                      checked={picked.includes(opt)}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? [...picked, opt]
                            : picked.filter((v) => v !== opt),
                        )
                      }
                    />
                  }
                  label={opt}
                />
              );
            })}
        </FormControl>
      </CardContent>
    </Card>
  );
}
