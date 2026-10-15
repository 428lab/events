import { useState } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  AXIS_DIVISIONS,
  formatAxisTick,
  niceAxis,
  type ChartAxis,
} from "../lib/chartAxis.js";

/** 1つの系列（PV・参加登録など）。系列ごとに縦軸を持ち、左右どちらかに目盛りを出す */
export interface DailyBarSeries {
  color: string;
  side: "left" | "right";
}

export interface DailyBarDay {
  day: string;
  /** series と同じ順の、その日の値 */
  values: number[];
  /** その日の実数を並べた1行。タップしたときと読み上げに使う */
  valuesText: string;
}

const BAR_AREA_HEIGHT = 110;
/** いちばん上の目盛りの文字が上で切れないよう、棒の領域の上に空ける高さ */
const TOP_PAD = 8;
const AXIS_WIDTH = 28;

/** 棒の領域の上端からの位置。fraction は 0（下端）〜1（上端） */
const lineTop = (fraction: number) => TOP_PAD + (1 - fraction) * BAR_AREA_HEIGHT;

/**
 * 日別の棒グラフ（イベントのアクセス統計・サイト全体のアクセス統計）。
 * 系列ごとに大きさが大きく違う（PV と参加登録）ので、棒の高さは系列ごとの縦軸で決め、
 * 左の系列の目盛りを左に、右の系列の目盛りを右に、系列と同じ色で出す。
 * 両方の軸は同じ数に等分するので、補助線は共通にできる。
 * 日をタップ（またはフォーカスして Enter）するとその日の実数をグラフの上に出し、
 * 同じ日をもう一度タップすると閉じる。
 * マウスでは棒に乗せただけで同じ1行を出し、グラフから外れるとタップで選んだ日（なければ案内）に戻す。
 * タッチは mouseenter も模擬するので、pointerType が mouse のときだけ乗せた日として扱う。
 */
export function DailyBarChart({
  series,
  days,
}: {
  series: DailyBarSeries[];
  days: DailyBarDay[];
}) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const shownDay = hoveredDay ?? selectedDay;
  const selected = days.find((d) => d.day === shownDay) ?? null;
  const axes = series.map((_, i) =>
    niceAxis(Math.max(0, ...days.map((d) => d.values[i] ?? 0))),
  );
  const axisFor = (side: DailyBarSeries["side"]) => {
    const i = series.findIndex((s) => s.side === side);
    return i < 0 ? null : { color: series[i].color, axis: axes[i] };
  };
  const left = axisFor("left");
  const right = axisFor("right");
  const plotHeight = TOP_PAD + BAR_AREA_HEIGHT;
  return (
    <>
      <Typography
        variant="body2"
        color={selected ? "text.primary" : "text.secondary"}
        aria-live="polite"
        data-testid="daily-chart-selected"
        sx={{ mb: 1, minHeight: "1.5em", fontWeight: selected ? 600 : 400 }}
      >
        {selected ? selected.valuesText : t("staffOps.statsDayTapHint")}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "flex-start" }}>
        {left && <AxisTicks side="left" color={left.color} axis={left.axis} height={plotHeight} />}
        <Box sx={{ position: "relative", flex: 1, minWidth: 0 }}>
          {/* 補助線。左右の軸で同じ位置になる */}
          {Array.from({ length: AXIS_DIVISIONS + 1 }, (_, i) => (
            <Box
              key={i}
              aria-hidden
              data-testid="daily-chart-gridline"
              sx={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${lineTop(i / AXIS_DIVISIONS)}px`,
                borderTop: "1px solid",
                borderColor: "divider",
                opacity: i === 0 ? 1 : 0.6,
                pointerEvents: "none",
              }}
            />
          ))}
          <Box
            data-testid="daily-chart-days"
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setHoveredDay(null);
            }}
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "flex-start",
              gap: 0.75,
              overflowX: "auto",
              px: 0.5,
            }}
          >
            {days.map((d) => (
              <ButtonBase
                key={d.day}
                aria-label={d.valuesText}
                aria-pressed={d.day === selectedDay}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setHoveredDay(d.day);
                }}
                onClick={() =>
                  setSelectedDay((current) => (current === d.day ? null : d.day))
                }
                sx={{
                  flex: "1 0 20px",
                  minWidth: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0.5,
                  pt: `${TOP_PAD}px`,
                  borderRadius: 1,
                  bgcolor:
                    d.day === selectedDay
                      ? "action.selected"
                      : d.day === hoveredDay
                        ? "action.hover"
                        : "transparent",
                  "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    gap: "2px",
                    height: BAR_AREA_HEIGHT,
                    width: "100%",
                  }}
                >
                  {series.map((s, i) => {
                    const value = d.values[i] ?? 0;
                    return (
                      <Box
                        key={i}
                        data-testid="daily-chart-bar"
                        sx={{
                          width: 8,
                          height: `${(value / axes[i].scaleMax) * BAR_AREA_HEIGHT}px`,
                          bgcolor: s.color,
                          borderRadius: "2px 2px 0 0",
                          minHeight: value > 0 ? 2 : 0,
                        }}
                      />
                    );
                  })}
                </Box>
                <Typography
                  sx={{ fontSize: 9, color: "text.secondary", whiteSpace: "nowrap" }}
                >
                  {d.day.slice(5)}
                </Typography>
              </ButtonBase>
            ))}
          </Box>
        </Box>
        {right && (
          <AxisTicks side="right" color={right.color} axis={right.axis} height={plotHeight} />
        )}
      </Box>
    </>
  );
}

function AxisTicks({
  side,
  color,
  axis,
  height,
}: {
  side: "left" | "right";
  color: string;
  axis: ChartAxis;
  height: number;
}) {
  return (
    <Box
      aria-hidden
      data-testid={`daily-chart-axis-${side}`}
      sx={{ position: "relative", flex: `0 0 ${AXIS_WIDTH}px`, height }}
    >
      {axis.ticks.map((tick) => (
        <Typography
          key={tick}
          sx={{
            position: "absolute",
            [side === "left" ? "right" : "left"]: 3,
            // 目盛りの文字の中心を補助線に合わせる
            top: `${lineTop(tick / axis.scaleMax)}px`,
            transform: "translateY(-50%)",
            fontSize: 9,
            lineHeight: 1,
            color,
            whiteSpace: "nowrap",
          }}
        >
          {formatAxisTick(tick)}
        </Typography>
      ))}
    </Box>
  );
}
