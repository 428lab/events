import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { Link as RouterLink } from "react-router-dom";
import { useEventEntries, useEventMembers, useMe } from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { useAwards } from "../api/awardHooks.js";
import { UserLink } from "./UserLink.js";

/**
 * コンテストの結果まわり (#183)。表彰の一覧と、詳細な結果ページへの導線。
 *
 * 出し方の条件（授賞式が最後まで進んだか、あるいはイベントが終わったか）ごと
 * ここに持たせてある。呼び出し側は「コンテストか」「終わったか」だけ渡す。
 */
export function EventAwards({
  eventId,
  contest,
  ended,
}: {
  eventId: string;
  contest: boolean;
  /** イベントが終了済みか。判定は useEventTiming が1か所で持つ */
  ended: boolean;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: awards } = useAwards(eventId);
  // 未ログインでは進行状態を取りに行かない（ページ本体と同じ条件にそろえる）
  const { data: state } = useEventState(eventId, Boolean(me));
  const { data: entries } = useEventEntries(eventId);
  const { data: members } = useEventMembers(eventId, true);

  const awardItems = awards
    ? [
        // ランキング賞は受賞者が設定されたものだけ。上位（rankOrder 小）から表示。
        ...[...awards.ranks]
          .sort((a, b) => a.rankOrder - b.rankOrder)
          .map((r) => ({
            key: `rank-${r.id}`,
            name: r.name,
            content: r.content,
            result: awards.results.find((x) => x.awardRankId === r.id),
          }))
          .filter((it) => it.result),
        // 特別枠は受賞者なし（該当者なし）も表示する
        ...awards.specials.map((s) => ({
          key: `special-${s.id}`,
          name: s.name,
          content: s.content,
          result: awards.results.find((x) => x.specialAwardId === s.id),
        })),
      ]
    : [];
  // 受賞エントリ→メンバーのアバター解決（個人エントリは1人。なければ頭文字）
  const entryById = new Map((entries ?? []).map((e) => [e.id, e] as const));
  const userById = new Map(
    (members ?? []).map((m) => [m.user.id, m.user] as const),
  );
  const resultAvatarUrl = (result?: { entryId: string }) => {
    const entry = result ? entryById.get(result.entryId) : undefined;
    const uid = entry?.memberUserIds[0];
    return uid ? (userById.get(uid)?.avatarUrl ?? undefined) : undefined;
  };
  const resultUsername = (result?: { entryId: string }) => {
    const entry = result ? entryById.get(result.entryId) : undefined;
    const uid =
      entry && entry.memberUserIds.length === 1
        ? entry.memberUserIds[0]
        : undefined;
    return uid ? userById.get(uid)?.username : undefined;
  };

  const ceremonyDone =
    (state?.awardsRevealCursor ?? 0) >=
    (awards ? awards.ranks.length + awards.specials.length : 0);
  const showAwards =
    contest && awardItems.length > 0 && (ceremonyDone || ended);
  const showResultsLink = contest && (ended || Boolean(state?.scoringLocked));

  if (!showAwards && !showResultsLink) return null;

  return (
    <>
      {showAwards && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <EmojiEventsIcon color="secondary" />
              <Typography variant="h6">
                {t("eventDetail.awardsHeading")}
              </Typography>
            </Stack>
            <Stack spacing={2} divider={<Divider flexItem />}>
              {awardItems.map((it) => (
                <Box key={it.key}>
                  {/* 1行目: 賞の名前 */}
                  <Box sx={{ mb: 1 }}>
                    <Chip
                      label={it.name}
                      color="secondary"
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                  {/* 2行目: 受賞者名 */}
                  {it.result ? (
                    <UserLink
                      username={resultUsername(it.result)}
                      name={it.result.entryName}
                      avatarUrl={resultAvatarUrl(it.result)}
                      withAvatar
                      avatarSize={28}
                      sx={{ fontSize: "1.25rem", fontWeight: 700 }}
                    />
                  ) : (
                    <Typography variant="h6" fontWeight={700} color="text.secondary">
                      {t("eventDetail.noRecipient")}
                    </Typography>
                  )}
                  {/* 3行目: 賞品 */}
                  {it.content && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      {it.content}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {showResultsLink && (
        <Stack direction="row">
          <Button
            variant="outlined"
            component={RouterLink}
            to={`/events/${eventId}/results`}
          >
            {t("eventDetail.viewResults")}
          </Button>
        </Stack>
      )}
    </>
  );
}
