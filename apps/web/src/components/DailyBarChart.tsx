import { useState } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

export interface DailyBar {
  value: number;
  /** この系列の最大値。棒の高さは value / max で決まる */
  max: number;
  color: string;
}

export interface DailyBarDay {
  day: string;
  bars: DailyBar[];
  /** その日の実数を並べた1行。タップしたときと読み上げに使う */
  valuesText: string;
}

const BAR_AREA_HEIGHT = 110;

/**
 * 日別の棒グラフ（イベントのアクセス統計・サイト全体のアクセス統計）。
 * 縦軸の目盛りは無いので、日をタップ（またはフォーカスして Enter）するとその日の実数をグラフの上に出す。
 * 同じ日をもう一度タップすると閉じる。
 */
export function DailyBarChart({ days }: { days: DailyBarDay[] }) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selected = days.find((d) => d.day === selectedDay) ?? null;
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
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: 0.75,
          height: 150,
          overflowX: "auto",
        }}
      >
        {days.map((d) => (
          <ButtonBase
            key={d.day}
            aria-label={d.valuesText}
            aria-pressed={d.day === selectedDay}
            onClick={() =>
              setSelectedDay((current) => (current === d.day ? null : d.day))
            }
            sx={{
              flex: "1 0 20px",
              minWidth: 20,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 0.5,
              height: "100%",
              borderRadius: 1,
              bgcolor: d.day === selectedDay ? "action.selected" : "transparent",
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
              {d.bars.map((bar, i) => (
                <Box
                  key={i}
                  sx={{
                    width: 8,
                    height: `${(bar.value / Math.max(1, bar.max)) * BAR_AREA_HEIGHT}px`,
                    bgcolor: bar.color,
                    borderRadius: "2px 2px 0 0",
                    minHeight: bar.value > 0 ? 2 : 0,
                  }}
                />
              ))}
            </Box>
            <Typography
              sx={{ fontSize: 9, color: "text.secondary", whiteSpace: "nowrap" }}
            >
              {d.day.slice(5)}
            </Typography>
          </ButtonBase>
        ))}
      </Box>
    </>
  );
}
