import { useEffect, useRef } from "react";
import { Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import { Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";
import { useEventState, useEventStateSignal } from "../api/scoringHooks.js";
import { useDocumentTitle } from "../lib/useDocumentTitle.js";

/**
 * イベント配下の共通レイアウト。
 * - コンテスト形式のイベント（と表彰画面）では進行状態の合図で取り直して反映（useEventStateSignal）
 * - プレゼンモードになったら参加者を強制的にプレゼン画面へ遷移（運営は詳細・採点を見ているときだけ。
 *   進行画面などの作業ページからは動かさない）
 */
export function EventLayout() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: eventData } = useEvent(id);
  useDocumentTitle(eventData?.event.title);
  const { data: state } = useEventState(id);
  const onAwardsPage = location.pathname.endsWith("/awards");
  useEventStateSignal(id, state, {
    watch: Boolean(eventData?.event.contestMode) || onAwardsPage,
    awards: onAwardsPage,
  });

  const role = eventData?.myRole ?? null;
  const isStaff = role === "staff";
  const prevMode = useRef<string | null>(null);

  useEffect(() => {
    if (!state || !role) {
      if (state) prevMode.current = state.mode;
      return;
    }
    const onPresent = location.pathname.endsWith("/present");
    const onAwards = location.pathname.endsWith("/awards");
    const mode = state.mode;
    const firstLoad = prevMode.current === null;
    const modeChanged = prevMode.current !== mode;
    prevMode.current = mode;

    // 運営も、プレゼンが始まった瞬間に詳細を見ていればプレゼン画面へ移す（オーナー決定 2026-11-13「全員」）。
    // 採点・進行・編集などの運営の作業ページからは動かさない（採点の未保存の下書き #669 を
    // 黙って捨てないため）。開いた瞬間（初回）も動かさない（プレゼン中に詳細へ戻れなくなるため）。
    // 表彰や退避の自動遷移も運営にはしない（今までどおり）
    if (isStaff) {
      const viewing = location.pathname === `/events/${id}` || location.pathname === `/events/${id}/`;
      if (!firstLoad && modeChanged && mode === "presentation" && viewing) {
        navigate(`/events/${id}/present`, { replace: true });
      }
      return;
    }

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
