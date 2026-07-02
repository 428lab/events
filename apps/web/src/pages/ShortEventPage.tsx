import { Alert, Typography } from "@mui/material";
import { Navigate, useParams } from "react-router-dom";
import { useEventBySlug } from "../api/hooks.js";

/** 短いシェアURL /e/:slug → イベント詳細へリダイレクト */
export function ShortEventPage() {
  const { slug = "" } = useParams();
  const { data, isLoading, isError } = useEventBySlug(slug);

  if (isError) return <Alert severity="info">イベントが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;
  return <Navigate to={`/events/${data.id}`} replace />;
}
