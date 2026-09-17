import { useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { useTranslation } from "react-i18next";
import { AWARDS_DRUMROLL_MS, type AwardResultView } from "@eventer/shared";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { useAwards, useAwardsAdvance, useAwardsReset } from "../api/awardHooks.js";
import { useAwardsSync } from "../api/useAwardsSync.js";
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
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const { data: awards, refetch: refetchAwards } = useAwards(id);
  useAwardsSync(id, Boolean(eventData));
  const { data: state } = useEventState(id, true);
  const advance = useAwardsAdvance(id);
  const reset = useAwardsReset(id);
  const notifyWinners = useNotifyAwardWinners(id);
  const resolveUser = useEntryUserResolver(id);
  /** 通知した人数。**訳した文字列ではなく数を持つ**ので、
   *  言語を切り替えても前の言語のまま残らない。
   *
   *  なお**エラー文言を訳した文字列のまま state に持つ書き方**は、
   *  チャット・コメント・写真・Q&A に第1段階から残っている。ここだけ数に
   *  直したのは単複の選択が要るからで、扱いを分けたわけではない。
   *  まとめてどうするかは #369 で決める。 */
  const [notifiedCount, setNotifiedCount] = useState<number | null>(null);
  const prevCursor = useRef<{ eventId: string; cursor: number } | null>(null);
  const celebrateCursor = useRef<string | null>(null);
  // 演出終了と、新しいcursorでの結果取得の両方が揃うまで結果を隠す。
  const [drumrolling, setDrumrolling] = useState(false);
  const [readyCursor, setReadyCursor] = useState<number | null>(null);
  const [resultsFailed, setResultsFailed] = useState(false);
  const [retry, setRetry] = useState(0);

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

  const hasState = Boolean(state);
  useEffect(() => {
    if (!hasState || !eventData) return;
    let stopped = false;
    let cancelDrumroll: (() => void) | undefined;
    const previous = prevCursor.current;
    const advancing = previous?.eventId === id && cursor > previous.cursor;
    prevCursor.current = { eventId: id, cursor };
    setReadyCursor(null);
    setResultsFailed(false);
    setDrumrolling(false);
    const elapsed = Math.max(0, Date.now() - state!.updatedAt);
    celebrateCursor.current = null;
    if (advancing && elapsed < AWARDS_DRUMROLL_MS) {
      celebrateCursor.current = `${id}:${cursor}`;
      setDrumrolling(true);
      cancelDrumroll = playDrumroll(() => {
        if (stopped) return;
        setDrumrolling(false);
      }, elapsed);
    }
    // pollで進んだ場合にも必須。signalによるinvalidateだけには依存しない。
    void refetchAwards({ throwOnError: true }).then(() => {
      if (!stopped) setReadyCursor(cursor);
    }).catch(() => {
      if (!stopped) setResultsFailed(true);
    });
    const stop = () => {
      stopped = true;
      cancelDrumroll?.();
    };
    const onAccessReset = (event: Event) => {
      const target = (event as CustomEvent<string | undefined>).detail;
      if (!target || target === id) {
        stop();
        setReadyCursor(null);
        setDrumrolling(false);
      }
    };
    window.addEventListener("event-access-reset", onAccessReset);
    return () => {
      window.removeEventListener("event-access-reset", onAccessReset);
      stop();
    };
    // updatedAtはcursor変化時だけ採用する。他の進行操作で演出をやり直さない。
  }, [id, cursor, hasState, Boolean(eventData), eventData?.event.accessRevision, refetchAwards, retry]);

  useEffect(() => {
    if (readyCursor === cursor && !drumrolling && celebrateCursor.current === `${id}:${cursor}`) {
      celebrateCursor.current = null;
      playFanfare();
      fireConfetti();
    }
  }, [id, cursor, readyCursor, drumrolling]);

  const resultsError = (
    <Alert severity="error" action={<Button color="inherit" onClick={() => setRetry(n => n + 1)}>{t("common.retry")}</Button>}>
      {t("eventRun.awardsRefreshFailed")}
    </Alert>
  );
  if (!awards && resultsFailed) return resultsError;
  if (!eventData || !awards || !state) {
    return <Typography>{t("common.loading")}</Typography>;
  }

  const criteria = awards.criteria;

  return (
    <Stack spacing={3} alignItems="center" sx={{ textAlign: "center" }}>
      <Chip
        color="secondary"
        label={t("eventDetail.awards")}
        sx={{ color: "#fff" }}
      />

      {!latest && resultsFailed && resultsError}
      {!latest ? (
        <Typography variant="h4" color="text.secondary" sx={{ py: 6 }}>
          {t("eventRun.ceremonySoon")}
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
              {t(
                latest.kind === "special"
                  ? "eventRun.awardKindSpecial"
                  : "eventRun.awardKindRank",
              )}
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
                  {t("eventRun.drumroll")}
                </Typography>
                <LinearProgress
                  color="inherit"
                  sx={{ maxWidth: 320, mx: "auto", opacity: 0.8 }}
                />
              </Box>
            ) : resultsFailed ? resultsError : readyCursor !== cursor ? (
              <Typography sx={{ my: 2 }}>{t("common.loading")}</Typography>
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
                  {t(
                    latest.result.total === 1
                      ? "eventRun.totalPointOne"
                      : "eventRun.totalPoints",
                    { n: latest.result.total },
                  )}
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
                {t("eventDetail.noRecipient")}
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {isStaff && (
        <Stack spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            {t("eventRun.revealProgress", {
              n: cursor,
              total: sequence.length,
            })}
          </Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
            <Button variant="outlined" onClick={() => reset.mutate()}>
              {t("eventRun.revealReset")}
            </Button>
            <Button
              variant="contained"
              disabled={cursor >= sequence.length || advance.isPending || drumrolling || readyCursor !== cursor}
              onClick={() => advance.mutate()}
            >
              {t(
                cursor >= sequence.length
                  ? "eventRun.revealAllDone"
                  : "eventRun.revealNext",
              )}
            </Button>
          </Stack>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<EmojiEventsIcon />}
            disabled={cursor < sequence.length || notifyWinners.isPending}
            onClick={() =>
              notifyWinners.mutate(undefined, {
                onSuccess: (r) => setNotifiedCount(r.notified),
              })
            }
          >
            {t("eventRun.notifyWinners")}
          </Button>
          {cursor < sequence.length && (
            <Typography variant="caption" color="text.disabled">
              {t("eventRun.notifyAfterAll")}
            </Typography>
          )}
          {notifiedCount !== null && (
            <Typography variant="caption" color="success.main">
              {t(
                notifiedCount === 1
                  ? "eventRun.notifiedWinnerOne"
                  : "eventRun.notifiedWinners",
                { n: notifiedCount },
              )}
            </Typography>
          )}
          <Button
            size="small"
            color="inherit"
            component={RouterLink}
            to={`/events/${id}/control#ceremony`}
          >
            {t("eventRun.backToControl")}
          </Button>
        </Stack>
      )}

      {readyCursor === cursor && revealed.length > 1 && (
        <Stack spacing={1} sx={{ width: "100%", maxWidth: 560 }}>
          <Typography variant="subtitle2" color="text.secondary">
            {t("eventRun.revealedHeading")}
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
                      {t("eventDetail.noRecipient")}
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
