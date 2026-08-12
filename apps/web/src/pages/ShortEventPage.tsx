import { Alert, Typography } from "@mui/material";
import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEventBySlug } from "../api/hooks.js";

/** 短いシェアURL /e/:slug → イベント詳細へリダイレクト */
export function ShortEventPage() {
  const { slug = "" } = useParams();
  const { t } = useTranslation();
  const { data, isLoading, isError } = useEventBySlug(slug);

  if (isError) return <Alert severity="info">{t("events.notFound")}</Alert>;
  if (isLoading || !data) return <Typography>{t("common.loading")}</Typography>;
  return <Navigate to={`/events/${data.id}`} replace />;
}
