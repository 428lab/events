import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { AwardResultView } from "@eventer/shared";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { useAwards, useAwardsAdvance, useAwardsReset } from "../api/awardHooks.js";
import { useNotifyAwardWinners } from "../api/notificationHooks.js";
import { UserLink } from "../components/UserLink.js";
import { useEntryUserResolver } from "../lib/entryUser.js";
import { RadarChart } from "../components/RadarChart.js";
import { fireConfetti, playDrumroll, playFanfare } from "../lib/effects.js";

interface RevealItem {
  key: string;
  kind: "rank" | "special";
  awardName: string;
  content: string | null;
  result: AwardResultView | undefined;
}

export function AwardsPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const { data: awards } = useAwards(id);
  const { data: state } = useEventState(id, true);
  const advance = useAwardsAdvance(id);
  const reset = useAwardsReset(id);
  const notifyWinners = useNotifyAwardWinners(id);
  const resolveUser = useEntryUserResolver(id);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);
  const prevCursor = useRef<number | null>(null);
  // ドラムロール中は結果を隠す
  const [drumrolling, setDrumrolling] = useState(false);

  const isStaff = eventData?.myRole === "staff" || isAdmin;
  const cursor = state?.awardsRevealCursor ?? 0;

  // 発表順: ランキングは下位（rankOrder 大）から、その後に特別枠
  const sequence: RevealItem[] = [];
  if (awards) {
    [...awards.ranks]
      .sort((a, b) => b.rankOrder - a.rankOrder)
      .forEach((r) =>
        sequence.push({
          key: `rank-${r.id}`,
          kind: "rank",
          awardName: r.name,
          content: r.content,
          result: awards.results.find((x) => x.awardRankId === r.id),
        }),
      );
    [...awards.specials]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((s) =>
        sequence.push({
          key: `special-${s.id}`,
          kind: "special",
          awardName: s.name,
          content: s.content,
          result: awards.results.find((x) => x.specialAwardId === s.id),
        }),
      );
  }

  const revealed = sequence.slice(0, cursor);
  const latest = cursor > 0 ? sequence[cursor - 1] : undefined;

  // カーソルが増えたら演出: ドラムロール再生 → 鳴り終わってから結果＋ファンファーレ＋紙吹雪
  useEffect(() => {
    if (prevCursor.current === null) {
      // 初回マウント（途中参加/リロード）は演出せず現状表示
      prevCursor.current = cursor;
      return;
    }
    if (cursor > prevCursor.current && cursor > 0) {
      setDrumrolling(true);
      playDrumroll(() => {
        setDrumrolling(false);
        playFanfare();
        fireConfetti();
      });
    }
    prevCursor.current = cursor;
  }, [cursor]);

  if (!eventData || !awards || !state) {
    return <Typography>読み込み中…</Typography>;
  }

  const criteria = awards.criteria;

  return (
    <Stack spacing={3} alignItems="center" sx={{ textAlign: "center" }}>
      <Chip color="secondary" label="表彰式" sx={{ color: "#fff" }} />

      {!latest ? (
        <Typography variant="h4" color="text.secondary" sx={{ py: 6 }}>
          まもなく発表します…
        </Typography>
      ) : (
        <Card
          elevation={8}
          sx={{
            width: "100%",
            maxWidth: 560,
            background: "linear-gradient(135deg,#14B8A6,#FB923C)",
            color: "#fff",
          }}
        >
          <CardContent sx={{ py: 4 }}>
            <Typography variant="overline" sx={{ opacity: 0.9 }}>
              {latest.kind === "special" ? "特別賞" : "ランキング"}
            </Typography>
            <Typography variant="h4" fontWeight={800} gutterBottom>
              {latest.awardName}
            </Typography>
            {drumrolling ? (
              <Box sx={{ py: 3 }}>
                <Typography variant="h2" sx={{ mb: 2 }}>
                  <MusicNoteIcon sx={{ fontSize: "inherit" }} />
                </Typography>
                <Typography variant="h5" sx={{ mb: 2 }}>
                  受賞は…？
                </Typography>
                <LinearProgress
                  color="inherit"
                  sx={{ maxWidth: 320, mx: "auto", opacity: 0.8 }}
                />
              </Box>
            ) : latest.result ? (
              <>
                <UserLink
                  username={resolveUser(latest.result.entryId)?.username}
                  name={latest.result.entryName}
                  withAvatar
                  avatarSize={56}
                  sx={{
                    my: 1,
                    justifyContent: "center",
                    fontSize: "3rem",
                    fontWeight: 900,
                  }}
                />
                <Typography variant="h6">
                  合計 {latest.result.total} 点
                </Typography>
                {latest.content && (
                  <Typography sx={{ mt: 1, opacity: 0.9 }}>
                    {latest.content}
                  </Typography>
                )}
                <Box
                  sx={{
                    mt: 2,
                    bgcolor: "#fff",
                    borderRadius: 2,
                    display: "inline-block",
                    p: 1,
                  }}
                >
                  <RadarChart
                    axes={criteria.map((cz) => ({
                      label: cz.name,
                      value: latest.result?.perCriterion[cz.id] ?? 0,
                    }))}
                  />
                </Box>
              </>
            ) : (
              <Typography variant="h5" sx={{ my: 2 }}>
                該当者なし
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {isStaff && (
        <Stack spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            発表 {cursor} / {sequence.length}
          </Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
            <Button variant="outlined" onClick={() => reset.mutate()}>
              リセット
            </Button>
            <Button
              variant="contained"
              disabled={cursor >= sequence.length || advance.isPending}
              onClick={() => advance.mutate()}
            >
              {cursor >= sequence.length ? "すべて発表済み" : "次を発表"}
            </Button>
          </Stack>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<EmojiEventsIcon />}
            disabled={cursor < sequence.length || notifyWinners.isPending}
            onClick={() =>
              notifyWinners.mutate(undefined, {
                onSuccess: (r) =>
                  setNotifyMsg(`受賞者 ${r.notified} 人に通知しました`),
              })
            }
          >
            受賞者にアプリ内通知
          </Button>
          {cursor < sequence.length && (
            <Typography variant="caption" color="text.disabled">
              （すべて発表後に通知できます）
            </Typography>
          )}
          {notifyMsg && (
            <Typography variant="caption" color="success.main">
              {notifyMsg}
            </Typography>
          )}
          <Button
            size="small"
            color="inherit"
            component={RouterLink}
            to={`/events/${id}/control`}
          >
            ← 進行コントロールへ戻る
          </Button>
        </Stack>
      )}

      {revealed.length > 1 && (
        <Stack spacing={1} sx={{ width: "100%", maxWidth: 560 }}>
          <Typography variant="subtitle2" color="text.secondary">
            発表済み
          </Typography>
          {revealed
            .slice(0, -1)
            .reverse()
            .map((item) => (
              <Card key={item.key} variant="outlined">
                <CardContent
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    py: 1.5,
                  }}
                >
                  <Typography>{item.awardName}</Typography>
                  {item.result ? (
                    <UserLink
                      username={resolveUser(item.result.entryId)?.username}
                      name={item.result.entryName}
                      sx={{ fontWeight: 600 }}
                    />
                  ) : (
                    <Typography fontWeight={600} color="text.secondary">
                      該当者なし
                    </Typography>
                  )}
                </CardContent>
              </Card>
            ))}
        </Stack>
      )}
    </Stack>
  );
}
