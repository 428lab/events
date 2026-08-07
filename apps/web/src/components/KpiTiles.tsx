import type { ReactNode } from "react";
import {
  Box,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import {
  type KpiGranularity,
  type KpiSeriesPoint,
  type KpiTone,
  type KpiTrend,
  kpiGranularity,
  toWeekly,
} from "@eventer/shared";
import { InfoTip } from "./InfoTip.js";

/** KPI 画面共通の表示部品。運営ダッシュボード (#257) とコミュニティ別KPI (#262) で使う */

/** 率の表示。分母0・母数不足（null）は「—」 */
export function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

/** 平均値の表示。分母0（null）は「—」 */
export function num(v: number | null, digits = 1): string {
  return v === null ? "—" : v.toFixed(digits);
}

/** その場の数字を読むのに必須の注記（母数不足で率が「—」など）。
 * 定義の説明はⓘに畳むが、これは畳むと数字を誤読するので短くして残す */
export function Caution({ text }: { text: string }) {
  return (
    <Typography
      variant="caption"
      sx={{
        display: "block",
        mt: 0.25,
        lineHeight: 1.5,
        color: (t) =>
          t.palette.mode === "light"
            ? t.palette.warning.dark
            : t.palette.warning.main,
      }}
    >
      {text}
    </Typography>
  );
}

export function Section({
  title,
  note,
  caution,
  children,
}: {
  title: string;
  /** 定義・数え方。ⓘのツールチップに入る（常時表示はしない） */
  note: string;
  /** 数字を読むのに必須の短い注記。指定したときだけ見出しの下に出す */
  caution?: string;
  children: ReactNode;
}) {
  return (
    <Card variant="outlined">
      <CardContent
        sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}
      >
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Typography variant="subtitle1" fontWeight={700}>
            {title}
          </Typography>
          <InfoTip label={title} text={note} size={16} />
        </Stack>
        {caution ? <Caution text={caution} /> : null}
        <Divider sx={{ my: 1.25 }} />
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** グラフ等をセクション内で横幅いっぱいに置く */
export function FullWidth({ children }: { children: ReactNode }) {
  return <Box sx={{ width: "100%" }}>{children}</Box>;
}

/** 前期間の値を、その指標の種類に合わせて文字にする */
function prevText(trend: KpiTrend): string {
  if (trend.previous === null) return "—";
  if (trend.kind === "rate") return pct(trend.previous);
  if (trend.kind === "avg") return num(trend.previous);
  return trend.previous.toLocaleString();
}

/** 増減そのものの表示。率はポイント差、件数・平均は変化率 (#266)。
 * 出せないとき（前期間0・母数が少ない）は null を返して前期間の値だけ見せる。
 *
 * 色は**表示する桁に丸めたあとの値**で決める。丸めて 0 になる増減
 * （+0.4% → 「0%」）に矢印と色を付けると、増えていないのに増えたように読める。 */
function deltaOf(trend: KpiTrend): { text: string; tone: KpiTone } | null {
  if (trend.isNew) return { text: "新規", tone: trend.tone };
  if (trend.ratio !== null) return shown(trend, trend.ratio * 100, 0, "%");
  if (trend.diff !== null) return shown(trend, trend.diff * 100, 1, "pt");
  return null;
}

function shown(
  trend: KpiTrend,
  raw: number,
  digits: number,
  unit: string,
): { text: string; tone: KpiTone } {
  const v = Number(raw.toFixed(digits));
  const sign = v > 0 ? "▲" : v < 0 ? "▼" : "±";
  return {
    text: `${sign}${Math.abs(v).toFixed(digits)}${unit}`,
    // 丸めて 0 になったら「変化なし」として色を付けない
    tone: v === 0 ? "flat" : trend.tone,
  };
}

/** 前期間比。数字が主役という設計を崩さないよう、値の下に小さく1行だけ添える。
 * 色は指標ごとの方向（KPI_METRICS）に従うので、キャンセル率が減ったときは緑になる */
export function TrendNote({ trend }: { trend: KpiTrend }) {
  const delta = deltaOf(trend);
  return (
    <Typography
      variant="caption"
      sx={{
        display: "block",
        mt: 0.25,
        fontSize: 11,
        lineHeight: 1.3,
        color: "text.secondary",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      前期間 {prevText(trend)}
      {delta ? (
        <Box
          component="span"
          sx={{
            ml: 0.5,
            fontWeight: 700,
            color: (t) =>
              delta.tone === "good"
                ? t.palette.mode === "light"
                  ? t.palette.success.dark
                  : t.palette.success.light
                : delta.tone === "bad"
                  ? t.palette.mode === "light"
                    ? t.palette.error.dark
                    : t.palette.error.light
                  : "text.secondary",
          }}
        >
          {delta.text}
        </Box>
      ) : null}
    </Typography>
  );
}

export function Tile({
  label,
  value,
  text,
  hint,
  big,
  trend,
}: {
  label: string;
  value?: number;
  text?: string;
  /** 計算式・定義。ⓘのツールチップに入る */
  hint: string;
  big?: boolean;
  /** 前期間比 (#266)。全期間を選んだときや前期間を集計していない指標では null */
  trend?: KpiTrend | null;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        // 360px 幅の端末でも2列並ぶ寸法（Container の余白24〜32px と
        // セクションの余白24px を引いた実効幅 ≒ 300px に2枚入る）
        flex: big ? "1 1 220px" : "1 1 140px",
        minWidth: 130,
        // 端数の1枚が横いっぱいに伸びて数字が孤立して見えるのを防ぐ
        // （モバイルは1列に伸びてよいので上限を掛けない）
        maxWidth: { xs: "none", sm: big ? 420 : 320 },
        display: "flex",
      }}
    >
      {/* ラベルが1行か2行かで数値の高さがずれると横に読みにくいので、
          数値は下端に揃える（同じ行のカードは高さが揃う） */}
      <CardContent
        sx={{
          px: 1.5,
          py: 1,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 0.25,
          "&:last-child": { pb: 1 },
        }}
      >
        <Stack direction="row" spacing={0.25} alignItems="flex-start">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ lineHeight: 1.35, mt: 0.25, lineBreak: "strict" }}
          >
            {label}
          </Typography>
          <InfoTip label={label} text={hint} />
        </Stack>
        <Box>
          <Typography
            fontWeight={800}
            sx={{
              // 狭い端末では字を落として桁数の多い数値が切れないようにする
              // （Card は overflow:hidden なので、縮めないと無言で欠ける）
              fontSize: big
                ? { xs: 26, sm: 32 }
                : { xs: 21, sm: 26 },
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
            }}
          >
            {text ?? (value ?? 0).toLocaleString()}
          </Typography>
          {trend ? <TrendNote trend={trend} /> : null}
        </Box>
      </CardContent>
    </Card>
  );
}

/** 推移グラフの系列 */
export interface TrendSeries {
  key: string;
  label: string;
  /** MUI のパレット指定（'primary.main' など） */
  color: string;
  /** 週次にまとめるときの畳み方。省略時は合計（件数の系列） */
  weekly?: "sum" | "average" | "last";
}

function SeriesLabel({ color, text }: { color: string; text: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: color }} />
      <Typography variant="caption">{text}</Typography>
    </Stack>
  );
}

function fmtValue(v: number | null): string {
  if (v === null) return "—";
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
}

/** 日別/週別の推移（チャートライブラリは追加せず、既存の素朴な棒グラフを拡張したもの）。
 *
 * - 同じチャートに複数系列を描くときは目盛りを共通にする（系列ごとに正規化すると
 *   同じ高さの棒が違う値を意味してしまう）
 * - 期間が長いときは週次にまとめる。**端の欠けた週は出さない**（3日ぶんの週を
 *   7日ぶんの週と並べると落ち込んだように見える）ので、その旨も画面に出す
 * - 値が null の日は「まだ計測していない」。棒を描かず 0 とも区別する */
export function TrendChart({
  title,
  hint,
  caution,
  points,
  series,
  unit = "",
}: {
  title: string;
  hint?: string;
  /** 数字を読むのに必須の注記（MAU の立ち上がりなど） */
  caution?: string;
  points: KpiSeriesPoint[];
  series: TrendSeries[];
  unit?: string;
}) {
  const granularity: KpiGranularity = kpiGranularity(points.length);
  const shown =
    granularity === "week"
      ? toWeekly(points, {
          averageKeys: series.filter((s) => s.weekly === "average").map((s) => s.key),
          lastKeys: series.filter((s) => s.weekly === "last").map((s) => s.key),
        })
      : points;
  const max = Math.max(
    1,
    ...shown.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)),
  );
  return (
    <Card variant="outlined" sx={{ width: "100%" }}>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          sx={{ mb: 1 }}
          flexWrap="wrap"
          useFlexGap
        >
          <Stack
            direction="row"
            spacing={0.25}
            alignItems="center"
            sx={{ flex: 1, minWidth: 120 }}
          >
            <Typography variant="subtitle2">
              {title}（{granularity === "week" ? "週別" : "日別"}）
            </Typography>
            {hint ? <InfoTip label={title} text={hint} /> : null}
          </Stack>
          {series.map((s) => (
            <SeriesLabel key={s.key} color={s.color} text={s.label} />
          ))}
        </Stack>
        {caution ? <Caution text={caution} /> : null}
        {granularity === "week" ? (
          <Typography
            variant="caption"
            sx={{ display: "block", color: "text.secondary", mb: 0.5 }}
          >
            月曜始まりの週ごとの集計です。期間の端にある欠けた週は出していません。
          </Typography>
        ) : null}
        {shown.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            データなし
          </Typography>
        ) : (
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-end",
              gap: 0.75,
              height: 150,
              overflowX: "auto",
            }}
          >
            {shown.map((p) => (
              <Box
                key={p.day}
                title={`${p.day}  ${series
                  .map((s) => `${s.label}:${fmtValue(p.values[s.key] ?? null)}`)
                  .join(" / ")}`}
                sx={{
                  flex: "1 0 20px",
                  minWidth: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    gap: "2px",
                    height: 110,
                    width: "100%",
                  }}
                >
                  {series.map((s) => {
                    const v = p.values[s.key] ?? null;
                    return (
                      <Box
                        key={s.key}
                        sx={{
                          width: 8,
                          height: v === null ? 0 : `${(v / max) * 110}px`,
                          bgcolor: s.color,
                          borderRadius: "2px 2px 0 0",
                          minHeight: v !== null && v > 0 ? 2 : 0,
                        }}
                      />
                    );
                  })}
                </Box>
                <Typography
                  sx={{
                    fontSize: 9,
                    color: "text.secondary",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.day.slice(5)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        {unit ? (
          <Typography
            variant="caption"
            sx={{ display: "block", color: "text.secondary", mt: 0.5 }}
          >
            単位: {unit}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** 横棒の簡易グラフ（チャートライブラリは使わない） */
export function MiniBars({
  title,
  hint,
  items,
  unit,
  empty = "データなし",
}: {
  title: string;
  /** 数え方の補足。指定するとタイトル横のⓘに入る */
  hint?: string;
  /** key はラベルが重複しうるとき（コミュニティ名など）に渡す。省略時はラベルを使う */
  items: { key?: string; label: string; value: number }[];
  unit: string;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card variant="outlined" sx={{ width: "100%" }}>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack
          direction="row"
          spacing={0.25}
          alignItems="center"
          sx={{ mb: 0.75 }}
        >
          <Typography variant="subtitle2">{title}</Typography>
          {hint ? <InfoTip label={title} text={hint} /> : null}
        </Stack>
        {items.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {empty}
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {items.map((i) => (
              <Stack
                key={i.key ?? i.label}
                direction="row"
                spacing={1}
                alignItems="center"
              >
                <Typography
                  variant="caption"
                  sx={{ width: 90, flexShrink: 0, color: "text.secondary" }}
                >
                  {i.label}
                </Typography>
                <Box
                  sx={{
                    flex: 1,
                    height: 10,
                    bgcolor: "action.hover",
                    borderRadius: 1,
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      width: `${(i.value / max) * 100}%`,
                      height: "100%",
                      bgcolor: "primary.main",
                    }}
                  />
                </Box>
                <Typography variant="caption" sx={{ width: 64, textAlign: "right" }}>
                  {i.value.toLocaleString()}
                  {unit}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
