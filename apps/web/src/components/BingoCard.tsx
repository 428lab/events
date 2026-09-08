import { useId } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BINGO_COLUMNS,
  BINGO_FREE_CELL,
  cellToCardIndex,
  type EventRole,
  type BingoState,
} from "@eventer/shared";

/**
 * ビンゴカードの描画 (#436)。参加者のカード画面と投影の見本が共用する。
 * numbers はサーバー発行の24個（列優先・FREE抜き）。マークは公開済み番号との
 * 突き合わせだけで、押す操作は無い（自動マーク）。
 */
export function BingoCard({
  numbers,
  drawn,
  cellSize = 56,
}: {
  numbers: number[];
  drawn: number[];
  cellSize?: number;
}) {
  const { t } = useTranslation();
  const drawnSet = new Set(drawn);
  const size = `var(--bingo-card-cell-size, ${cellSize}px)`;
  return (
    <Box sx={{ display: "inline-block" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(5, ${size})`,
          gap: 0.5,
          mb: 0.5,
        }}
      >
        {BINGO_COLUMNS.map((label) => (
          <Typography
            key={label}
            align="center"
            sx={{ fontWeight: 800, color: "primary.main", fontSize: `calc(${size} * 0.4)` }}
          >
            {label}
          </Typography>
        ))}
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(5, ${size})`,
          gridTemplateRows: `repeat(5, ${size})`,
          gap: 0.5,
        }}
      >
        {/* 表示は行優先（r*5+c）に並べ替える。データは列優先（c*5+r） */}
        {Array.from({ length: 25 }, (_v, i) => {
          const r = Math.floor(i / 5);
          const col = i % 5;
          const cell = col * 5 + r;
          const idx = cellToCardIndex(cell);
          const free = cell === BINGO_FREE_CELL;
          const n = idx === null ? null : numbers[idx]!;
          const marked = free || (n !== null && drawnSet.has(n));
          return (
            <Box
              key={cell}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 1,
                border: 1,
                borderColor: marked ? "primary.main" : "divider",
                bgcolor: marked ? "primary.main" : "background.paper",
                color: marked ? "primary.contrastText" : "text.primary",
                fontWeight: 700,
                fontSize: `calc(${size} * ${free ? 0.28 : 0.36})`,
              }}
            >
              {free ? t("eventSocial.bingoFree") : n}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * イベント詳細ページのビンゴ導線カード (#436/#500)。
 * 配置を決める親が取得した状態を表示する。ゲームなしでは何も描かない。
 */
export function BingoPanel({
  eventId,
  myRole,
  data,
}: {
  eventId: string;
  myRole: EventRole | null;
  data: BingoState | undefined;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  if (!data || data.status === "none") return null;
  const statusLabel = data.status === "setup"
    ? t("eventSocial.bingoStatusSetup")
    : data.status === "running"
      ? t("eventSocial.bingoStatusRunning")
      : t("eventSocial.bingoStatusEnded");
  return (
    <Card component="section" aria-labelledby={headingId} variant="outlined" sx={{ borderColor: "primary.main" }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography
            id={headingId}
            component="h2"
            variant="h5"
            sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 700 }}
          >
            <CasinoOutlinedIcon color="primary" />
            {t("eventSocial.bingoSectionTitle")}
          </Typography>
          <Chip size="small" variant="outlined" label={statusLabel} />
          {data.me?.bingo ? (
            <Chip size="small" color="success" label={t("eventSocial.bingoBingo")} />
          ) : data.me?.reach ? (
            <Chip size="small" color="warning" label={t("eventSocial.bingoReach")} />
          ) : null}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {data.status === "setup"
            ? t("eventSocial.bingoWaiting")
            : data.status === "ended"
              ? t("eventSocial.bingoEnded")
              : t("eventSocial.bingoCounts", {
                  cards: data.counts.cards,
                  bingo: data.counts.bingo,
                  reach: data.counts.reach,
                })}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            size="large"
            startIcon={<CasinoOutlinedIcon />}
            component={RouterLink}
            to={`/events/${eventId}/bingo`}
            sx={{ width: { xs: "100%", sm: "auto" }, minHeight: 48 }}
          >
            {t("eventSocial.bingoDetailLink")}
          </Button>
          {myRole === "staff" && (
            <Button component={RouterLink} to={`/events/${eventId}/bingo/control`}>
              {t("eventSocial.bingoControlLink")}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
