import type { ReactNode } from "react";
import {
  Box,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
} from "@mui/material";

/** KPI 画面共通の表示部品。運営ダッシュボード (#257) とコミュニティ別KPI (#262) で使う */

/** 率の表示。分母0・母数不足（null）は「—」 */
export function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

/** 平均値の表示。分母0（null）は「—」 */
export function num(v: number | null, digits = 1): string {
  return v === null ? "—" : v.toFixed(digits);
}

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
        <Divider sx={{ my: 1.5 }} />
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
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
  hint: string;
  big?: boolean;
}) {
  return (
    <Card
      variant="outlined"
      sx={{ flex: big ? "1 1 260px" : "1 1 200px", minWidth: 180 }}
    >
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant={big ? "h3" : "h4"} fontWeight={700}>
          {text ?? (value ?? 0).toLocaleString()}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 0.5, lineHeight: 1.4 }}
        >
          {hint}
        </Typography>
      </CardContent>
    </Card>
  );
}

/** 横棒の簡易グラフ（チャートライブラリは使わない） */
export function MiniBars({
  title,
  items,
  unit,
  empty = "データなし",
}: {
  title: string;
  items: { label: string; value: number }[];
  unit: string;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card variant="outlined" sx={{ width: "100%" }}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {title}
        </Typography>
        {items.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {empty}
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {items.map((i) => (
              <Stack key={i.label} direction="row" spacing={1} alignItems="center">
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
