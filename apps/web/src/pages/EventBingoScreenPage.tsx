import { useEffect, useRef, useState } from "react";
import { Alert, Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import TextDecreaseIcon from "@mui/icons-material/TextDecrease";
import TextIncreaseIcon from "@mui/icons-material/TextIncrease";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BINGO_COLUMNS, BINGO_COLUMN_RANGES } from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import { useBingoState } from "../api/bingoHooks.js";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion.js";
import { useBingoScreenEffects, type BingoCountBadge } from "../lib/useBingoScreenEffects.js";
import {
  BOARD_ACCENT,
  BOARD_BG,
  BOARD_SUB,
  BOARD_TEXT,
} from "../components/MeetRanking.js";

/** 文字サイズ倍率（MeetRankingScreenPage と同じ作り。キーは別名） */
const SCALE_KEY = "eventer:bingoScreenScale";
const SCALES = [0.8, 1, 1.25, 1.5, 2];
/** リーチの色（ビンゴは BOARD_ACCENT）。参加者カードのリーチ表示と同じ warning 系 */
const REACH_COLOR = "#FBBF24";

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
 * 権限は参加確定メンバー（スタッフが映す想定）。非メンバーにはサーバーが 404 を返すので
 * 案内だけ出す。ゲーム作成前（"none"）に映しておいても、作成・抽選の合図（topic `bingo`）で
 * 追いつく。名前は出さない（人数のみ。docs/bingo.md §3.8）。
 *
 * 演出 (#681 PR1): 新しい番号はロールしてから止まり、リーチ・ビンゴの人数は大きなパネルで増分を
 * 見せる。差分の判定と時間は `useBingoScreenEffects`（連続する BingoState の差分だけで動く。取り直しの経路には依存しない）。
 */
export function EventBingoScreenPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData, isLoading, isError } = useEvent(id);
  const state = useBingoState(id, Boolean(eventData), true);
  const reduced = usePrefersReducedMotion();
  const fx = useBingoScreenEffects(state.data, reduced);

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
  const unavailable = isError || state.isError;
  /** いま引かれた番号の履歴セルを一度だけ光らせる（reduced では出さない） */
  const cellPulse = (n: number) =>
    !reduced && n === fx.pulseNumber && fx.landKey > 0
      ? { animation: "bingoCellPulse 900ms ease-out", position: "relative" as const, zIndex: 1 }
      : {};

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
        // 止まった番号の拡大（reduced では明るさだけ）・履歴セルと人数のパルス
        "@keyframes bingoLand": {
          "0%": { transform: "scale(1.25)" },
          "100%": { transform: "scale(1)" },
        },
        "@keyframes bingoFlash": {
          "0%": { filter: "brightness(1.8)" },
          "100%": { filter: "brightness(1)" },
        },
        "@keyframes bingoCellPulse": {
          "0%": { transform: "scale(1.5)", boxShadow: `0 0 0 6px ${BOARD_ACCENT}88` },
          "100%": { transform: "scale(1)", boxShadow: "0 0 0 0 transparent" },
        },
        "@keyframes bingoCountPulse": {
          "0%": { transform: "scale(1.35)", opacity: 0.4 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
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
              ) : data.status === "ended" ? (
                <Typography
                  data-testid="bingo-ended-summary"
                  sx={{
                    fontSize: `clamp(24px, 7vw, ${56 * scale}px)`,
                    fontWeight: 800,
                    color: BOARD_TEXT,
                  }}
                >
                  {t("eventSocial.bingoEndedSummary", { bingo: data.counts.bingo, cards: data.counts.cards })}
                </Typography>
              ) : (
                <>
                  <Typography
                    key={fx.rolling ? "rolling" : `n-${fx.landKey}`}
                    data-testid={fx.rolling ? "bingo-rolling" : "bingo-latest"}
                    sx={{
                      fontSize: `clamp(96px, 28vw, ${160 * scale}px)`,
                      fontWeight: 800,
                      color: fx.rolling ? BOARD_SUB : BOARD_ACCENT,
                      lineHeight: 1,
                      fontVariantNumeric: "tabular-nums",
                      animation:
                        fx.landKey > 0 && !fx.rolling
                          ? reduced
                            ? "bingoFlash 600ms ease"
                            : "bingoLand 450ms cubic-bezier(.2,1.6,.4,1)"
                          : undefined,
                    }}
                  >
                    {fx.shownNumber ?? "—"}
                  </Typography>
                  {/* 開始直後（まだ0個）は、待ち状態であることを観客にも伝える */}
                  {data.status === "running" && data.drawnNumbers.length === 0 && (
                    <Typography
                      sx={{ fontSize: `clamp(14px, 4vw, ${24 * scale}px)`, color: BOARD_SUB }}
                    >
                      {t("eventSocial.bingoFirstDrawSoon")}
                    </Typography>
                  )}
                </>
              )}
            </Box>

            {/* 履歴。広い画面は従来どおり B〜O の行×15列。
                スマホ（sm未満）で15列を縮めて収めると丸20px・数字10pxで読めない
                （実機フィードバックで却下）ため、**縦に転置**する:
                B/I/N/G/O の5列を横に並べ、1〜15 を縦に並べる。丸が約70pxになり
                読める。はみ出すぶんは縦スクロールのみ（横は絶対に出さない） */}
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                justifyContent: "center",
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {/* 横長: 15列×5行 */}
              <Stack
                spacing={`clamp(2px, 0.6vw, ${4 * scale}px)`}
                sx={{
                  width: "100%",
                  maxWidth: `${15 * 38 * scale + 40}px`,
                  display: { xs: "none", sm: "flex" },
                }}
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
                          ...cellPulse(n),
                        }}
                      >
                        {n}
                      </Box>
                    ))}
                  </Box>
                ))}
              </Stack>
              {/* 縦長スマホ: 転置（5列×15行）。見出しの B〜O が上に並ぶ */}
              <Box
                sx={{
                  display: { xs: "grid", sm: "none" },
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  gap: "clamp(3px, 1.2vw, 8px)",
                  width: "100%",
                  maxWidth: 420,
                  alignSelf: "flex-start",
                  alignContent: "start",
                }}
              >
                {BINGO_COLUMNS.map((label) => (
                  <Typography
                    key={label}
                    align="center"
                    sx={{ fontSize: 20, fontWeight: 800, color: BOARD_ACCENT }}
                  >
                    {label}
                  </Typography>
                ))}
                {Array.from({ length: 15 }, (_v, r) =>
                  BINGO_COLUMN_RANGES.map(([lo], col) => {
                    const n = lo + r;
                    void col;
                    return (
                      <Box
                        key={n}
                        sx={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "clamp(14px, 4.5vw, 22px)",
                          fontWeight: 700,
                          color: drawnSet.has(n) ? BOARD_BG : BOARD_SUB,
                          bgcolor: drawnSet.has(n) ? BOARD_ACCENT : "transparent",
                          border: `1px solid ${drawnSet.has(n) ? BOARD_ACCENT : BOARD_SUB}44`,
                          ...cellPulse(n),
                        }}
                      >
                        {n}
                      </Box>
                    );
                  }),
                )}
              </Box>
            </Box>

            {/* リーチ・ビンゴの人数（主役）。増えたら数字だけパルスして「+n」を出す */}
            <Box sx={{ flexShrink: 0, textAlign: "center", mt: 1 }}>
              <Typography
                data-testid="bingo-surge"
                sx={{
                  minHeight: `clamp(18px, 4vw, ${28 * scale}px)`,
                  fontSize: `clamp(14px, 3.5vw, ${24 * scale}px)`,
                  fontWeight: 700,
                  color: REACH_COLOR,
                }}
              >
                {fx.surge
                  ? t(fx.surge.big ? "eventSocial.bingoReachSurgeBig" : "eventSocial.bingoReachSurge", { n: fx.surge.n })
                  : ""}
              </Typography>
              <Stack direction="row" justifyContent="center" alignItems="flex-end" spacing={`clamp(16px, 5vw, ${48 * scale}px)`}>
                <CountPanel
                  label={t("eventSocial.bingoReachCount")}
                  value={data.counts.reach}
                  badge={fx.reachBadge}
                  color={REACH_COLOR}
                  scale={scale}
                  reduced={reduced}
                />
                <CountPanel
                  label={t("eventSocial.bingoBingoCount")}
                  value={data.counts.bingo}
                  badge={fx.bingoBadge}
                  color={BOARD_ACCENT}
                  scale={scale}
                  reduced={reduced}
                />
              </Stack>
              <Typography sx={{ fontSize: `clamp(11px, 3vw, ${15 * scale}px)`, color: BOARD_SUB, mt: 0.5 }}>
                {t("eventSocial.bingoCardCount", { n: data.counts.cards })}
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

/** リーチ・ビンゴの人数パネル。増えた瞬間は数字だけパルスし、「+n」を少しのあいだ添える */
function CountPanel({
  label,
  value,
  badge,
  color,
  scale,
  reduced,
}: {
  label: string;
  value: number;
  badge: BingoCountBadge | null;
  color: string;
  scale: number;
  reduced: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Box sx={{ textAlign: "center", position: "relative", minWidth: `clamp(80px, 22vw, ${180 * scale}px)` }}>
      <Typography sx={{ fontSize: `clamp(14px, 3.5vw, ${24 * scale}px)`, fontWeight: 700, color: BOARD_SUB }}>
        {label}
      </Typography>
      <Typography
        key={badge?.key ?? "still"}
        sx={{
          fontSize: `clamp(40px, 11vw, ${88 * scale}px)`,
          fontWeight: 800,
          color,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          animation: badge ? (reduced ? "bingoFlash 600ms ease" : "bingoCountPulse 700ms ease") : undefined,
        }}
      >
        {value}
      </Typography>
      {badge && (
        <Typography
          data-testid="bingo-count-badge"
          sx={{
            position: "absolute",
            top: 0,
            right: 0,
            transform: "translate(40%, -10%)",
            px: 1,
            borderRadius: 999,
            bgcolor: color,
            color: BOARD_BG,
            fontWeight: 800,
            fontSize: `clamp(12px, 3vw, ${22 * scale}px)`,
          }}
        >
          {t("eventSocial.bingoCountIncrease", { n: badge.n })}
        </Typography>
      )}
    </Box>
  );
}
