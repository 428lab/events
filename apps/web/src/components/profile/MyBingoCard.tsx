import {
  Box,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMyBingoResults } from "../../api/bingoHooks.js";
import { formatDateTime } from "../../lib/format.js";

/**
 * 本人プロフィール（マイページ）のビンゴ成績 (#441)。
 *
 * **本人にだけ**出す（drafts タブと同じ出し分け。docs/bingo-history.md §3.5）。
 * サーバーも /me 配下で本人の行しか返さないので、この出し分けは利便であって
 * 防御ではない。成績が1件も無ければカードごと出さない。
 * 集計の分母: 達成率＝全ラウンド / 平均順位・平均抽選回数＝達成ラウンドのみ。
 */
export function MyBingoCard({ isMe }: { isMe: boolean }) {
  const { t } = useTranslation();
  const { data } = useMyBingoResults(isMe);
  // results が無い・空なら何も出さない（応答が想定外の形でも黙って消えるだけにする）
  if (!isMe || !data?.results?.length) return null;

  const round1 = (v: number) => Math.round(v * 10) / 10;
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <CasinoOutlinedIcon fontSize="small" />
          {t("profile.bingoHeading")}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t("profile.bingoOwnOnly")}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label={t("profile.bingoGames", { n: data.games })} />
          <Chip
            size="small"
            variant="outlined"
            color="success"
            label={t("profile.bingoAchieved", { n: data.achieved })}
          />
          {data.avgRank !== null && (
            <Chip
              size="small"
              variant="outlined"
              label={t("profile.bingoAvgRank", { n: round1(data.avgRank) })}
            />
          )}
          {data.avgSeq !== null && (
            <Chip
              size="small"
              variant="outlined"
              label={t("profile.bingoAvgSeq", { n: round1(data.avgSeq) })}
            />
          )}
        </Stack>
        <Stack spacing={0.75}>
          {data.results.map((r) => (
            <Box key={`${r.eventId}:${r.endedAt}`}>
              <Link
                component={RouterLink}
                to={`/events/${r.eventId}`}
                underline="hover"
                variant="body2"
                fontWeight={600}
              >
                {r.eventTitle}
              </Link>
              <Typography variant="caption" color="text.secondary" display="block">
                {formatDateTime(r.endedAt)} ・{" "}
                {r.rank !== null
                  ? t("profile.bingoRowDone", {
                      // rank が入っている行は seq も必ず入っている（?? 0 は型の絞り込み）
                      seq: r.completedAtSeq ?? 0,
                      total: r.drawnTotal,
                      rank: r.rank,
                    })
                  : t("profile.bingoRowMissed", { total: r.drawnTotal })}
              </Typography>
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
