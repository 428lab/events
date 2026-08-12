import { useEffect, useRef } from "react";
import { Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import { Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";
import { useEventState, useEventStream } from "../api/scoringHooks.js";

/**
 * イベント配下の共通レイアウト。
 * - SSE を購読し、進行状態をリアルタイム反映
 * - プレゼンモードになったら参加者を強制的にプレゼン画面へ遷移
 */
export function EventLayout() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: eventData } = useEvent(id);
  const { data: state } = useEventState(id);
  useEventStream(id);

  const role = eventData?.myRole ?? null;
  const isStaff = role === "staff";
  const prevMode = useRef<string | null>(null);

  useEffect(() => {
    // スタッフは強制遷移しない（進行コントロールのため）
    if (!state || !role || isStaff) {
      if (state) prevMode.current = state.mode;
      return;
    }
    const onPresent = location.pathname.endsWith("/present");
    const onAwards = location.pathname.endsWith("/awards");
    const mode = state.mode;
    const modeChanged = prevMode.current !== mode;
    prevMode.current = mode;

    // モードが切り替わった瞬間（または初回ロード）だけ該当画面へ誘導。
    // 以後は参加者が自分で採点一覧などへ移動でき、引き戻されない。
    if (modeChanged && mode === "presentation" && !onPresent) {
      navigate(`/events/${id}/present`, { replace: true });
      return;
    }
    if (modeChanged && mode === "awards" && !onAwards) {
      navigate(`/events/${id}/awards`, { replace: true });
      return;
    }
    // モードが終わったら発表/表彰画面からは退避させる
    if (mode !== "presentation" && onPresent) {
      navigate(`/events/${id}`, { replace: true });
    }
    if (mode !== "awards" && onAwards) {
      navigate(`/events/${id}`, { replace: true });
    }
  }, [state, role, isStaff, location.pathname, id, navigate]);

  if (!eventData) return <Typography>{t("common.loading")}</Typography>;

  return <Outlet />;
}
