import type { ReactNode } from "react";
import {
  Box,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
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

export function Tile({
  label,
  value,
  text,
  hint,
  big,
}: {
  label: string;
  value?: number;
  text?: string;
  /** 計算式・定義。ⓘのツールチップに入る */
  hint: string;
  big?: boolean;
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
            sx={{ lineHeight: 1.35, mt: 0.25 }}
          >
            {label}
          </Typography>
          <InfoTip label={label} text={hint} />
        </Stack>
        <Typography
          fontWeight={800}
          sx={{
            fontSize: big ? 32 : 26,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
          }}
        >
          {text ?? (value ?? 0).toLocaleString()}
        </Typography>
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
