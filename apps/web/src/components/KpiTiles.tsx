import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  toGranularity,
} from "@eventer/shared";
import { dateLocale, i18next } from "../i18n/index.js";
import { InfoTip } from "./InfoTip.js";

/** KPI 画面共通の表示部品。運営ダッシュボード (#257) とコミュニティ別KPI (#262) で使う。
 *
 * 文言は `kpi` 名前空間 (#376)。**管理ダッシュボードのページ本体は日本語のまま**
 * なので、英語表示にすると管理画面は枠が日本語・この部品だけ英語になる（決定済み）。 */

/** 'YYYY-MM-DD' を表示言語の長い日付表記に（日本語は「2026年8月20日」）。
 * 日付をそのまま出すより「いつから」が読み取りやすい。書式は Intl に任せ、
 * タイムゾーンは端末のまま（lib/format.ts と同じ扱い） */
export function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(dateLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(y, m - 1, d));
}

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
        // 仮引数は `theme`。`t` にすると翻訳関数を隠してしまう (#367)
        color: (theme) =>
          theme.palette.mode === "light"
            ? theme.palette.warning.dark
            : theme.palette.warning.main,
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
  if (trend.isNew) return { text: i18next.t("kpi.trendNew"), tone: trend.tone };
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
  const { t } = useTranslation();
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
      {t("kpi.previousPeriod", { value: prevText(trend) })}
      {delta ? (
        <Box
          component="span"
          sx={{
            ml: 0.5,
            fontWeight: 700,
            // 仮引数は `theme`。`t` にすると翻訳関数を隠してしまう (#367)
            color: (theme) =>
              delta.tone === "good"
                ? theme.palette.mode === "light"
                  ? theme.palette.success.dark
                  : theme.palette.success.light
                : delta.tone === "bad"
                  ? theme.palette.mode === "light"
                    ? theme.palette.error.dark
                    : theme.palette.error.light
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
  /** 週次・月次にまとめるときの畳み方。省略時は合計（件数の系列）。
   * 粒度によらず同じ指定が効く（DAU は週別でも月別でも平均） */
  rollup?: "sum" | "average" | "last";
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

/** 縦軸の目盛り用。桁数が増えても軸の幅が破綻しないよう短く出す */
function fmtAxis(v: number): string {
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** 目盛りの上限をきりのいい数にする。
 * 実データの最大値をそのまま上限にすると最大の棒が軸に張り付いて読みにくく、
 * 目盛りの数字も半端になる。倍率を 2/4/10 に限っているのは、中間の目盛り
 * （上限の半分）が整数側に寄るようにするため。 */
function axisMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  for (const n of [2, 4, 10]) {
    if (max <= n * pow) return n * pow;
  }
  return 10 * pow;
}

/** 粒度ごとの見出しの言い方。**訳した文字列ではなく翻訳キーを持つ**
 * （文字列を持つと言語を切り替えたとき前の言語のまま残る）。
 * 粒度が増えたら型で落ちる */
const GRANULARITY_LABEL_KEY = {
  day: "kpi.granularityDay",
  week: "kpi.granularityWeek",
  month: "kpi.granularityMonth",
} as const satisfies Record<KpiGranularity, string>;

/** 棒の下に出す日付。月別で「08-01」と出すと日別と見分けが付かない (#292) */
function barLabel(day: string, granularity: KpiGranularity): string {
  return granularity === "month" ? day.slice(0, 7) : day.slice(5);
}

/** ホバーで出す期間の言い方。月別の点は月初の日付を持つので、
 * そのまま出すと「その日だけの値」に読める。年月の書式は Intl に任せる */
function barPeriod(day: string, granularity: KpiGranularity): string {
  if (granularity === "month") {
    const [y, m] = day.split("-").map(Number);
    return new Intl.DateTimeFormat(dateLocale(), {
      year: "numeric",
      month: "long",
    }).format(new Date(y, m - 1, 1));
  }
  if (granularity === "week") return i18next.t("kpi.barPeriodWeek", { day });
  return day;
}

/** その系列に「計測した値」が1つでもあるか。
 * 値が null の点は「まだ計測していない」なので、0 と同じには数えない (#292) */
function hasMeasured(points: KpiSeriesPoint[], series: TrendSeries[]): boolean {
  return points.some((p) => series.some((s) => (p.values[s.key] ?? null) !== null));
}

/** グラフを描かずに文章で説明すべきとき、その**理由**。描いてよいときは null。
 *
 * 文言ではなく理由を返すのは、呼ぶ側が「注意書きとして目立たせるか、ただの
 * 補足として出すか」を選ぶため。**文言で見分けると訳した瞬間に壊れる** (#376)。 */
type ChartEmpty =
  | { kind: "noData" }
  | { kind: "beforeMeasured"; measuredFrom: string }
  | { kind: "neverMeasured" }
  | { kind: "partial"; granularity: "week" | "month" };

/** 軸だけのグラフを出すと「ずっと0だった」に見える。**0 なのか計測していないのか**が
 * 区別できることが要件 (#292)。 */
function emptyReason({
  points,
  shown,
  series,
  granularity,
  measuredFrom,
}: {
  points: KpiSeriesPoint[];
  shown: KpiSeriesPoint[];
  series: TrendSeries[];
  granularity: KpiGranularity;
  measuredFrom?: string | null;
}): ChartEmpty | null {
  if (hasMeasured(shown, series)) return null;
  if (points.length === 0) return { kind: "noData" };
  if (!hasMeasured(points, series)) {
    // 選んだ期間が丸ごと計測開始より前（または一度も計測していない）
    return measuredFrom
      ? { kind: "beforeMeasured", measuredFrom }
      : { kind: "neverMeasured" };
  }
  // 日次には値があるのに、まとめたら1つも残らなかった＝端の欠けたバケツしかない。
  // 日別なら shown と points が同じなので、ここへは週別・月別でしか来ない
  return {
    kind: "partial",
    granularity: granularity === "month" ? "month" : "week",
  };
}

/** 理由に対応する文言。理由が増えたら型で落ちる */
function emptyText(reason: ChartEmpty): string {
  switch (reason.kind) {
    case "noData":
      return i18next.t("kpi.noData");
    case "beforeMeasured":
      return i18next.t("kpi.chartMeasuredFromEmpty", {
        day: longDay(reason.measuredFrom),
      });
    case "neverMeasured":
      return i18next.t("kpi.chartNeverMeasured");
    case "partial":
      return reason.granularity === "month"
        ? i18next.t("kpi.chartPartialMonth")
        : i18next.t("kpi.chartPartialWeek");
  }
}

/** 日別/週別/月別の推移（チャートライブラリは追加せず、既存の素朴な棒グラフを拡張したもの）。
 *
 * - 同じチャートに複数系列を描くときは目盛りを共通にする（系列ごとに正規化すると
 *   同じ高さの棒が違う値を意味してしまう）
 * - 期間が長いときは週次・さらに長ければ月次にまとめる。**端の欠けた週・月は
 *   出さない**（3日ぶんの週を7日ぶんの週と並べると落ち込んだように見える）ので、
 *   その旨も画面に出す
 * - 値が null の日は「まだ計測していない」。棒を描かず 0 とも区別する。
 *   計測開始日 (measuredFrom) を渡すと、それが**いつからなのか**を文章でも出す */
export function TrendChart({
  title,
  hint,
  caution,
  points,
  series,
  unit = "",
  measuredFrom,
}: {
  title: string;
  hint?: string;
  /** 数字を読むのに必須の注記（MAU の立ち上がりなど） */
  caution?: string;
  points: KpiSeriesPoint[];
  series: TrendSeries[];
  unit?: string;
  /** その系列の計測開始日 (#292)。計測前の日は棒が無いので、説明が無いと
   * 「0が続いている」に見える。null は「まだ一度も計測していない」、
   * 省略は「計測開始という概念が無い系列」（件数など） */
  measuredFrom?: string | null;
}) {
  const { t } = useTranslation();
  const granularity: KpiGranularity = kpiGranularity(points.length);
  const shown = toGranularity(points, granularity, {
    averageKeys: series.filter((s) => s.rollup === "average").map((s) => s.key),
    lastKeys: series.filter((s) => s.rollup === "last").map((s) => s.key),
  });
  const empty = emptyReason({ points, shown, series, granularity, measuredFrom });
  // 計測開始が期間の途中なら、その前が「0」ではないことを明示する
  const startNote =
    !empty && measuredFrom && points[0] && measuredFrom > points[0].day
      ? t("kpi.chartMeasuredFrom", { day: longDay(measuredFrom) })
      : null;
  const max = Math.max(
    1,
    ...shown.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)),
  );
  // 棒の高さと目盛りは同じ上限で割る。実データの最大値をそのまま上限にすると
  // 目盛りが半端な数になり、最大の棒が軸に張り付いて読みにくい
  const scaleMax = axisMax(max);
  // 日付ラベルは「月-日」で約30px要るが、1本あたりの幅は20px。水平に並べると
  // 隣とくっついて数字の切れ目が分からなくなるので斜めに出す。斜めなら必要な
  // 間隔は約21pxで、日別で出す範囲（長い期間は週別に切り替わる）なら全部入る。
  // 極端に本数が多いときだけ間引く (#290)。月別のラベル（'2026-08'）は
  // 少し長いが、月別で本数が多くなるのは全期間だけで、そのときは間引きが効く
  const labelStep = shown.length > 40 ? Math.ceil(shown.length / 40) : 1;
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
              {t("kpi.chartTitle", {
                title,
                granularity: t(GRANULARITY_LABEL_KEY[granularity]),
              })}
            </Typography>
            {hint ? <InfoTip label={title} text={hint} /> : null}
          </Stack>
          {series.map((s) => (
            <SeriesLabel key={s.key} color={s.color} text={s.label} />
          ))}
        </Stack>
        {caution ? <Caution text={caution} /> : null}
        {startNote ? (
          <Typography
            variant="caption"
            sx={{ display: "block", color: "text.secondary", mb: 0.5 }}
          >
            {startNote}
          </Typography>
        ) : null}
        {!empty && granularity !== "day" ? (
          <Typography
            variant="caption"
            sx={{ display: "block", color: "text.secondary", mb: 0.5 }}
          >
            {granularity === "week"
              ? t("kpi.chartWeekNote")
              : t("kpi.chartMonthNote")}
          </Typography>
        ) : null}
        {empty ? (
          // 軸だけのグラフを出すと「全部0」に見えるので、グラフごと出さない (#292)。
          // 「データなし」だけは注意書きにしない（説明することが無いので目立たせない）
          empty.kind === "noData" ? (
            <Typography variant="caption" color="text.secondary">
              {emptyText(empty)}
            </Typography>
          ) : (
            <Caution text={emptyText(empty)} />
          )
        ) : (
          // 高さを固定しない。棒の並びを下揃えにすると日付ラベルのぶんだけ
          // 棒の足元が下がり、目盛りの 0 の線より下に飛び出してマイナスに見える
          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
            {/* 縦軸。棒の高さだけでは値が読めず、ツールチップはタッチ端末で開けない (#290) */}
            <Box
              sx={{
                width: 34,
                flexShrink: 0,
                height: 110,
                position: "relative",
                mr: 0.5,
              }}
            >
              {[1, 0.5, 0].map((r) => (
                <Typography
                  key={r}
                  sx={{
                    position: "absolute",
                    right: 0,
                    // 目盛りの線と文字の中心を合わせる
                    top: `${(1 - r) * 110}px`,
                    transform: "translateY(-50%)",
                    fontSize: 9,
                    color: "text.secondary",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtAxis(scaleMax * r)}
                </Typography>
              ))}
            </Box>
            <Box
              sx={{
                position: "relative",
                flex: 1,
                minWidth: 0,
                overflowX: "auto",
              }}
            >
              {/* 補助線。目盛りの文字と同じ位置に引く */}
              {[1, 0.5, 0].map((r) => (
                <Box
                  key={r}
                  sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: `${(1 - r) * 110}px`,
                    borderTop: "1px solid",
                    borderColor: "divider",
                    opacity: r === 0 ? 1 : 0.5,
                    pointerEvents: "none",
                  }}
                />
              ))}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 0.75,
                  position: "relative",
                }}
              >
                {shown.map((p, i) => (
              <Box
                key={p.day}
                title={`${barPeriod(p.day, granularity)}  ${series
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
                          height: v === null ? 0 : `${(v / scaleMax) * 110}px`,
                          bgcolor: s.color,
                          borderRadius: "2px 2px 0 0",
                          minHeight: v !== null && v > 0 ? 2 : 0,
                        }}
                      />
                    );
                  })}
                </Box>
                {/* 斜めに出す。列の中心から左下へ伸ばすので、列の幅を
                    広げずに隣とぶつからない */}
                <Box sx={{ height: 30, width: "100%", position: "relative" }}>
                  <Typography
                    sx={{
                      position: "absolute",
                      top: 2,
                      right: "50%",
                      transformOrigin: "top right",
                      transform: "rotate(-45deg)",
                      fontSize: 9,
                      color: "text.secondary",
                      whiteSpace: "nowrap",
                      visibility: i % labelStep === 0 ? "visible" : "hidden",
                    }}
                  >
                    {barLabel(p.day, granularity)}
                  </Typography>
                </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}
        {unit ? (
          <Typography
            variant="caption"
            sx={{ display: "block", color: "text.secondary", mt: 0.5 }}
          >
            {t("kpi.chartUnit", { unit })}
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
  unitOne,
  empty,
}: {
  title: string;
  /** 数え方の補足。指定するとタイトル横のⓘに入る */
  hint?: string;
  /** key はラベルが重複しうるとき（コミュニティ名など）に渡す。省略時はラベルを使う */
  items: { key?: string; label: string; value: number }[];
  unit: string;
  /** 値が 1 のときの単位。英語が「1 people」にならないよう、**数だけを見て**
   *  こちらに切り替える（言語による分岐は書かない）。省略時は `unit` のまま */
  unitOne?: string;
  /** 0件のときの言い方。省略時は「データなし」。**既定値は描画時に訳す**
   *  （引数の既定値に文言を置くと、その言語のまま固まる） */
  empty?: string;
}) {
  const { t } = useTranslation();
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
            {empty ?? t("kpi.noData")}
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
                  {t("kpi.valueWithUnit", {
                    value: i.value.toLocaleString(),
                    unit: i.value === 1 ? (unitOne ?? unit) : unit,
                  })}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
