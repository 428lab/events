import { Alert, Button, Card, CardContent, Link, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { SurveyQuestionsEditor } from "../components/SurveyQuestionsEditor.js";
import { SurveyAnswersCard } from "../components/SurveyAnswersCard.js";

/**
 * 参加アンケート (#152) の運営ページ（オーナー 2026-11-28「アクセス統計からしかアンケートが確認できないからページを独立させるべき」）。
 * 質問の編集（もとはイベント編集にあった）と回答一覧（もとはアクセス統計にあった）を1か所にまとめる。
 * 開催前アンケート (#444、URLで配るもの) は別ページ（/events/:id/pre-survey）。
 */
export function EventSurveyAdminPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const isStaff = eventData?.myRole === "staff" || isAdmin;

  if (eventData && !isStaff) {
    return <Alert severity="warning">{t("staffOps.surveyPageStaffOnly")}</Alert>;
  }

  return (
    <Stack spacing={2}>
      {eventData && (
        <EventBreadcrumbs eventId={id} eventTitle={eventData.event.title} current={t("staffOps.surveyPageTitle")} />
      )}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" fontWeight={700} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AssignmentOutlinedIcon />
          {t("staffOps.surveyPageTitle")}
        </Typography>
        <Button size="small" startIcon={<ArrowBackIcon />} component={RouterLink} to={`/events/${id}`}>
          {t("staffOps.backToEventLink")}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("staffOps.surveyPageIntro")}{" "}
        <Link component={RouterLink} to={`/events/${id}/pre-survey`}>
          {t("staffOps.surveyPagePreSurveyLink")}
        </Link>
      </Typography>
      {eventData && isStaff && (
        <>
          <Card variant="outlined">
            <CardContent>
              <SurveyQuestionsEditor eventId={id} />
            </CardContent>
          </Card>
          <SurveyAnswersCard eventId={id} enabled />
        </>
      )}
    </Stack>
  );
}
