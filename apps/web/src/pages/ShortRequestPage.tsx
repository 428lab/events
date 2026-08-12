import { Alert, Typography } from "@mui/material";
import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEventRequestBySlug } from "../api/requestHooks.js";

/** 短いシェアURL /r/:slug → たまご詳細へリダイレクト */
export function ShortRequestPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const { data, isLoading, isError } = useEventRequestBySlug(slug);

  if (isError) return <Alert severity="info">{t("egg.notFoundShort")}</Alert>;
  if (isLoading || !data) return <Typography>{t("common.loading")}</Typography>;
  return <Navigate to={`/requests/${data.id}`} replace />;
}
