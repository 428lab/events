import { useEffect, useRef, useState } from "react";
import { Alert, Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import TextDecreaseIcon from "@mui/icons-material/TextDecrease";
import TextIncreaseIcon from "@mui/icons-material/TextIncrease";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";
import { useMeetRankingLive } from "../api/eventMeetHooks.js";
import {
  BOARD_ACCENT,
  BOARD_BG,
  BOARD_SUB,
  BOARD_TEXT,
  MeetRankingBoard,
} from "../components/MeetRanking.js";

/** 文字サイズ倍率。投影距離に合わせてスタッフが変えられる（チャット投影と同じ作り） */
const SCALE_KEY = "eventer:meetRankingScreenScale";
const SCALES = [0.8, 1, 1.25, 1.5, 2];

function readScale(): number {
  try {
    const v = Number(localStorage.getItem(SCALE_KEY));
    return SCALES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * 出会いランキングの投影ページ (#418)。プロジェクター投影やウィンドウキャプチャで
 * 使う想定で、見出しとランキングだけを大きく出す。配色は配信画面と同じ夜空ダーク固定。
 *
 * 権限は参加確定メンバー（スタッフが映す想定だが、参加者が手元で開いてもよい）。
 * 設定がオフのイベント・非メンバーにはサーバーが 404 を返すので、その場合は案内だけ出す。
 */
export function MeetRankingScreenPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData, isLoading, isError } = useEvent(id);
  const event = eventData?.event;
  // オフのイベントでは最初から取りにいかない（サーバーの 404 が防御。これは無駄打ちの節約）
  const enabled = Boolean(event && event.meetRanking !== "off");
  const ranking = useMeetRankingLive(id, enabled);

  const [scale, setScale] = useState(readScale);
  const changeScale = (dir: 1 | -1) => {
    const next =
      SCALES[Math.min(SCALES.length - 1, Math.max(0, SCALES.indexOf(scale) + dir))];
    setScale(next);
    try {
      localStorage.setItem(SCALE_KEY, String(next));
    } catch {
      // localStorage 不可の環境ではセッション内のみ反映
    }
  };

  // カーソル自動非表示（3秒）。配信画面 (LiveScreenPage) と同じ作り
  const [cursorVisible, setCursorVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setCursorVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setCursorVisible(false), 3000);
  };
  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // 見られない状態（イベントが無い・設定オフ・非メンバー）はまとめて案内だけ出す。
  // どれかを細かく言い分けない：サーバーが 404 で区別を消しているのに、
  // 画面が言い分けたら台無しになる
  const unavailable =
    isError || (event && event.meetRanking === "off") || ranking.isError;

  return (
    <Box
      onMouseMove={wake}
      onTouchStart={wake}
      onKeyDown={wake}
      sx={{
        position: "fixed",
        inset: 0,
        bgcolor: BOARD_BG,
        display: "flex",
        flexDirection: "column",
        cursor: cursorVisible ? "default" : "none",
        zIndex: 2000,
        p: 3,
        overflow: "hidden",
      }}
    >
      {isLoading ? (
        <Typography sx={{ color: BOARD_SUB }}>{t("common.loading")}</Typography>
      ) : unavailable || !event ? (
        <Alert severity="info">{t("eventSocial.screenMembersOnly")}</Alert>
      ) : (
        <>
          <Box sx={{ flexShrink: 0, textAlign: "center", mb: 2 * scale }}>
            <Typography
              sx={{ fontSize: 20 * scale, color: BOARD_SUB }}
              noWrap
            >
              {event.title}
            </Typography>
            <Typography
              sx={{
                fontSize: 44 * scale,
                fontWeight: 800,
                color: BOARD_TEXT,
                lineHeight: 1.3,
              }}
            >
              {t("eventSocial.meetRankingHeading")}
            </Typography>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", maxWidth: 1100, width: "100%", mx: "auto" }}>
            {ranking.data && <MeetRankingBoard data={ranking.data} scale={scale} />}
          </Box>

          {ranking.data && ranking.data.totalRanked > 0 && (
            <Typography
              sx={{
                flexShrink: 0,
                textAlign: "center",
                fontSize: 18 * scale,
                color: BOARD_ACCENT,
                mt: 1,
              }}
            >
              {t("eventSocial.meetRankingTotal", { n: ranking.data.totalRanked })}
            </Typography>
          )}
        </>
      )}

      {/* 操作は投影に写り込まないようカーソル表示中だけ右下に出す（チャット投影と同じ作り） */}
      {cursorVisible && (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ position: "fixed", right: 8, bottom: 8, opacity: 0.5 }}
        >
          <Tooltip title={t("eventSocial.screenTextSmaller")}>
            <span>
              <IconButton
                size="small"
                disabled={scale === SCALES[0]}
                onClick={() => changeScale(-1)}
                aria-label={t("eventSocial.screenTextSmaller")}
                sx={{ color: BOARD_SUB }}
              >
                <TextDecreaseIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t("eventSocial.screenTextLarger")}>
            <span>
              <IconButton
                size="small"
                disabled={scale === SCALES[SCALES.length - 1]}
                onClick={() => changeScale(1)}
                aria-label={t("eventSocial.screenTextLarger")}
                sx={{ color: BOARD_SUB }}
              >
                <TextIncreaseIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )}
    </Box>
  );
}
