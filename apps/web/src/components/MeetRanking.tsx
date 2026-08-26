import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import HandshakeOutlinedIcon from "@mui/icons-material/HandshakeOutlined";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { MeetRankingLive } from "@eventer/shared";
import { useMeetRankingLive } from "../api/eventMeetHooks.js";

/**
 * 出会いランキング (#418)。
 *
 * - `MeetRankingBoard` … 投影ページ用の描画。会場で読める大きさ・ダーク固定
 *   （配信画面と同じ夜空系。周囲の投影と並べても浮かない）
 * - `MeetRankingPanel` … イベント詳細ページの小さなカード。投影ページへの入口を兼ねる
 *
 * どちらもデータは同じ live API（5秒ポーリング）。オフのイベント・非メンバーには
 * サーバーが 404 を返すので、ここでの出し分けは利便のためで防御ではない。
 */

/** 投影のダーク配色（LiveScreenPage・デフォルト配信セットと同系） */
export const BOARD_BG = "#0E1426";
export const BOARD_TEXT = "#EAF0F7";
export const BOARD_SUB = "#97A3BC";
export const BOARD_ACCENT = "#2DD4BF";
/** 1〜3位のメダル色 */
const MEDAL = ["#FFD54F", "#CFD8DC", "#D8A47F"] as const;

/** 行の基準の高さ（scale 1）。1〜3位は大きく出す */
const ROW_H_TOP = 96;
const ROW_H = 64;

function rankColor(rank: number): string {
  return rank <= 3 ? MEDAL[rank - 1] : BOARD_SUB;
}

interface BoardRow {
  /** 行の同一性（named は userId / anonymous は件数）。top の遷移はこれが保つ */
  key: string;
  rank: number;
  /** named の名前部。anonymous は「N人と出会った」の文 */
  label: string;
  avatarUrl?: string | null;
  /** 右端の値（named は件数 / anonymous は同数の人数。1人なら空） */
  value: string;
  /** value が変わった瞬間のパルス起動用（key の差し替えでアニメが再生される） */
  valueKey: string;
}

function toBoardRows(data: MeetRankingLive, t: TFunction): BoardRow[] {
  if (data.mode === "named") {
    return data.ranking.map((r) => ({
      key: r.userId,
      rank: r.rank,
      label: r.name,
      avatarUrl: r.avatarUrl,
      value: t("eventSocial.meetRankingCount", { n: r.count }),
      valueKey: `n-${r.count}`,
    }));
  }
  return data.ranking.map((r) => ({
    key: `c-${r.count}`,
    rank: r.rank,
    label: t("eventSocial.meetRankingAnonRow", { n: r.count }),
    value:
      r.people > 1 ? t("eventSocial.meetRankingAnonPeople", { n: r.people }) : "",
    valueKey: `p-${r.people}`,
  }));
}

/**
 * 投影用の一覧。行を絶対配置し、順位変動は top の CSS transition で
 * 「するっと」入れ替える（FLIP相当・CSSのみ。ライブラリは使わない）。
 */
export function MeetRankingBoard({
  data,
  scale,
}: {
  data: MeetRankingLive;
  scale: number;
}) {
  const { t } = useTranslation();
  const rows = toBoardRows(data, t);

  let offset = 0;
  const positioned = rows.map((r) => {
    const top3 = r.rank <= 3;
    const height = (top3 ? ROW_H_TOP : ROW_H) * scale;
    const top = offset;
    offset += height;
    return { ...r, top3, height, top };
  });

  if (positioned.length === 0) {
    return (
      <Typography
        sx={{ fontSize: 28 * scale, color: BOARD_SUB, textAlign: "center", py: 4 }}
      >
        {t("eventSocial.meetRankingEmpty")}
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        position: "relative",
        height: offset,
        "@keyframes meetCountPulse": {
          "0%": { transform: "scale(1.35)", opacity: 0.4 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
        "@keyframes meetRowIn": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      {positioned.map((r) => (
        <Box
          key={r.key}
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            top: r.top,
            height: r.height,
            display: "flex",
            alignItems: "center",
            gap: `${16 * scale}px`,
            px: 1,
            // 順位変動はこの transition が受け持つ
            transition: "top 500ms ease",
            // 圏外→圏内の行はフェードイン
            animation: "meetRowIn 400ms ease",
          }}
        >
          <Typography
            component="span"
            sx={{
              width: 72 * scale,
              textAlign: "right",
              fontSize: (r.top3 ? 44 : 28) * scale,
              fontWeight: 800,
              color: rankColor(r.rank),
              flexShrink: 0,
            }}
          >
            {r.rank}
          </Typography>
          {r.avatarUrl !== undefined && (
            <Avatar
              src={r.avatarUrl ?? undefined}
              sx={{
                width: (r.top3 ? 64 : 44) * scale,
                height: (r.top3 ? 64 : 44) * scale,
                fontSize: (r.top3 ? 30 : 20) * scale,
              }}
            >
              {r.label.charAt(0)}
            </Avatar>
          )}
          <Typography
            component="span"
            noWrap
            sx={{
              flex: 1,
              minWidth: 0,
              fontSize: (r.top3 ? 40 : 26) * scale,
              fontWeight: r.top3 ? 800 : 600,
              color: BOARD_TEXT,
            }}
          >
            {r.label}
          </Typography>
          {r.value && (
            <Typography
              component="span"
              key={r.valueKey}
              sx={{
                fontSize: (r.top3 ? 44 : 28) * scale,
                fontWeight: 800,
                color: BOARD_ACCENT,
                flexShrink: 0,
                animation: "meetCountPulse 700ms ease",
              }}
            >
              {r.value}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

/**
 * イベント詳細ページの小さなランキングカード。上位3位ぶんと自分の順位だけ出し、
 * 全体は投影ページへ誘導する。設定がオンのイベントの確定メンバーにだけ描画される
 * （出し分けは呼び出し側 EventDetailPage）。
 */
export function MeetRankingPanel({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const { data } = useMeetRankingLive(eventId, true);
  if (!data) return null;

  const rows = toBoardRows(data, t).filter((r) => r.rank <= 3);

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <HandshakeOutlinedIcon fontSize="small" />
          {t("eventSocial.meetRankingHeading")}
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("eventSocial.meetRankingEmpty")}
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {rows.map((r) => (
              <Stack key={r.key} direction="row" spacing={1.5} alignItems="center">
                <Typography
                  variant="body2"
                  fontWeight={700}
                  sx={{ width: 24, textAlign: "right", color: "secondary.main" }}
                >
                  {r.rank}
                </Typography>
                {r.avatarUrl !== undefined && (
                  <Avatar
                    src={r.avatarUrl ?? undefined}
                    sx={{ width: 28, height: 28, fontSize: 14 }}
                  >
                    {r.label.charAt(0)}
                  </Avatar>
                )}
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {r.label}
                </Typography>
                {r.value && (
                  <Typography variant="body2" fontWeight={700}>
                    {r.value}
                  </Typography>
                )}
              </Stack>
            ))}
          </Stack>
        )}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mt: 1.5 }}
        >
          <Typography variant="caption" color="text.secondary">
            {data.me
              ? t("eventSocial.meetRankingMe", {
                  rank: data.me.rank,
                  count: data.me.count,
                })
              : t("eventSocial.meetRankingTotal", { n: data.totalRanked })}
          </Typography>
          <Button
            component={RouterLink}
            to={`/events/${eventId}/meet-ranking/screen`}
            size="small"
            startIcon={<OpenInFullIcon />}
          >
            {t("eventSocial.meetRankingOpenScreen")}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
