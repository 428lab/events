import { Alert, Typography } from "@mui/material";
import { Navigate, useParams } from "react-router-dom";
import { useEventRequestBySlug } from "../api/requestHooks.js";

/** 短いシェアURL /r/:slug → たまご詳細へリダイレクト */
export function ShortRequestPage() {
  const { slug = "" } = useParams();
  const { data, isLoading, isError } = useEventRequestBySlug(slug);

  if (isError) return <Alert severity="info">たまごが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;
  return <Navigate to={`/requests/${data.id}`} replace />;
}
