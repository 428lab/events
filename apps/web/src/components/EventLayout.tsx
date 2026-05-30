import { useEffect } from "react";
import { Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import { Typography } from "@mui/material";
import { useEvent } from "../api/hooks.js";
import { useEventState, useEventStream } from "../api/scoringHooks.js";

/**
 * イベント配下の共通レイアウト。
 * - SSE を購読し、進行状態をリアルタイム反映
 * - プレゼンモードになったら参加者を強制的にプレゼン画面へ遷移
 */
export function EventLayout() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: eventData } = useEvent(id);
  const { data: state } = useEventState(id);
  useEventStream(id);

  const role = eventData?.myRole ?? null;
  const isStaff = role === "staff";

  useEffect(() => {
    if (!state || !role) return;
    const onPresent = location.pathname.endsWith("/present");
    // スタッフは強制遷移しない（進行コントロールのため）
    const onAwards = location.pathname.endsWith("/awards");
    if (state.mode === "presentation" && !isStaff && !onPresent) {
      navigate(`/events/${id}/present`, { replace: true });
    }
    if (state.mode === "awards" && !isStaff && !onAwards) {
      navigate(`/events/${id}/awards`, { replace: true });
    }
    if (state.mode !== "presentation" && onPresent && !isStaff) {
      navigate(`/events/${id}`, { replace: true });
    }
    if (state.mode !== "awards" && onAwards && !isStaff) {
      navigate(`/events/${id}`, { replace: true });
    }
  }, [state, role, isStaff, location.pathname, id, navigate]);

  if (!eventData) return <Typography>読み込み中…</Typography>;

  return <Outlet />;
}
