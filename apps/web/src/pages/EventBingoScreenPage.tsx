import { useEffect, useRef, useState } from "react";
import { Alert, Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import TextDecreaseIcon from "@mui/icons-material/TextDecrease";
import TextIncreaseIcon from "@mui/icons-material/TextIncrease";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BINGO_COLUMNS, BINGO_COLUMN_RANGES } from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import { useBingoState } from "../api/bingoHooks.js";
import {
  BOARD_ACCENT,
  BOARD_BG,
  BOARD_SUB,
  BOARD_TEXT,
} from "../components/MeetRanking.js";

/** 文字サイズ倍率（MeetRankingScreenPage と同じ作り。キーは別名） */
const SCALE_KEY = "eventer:bingoScreenScale";
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
 * ビンゴの投影ページ (#436)。直近の番号を特大で、履歴をB〜O列のグリッドで出す。
 * 権限は参加確定メンバー（スタッフが映す想定）。ゲームが無い・非メンバーには
 * サーバーが 404 を返すので案内だけ出す。名前は出さない（人数のみ。docs/bingo.md §3.8）。
 */
export function EventBingoScreenPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData, isLoading, isError } = useEvent(id);
  const state = useBingoState(id, Boolean(eventData));

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

  // カーソル自動非表示（3秒）。他の投影画面と同じ作り
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

  const data = state.data;
  const drawnSet = new Set(data?.drawnNumbers ?? []);
  const latest =
    data && data.drawnNumbers.length > 0
      ? data.drawnNumbers[data.drawnNumbers.length - 1]
      : null;
  const unavailable = isError || state.isError;

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
      {isLoading || (!data && !unavailable) ? (
        <Typography sx={{ color: BOARD_SUB }}>{t("common.loading")}</Typography>
      ) : unavailable || !eventData ? (
        <Alert severity="info">{t("eventSocial.screenMembersOnly")}</Alert>
      ) : (
        data && (
          <>
            <Box sx={{ flexShrink: 0, textAlign: "center" }}>
              <Typography
                sx={{
                  fontSize: `clamp(12px, 4vw, ${18 * scale}px)`,
                  color: BOARD_SUB,
                }}
                noWrap
              >
                {eventData.event.title}
              </Typography>
              <Typography
                sx={{
                  fontSize: `clamp(22px, 7vw, ${36 * scale}px)`,
                  fontWeight: 800,
                  color: BOARD_TEXT,
                }}
              >
                {t("eventSocial.bingoTitle")}
              </Typography>
            </Box>

            {/* 直近の番号（特大） */}
            <Box sx={{ textAlign: "center", my: 1 }}>
              {data.status === "setup" ? (
                <Typography
                  sx={{
                    fontSize: `clamp(18px, 5.5vw, ${40 * scale}px)`,
                    color: BOARD_SUB,
                  }}
                >
                  {t("eventSocial.bingoWaiting")}
                </Typography>
              ) : (
                <Typography
                  sx={{
                    fontSize: `clamp(96px, 28vw, ${160 * scale}px)`,
                    fontWeight: 800,
                    color: BOARD_ACCENT,
                    lineHeight: 1,
                  }}
                >
                  {latest ?? "—"}
                </Typography>
              )}
            </Box>

            {/* 履歴: B〜O の行に 15 個ずつ。出た番号だけ明るく。
                丸は固定 px でなく grid の 1fr + aspect-ratio で描き、
                スマホでは縮んで15列全部が必ずビューポート幅に収まる
                （横スクロールで逃げない）。プロジェクターでは maxWidth の
                上限が効いて従来と同等の大きさになる */}
            <Box sx={{ flex: 1, minHeight: 0, display: "flex", justifyContent: "center" }}>
              <Stack
                spacing={`clamp(2px, 0.6vw, ${4 * scale}px)`}
                sx={{ width: "100%", maxWidth: `${15 * 38 * scale + 40}px` }}
              >
                {BINGO_COLUMN_RANGES.map(([lo, hi], col) => (
                  <Box
                    key={col}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: `clamp(16px, 4vw, ${28 * scale}px) repeat(15, minmax(0, 1fr))`,
                      gap: `clamp(2px, 0.6vw, ${4 * scale}px)`,
                      alignItems: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: `clamp(12px, 3vw, ${20 * scale}px)`,
                        fontWeight: 800,
                        color: BOARD_ACCENT,
                      }}
                    >
                      {BINGO_COLUMNS[col]}
                    </Typography>
                    {Array.from({ length: hi - lo + 1 }, (_v, i) => lo + i).map((n) => (
                      <Box
                        key={n}
                        sx={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: `clamp(8px, 1.9vw, ${15 * scale}px)`,
                          fontWeight: 700,
                          color: drawnSet.has(n) ? BOARD_BG : BOARD_SUB,
                          bgcolor: drawnSet.has(n) ? BOARD_ACCENT : "transparent",
                          border: `1px solid ${drawnSet.has(n) ? BOARD_ACCENT : BOARD_SUB}44`,
                        }}
                      >
                        {n}
                      </Box>
                    ))}
                  </Box>
                ))}
              </Stack>
            </Box>

            <Box sx={{ flexShrink: 0, textAlign: "center" }}>
              <Typography
                sx={{
                  fontSize: `clamp(12px, 3.5vw, ${18 * scale}px)`,
                  color: BOARD_SUB,
                }}
              >
                {t("eventSocial.bingoCounts", {
                  cards: data.counts.cards,
                  bingo: data.counts.bingo,
                  reach: data.counts.reach,
                })}
              </Typography>
            </Box>
          </>
        )
      )}

      {/* 右下の倍率操作（カーソルと一緒に隠れる） */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          position: "absolute",
          right: 16,
          bottom: 16,
          opacity: cursorVisible ? 1 : 0,
          transition: "opacity 0.3s",
        }}
      >
        <Tooltip title={t("eventSocial.screenTextSmaller")}>
          <IconButton onClick={() => changeScale(-1)} sx={{ color: BOARD_SUB }}>
            <TextDecreaseIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("eventSocial.screenTextLarger")}>
          <IconButton onClick={() => changeScale(1)} sx={{ color: BOARD_SUB }}>
            <TextIncreaseIcon />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}
