import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import PollIcon from "@mui/icons-material/Poll";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { useTranslation } from "react-i18next";
import { surveyAnswerText, surveyQuestionText } from "@eventer/shared";
import { api } from "../api/client.js";
import { useSurveyAnswers } from "../api/eventSurveyHooks.js";
import { i18next } from "../i18n/index.js";
import { messageKey, type MessageKey } from "../lib/messageKey.js";

/** 参加状態の見せ方。文言はイベント詳細と同じものを引く（表を2か所に持たない） */
const SURVEY_STATUS_KEY: Partial<
  Record<
    string,
    | "eventDetail.statusConfirmed"
    | "eventDetail.statusWaitlist"
    | "eventDetail.statusApplied"
    | "eventDetail.statusLost"
    | "staffOps.surveyStatusCanceled"
  >
> = {
  confirmed: "eventDetail.statusConfirmed",
  waitlist: "eventDetail.statusWaitlist",
  applied: "eventDetail.statusApplied",
  lost: "eventDetail.statusLost",
  canceled: "staffOps.surveyStatusCanceled",
};

/** 表に無い状態はサーバーの値をそのまま出す */
function surveyStatusLabel(status: string): string {
  const key = SURVEY_STATUS_KEY[status];
  return key ? i18next.t(key) : status;
}

/** 参加アンケート (#152) の回答一覧（staff のみ）。CSV ダウンロードつき。
 * 「参加アンケート」ページ（/events/:id/survey）に置く。質問が無いときは「質問がまだありません」を出す */
export function SurveyAnswersCard({
  eventId,
  enabled,
}: {
  eventId: string;
  enabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useSurveyAnswers(eventId, enabled);
  const [reminding, setReminding] = useState(false);
  const [remindResult, setRemindResult] = useState<MessageKey | null>(null);
  if (!data) return null;
  if (data.questions.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
            <PollIcon fontSize="small" />
            {t("staffOps.surveyTitle")}
          </Typography>
          <Typography color="text.secondary" variant="body2">{t("staffOps.surveyNoQuestions")}</Typography>
        </CardContent>
      </Card>
    );
  }
  const { questions, rows } = data;
  // 写真NGは撮影の段取りに使うので、人数をまとめて先に見せる（名簿には出さない）
  const noPhotoQuestion = questions.find((q) => q.preset === "no_photo");
  const noPhotoCount = (value: "ok" | "no_photo") =>
    noPhotoQuestion
      ? rows.filter((r) => r.answers[noPhotoQuestion.id] === value).length
      : 0;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 1.5 }}
        >
          <Typography
            variant="h6"
            sx={{ flex: 1, minWidth: 160, display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <PollIcon fontSize="small" />
            {t("staffOps.surveyTitle")}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<NotificationsNoneIcon />}
            disabled={reminding}
            onClick={async () => {
              if (!window.confirm(t("staffOps.surveyRemindConfirm"))) {
                return;
              }
              setReminding(true);
              try {
                const res = await api.post<{ notified: number }>(
                  `/events/${eventId}/survey/remind`,
                );
                setRemindResult(
                  messageKey(
                    res.notified === 1
                      ? "staffOps.surveyRemindedOne"
                      : "staffOps.surveyReminded",
                    { n: res.notified },
                  ),
                );
              } catch {
                setRemindResult(messageKey("staffOps.surveyRemindFailed"));
              } finally {
                setReminding(false);
              }
            }}
          >
            {t("staffOps.surveyRemind")}
          </Button>
          {/* 同一オリジンの <a> なので cookie 認証のままダウンロードできる */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            component="a"
            href={`/api/events/${eventId}/survey/answers.csv?lang=${encodeURIComponent(i18n.language)}`}
            download
          >
            {t("staffOps.surveyCsv")}
          </Button>
          {/* 受付結果＋アンケートを1枚にした名簿（会場提供者にも渡せる） (#154) */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            component="a"
            href={`/api/events/${eventId}/attendance.csv?lang=${encodeURIComponent(i18n.language)}`}
            download
          >
            {t("staffOps.attendanceCsv")}
          </Button>
        </Stack>
        {noPhotoQuestion && (
          <Typography variant="body2" sx={{ mb: 1 }} data-testid="no-photo-summary">
            {surveyQuestionText(noPhotoQuestion, i18n.language)}
            {t("common.dotSeparator")}
            {surveyAnswerText(noPhotoQuestion, "no_photo", i18n.language)}: {noPhotoCount("no_photo")}
            {t("common.dotSeparator")}
            {surveyAnswerText(noPhotoQuestion, "ok", i18n.language)}: {noPhotoCount("ok")}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t("staffOps.surveyNote")}
          {remindResult && `${t("common.dotSeparator")}${t(remindResult.key, remindResult.params)}`}
        </Typography>
        {rows.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            {t("staffOps.surveyEmpty")}
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {t("eventDetail.participantsHeading")}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {t("staffOps.surveyStatusColumn")}
                  </TableCell>
                  {questions.map((q) => (
                    <TableCell key={q.id} sx={{ minWidth: 120 }}>
                      {surveyQuestionText(q, i18n.language)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.user.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {r.user.globalName ?? r.user.username}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {r.memberStatus
                        ? surveyStatusLabel(r.memberStatus)
                        : t("staffOps.surveyNotJoined")}
                    </TableCell>
                    {questions.map((q) => (
                      <TableCell key={q.id}>
                        {surveyAnswerText(q, r.answers[q.id] ?? "", i18n.language)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

