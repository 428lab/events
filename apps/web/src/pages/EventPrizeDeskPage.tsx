import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { MeetPrizeStatus, MeetPrizeStatusRow } from "@eventer/shared";
import { meetPrizeImageUrl } from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import {
  useClearMeetWinners,
  useCloseMeetWinners,
  useMeetPrizeStatus,
  useRedeemMeetPrize,
  useUnredeemMeetPrize,
} from "../api/meetPrizeHooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { errorMessage } from "../lib/errorMessage.js";
import { i18next } from "../i18n/index.js";

/**
 * 景品の引き換えデスク (#431)。スタッフ専用の窓口画面。
 *
 * 参加者が達成画面（イベントページの景品カード）を見せに来る → ここの達成者
 * 一覧と名前を突き合わせる → 景品を渡して「交換済みにする」。達成の判定と
 * 在庫の確保はサーバーが引き換え時に行うので、この画面は表示と操作だけ。
 * 5秒ポーリングで、窓口の目の前でQRを読み合った直後の達成もすぐ出る。
 *
 * 見えるのは `myRole === "staff"` の人だけ（isAdmin は混ぜない #275）。
 * オフのイベントでも動く（仕込み・後片付け用。門は参加者向けの公開APIにだけある）。
 */

/** 引き換えが断られた理由を窓口の案内文言に（対応表は staffOps の1か所） */
function redeemErrorMessage(err: unknown): string {
  return errorMessage(err, {
    already_redeemed: i18next.t("staffOps.prizeRedeemAlready"),
    out_of_stock: i18next.t("staffOps.prizeRedeemOutOfStock"),
    not_achieved: i18next.t("staffOps.prizeRedeemNotAchieved"),
    not_confirmed: i18next.t("staffOps.prizeRedeemNotConfirmed"),
    default: i18next.t("staffOps.prizeRedeemFailed"),
  });
}

function PrizeCard({
  eventId,
  row,
  filter,
  onError,
}: {
  eventId: string;
  row: MeetPrizeStatusRow;
  filter: string;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const redeem = useRedeemMeetPrize(eventId);
  const unredeem = useUnredeemMeetPrize(eventId);
  const busy = redeem.isPending || unredeem.isPending;

  const q = filter.trim().toLowerCase();
  const achievers = q
    ? row.achievers.filter(
        (a) =>
          a.name.toLowerCase().includes(q) || a.username.toLowerCase().includes(q),
      )
    : row.achievers;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {row.prize.imageKey && (
            <Box
              component="img"
              src={meetPrizeImageUrl(eventId, row.prize.id, row.prize.imageKey) ?? undefined}
              alt={row.prize.name}
              sx={{ width: 40, height: 40, objectFit: "cover", borderRadius: 1 }}
            />
          )}
          {row.prize.conditionType === "top_rank" && (
            <EmojiEventsIcon fontSize="small" sx={{ color: "#FFD54F" }} />
          )}
          <Typography variant="h6">{row.prize.name}</Typography>
          <Chip
            size="small"
            variant="outlined"
            label={
              row.prize.conditionType === "meet_count"
                ? t("eventSocial.meetPrizeCondCount", { n: row.prize.threshold ?? 0 })
                : t("eventSocial.meetPrizeCondTop")
            }
          />
          <Chip
            size="small"
            color={row.stockLeft === 0 ? "default" : "info"}
            label={t("staffOps.prizeDeskStock", {
              left: row.stockLeft,
              total: row.prize.stock,
            })}
          />
          <Chip
            size="small"
            variant="outlined"
            label={t("staffOps.prizeDeskAchieversCount", {
              n: row.achievers.length,
            })}
          />
        </Stack>
        {row.achievers.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("staffOps.prizeDeskNoAchievers")}
          </Typography>
        ) : (
          <Stack spacing={0.75} sx={{ mt: 1.5 }}>
            {achievers.map((a) => (
              <Stack key={a.userId} direction="row" spacing={1.5} alignItems="center">
                <Avatar src={a.avatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
                  {a.name.slice(0, 1)}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {a.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    @{a.username} ・ {t("eventSocial.meetRankingCount", { n: a.count })}
                  </Typography>
                </Box>
                {a.redeemed ? (
                  <>
                    <Chip size="small" label={t("eventSocial.meetPrizeRedeemed")} />
                    <Button
                      size="small"
                      color="inherit"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t("staffOps.prizeDeskUnredeemConfirm"))) {
                          unredeem.mutate(
                            { prizeId: row.prize.id, userId: a.userId },
                            { onError: (e) => onError(redeemErrorMessage(e)) },
                          );
                        }
                      }}
                    >
                      {t("staffOps.prizeDeskUnredeem")}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busy || row.stockLeft === 0}
                    onClick={() =>
                      redeem.mutate(
                        { prizeId: row.prize.id, userId: a.userId },
                        { onError: (e) => onError(redeemErrorMessage(e)) },
                      )
                    }
                  >
                    {t("staffOps.prizeDeskRedeem")}
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * ビンゴ景品プール (#436)。達成順（同着は同順位）に並べ、達成者ごとに
 * 在庫が残っているプール景品を選んで交換済みにする。1人1つの保証はサーバー
 * （redeemFromBingoPool の1文）。同着の順番決めは現場で行い、押した順が記録に残る。
 */
function BingoPoolCard({
  eventId,
  status,
  onError,
}: {
  eventId: string;
  status: MeetPrizeStatus;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const redeem = useRedeemMeetPrize(eventId);
  const unredeem = useUnredeemMeetPrize(eventId);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const busy = redeem.isPending || unredeem.isPending;

  const poolPrizes = status.prizes.filter(
    (p) => p.prize.conditionType === "bingo",
  );
  if (poolPrizes.length === 0) return null;
  const available = poolPrizes.filter((p) => p.stockLeft > 0);
  const nameOf = (prizeId: string | null) =>
    poolPrizes.find((p) => p.prize.id === prizeId)?.prize.name ?? "";

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <CardGiftcardIcon fontSize="small" />
          {t("staffOps.prizeDeskBingoTitle")}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t("staffOps.prizeDeskBingoNote")}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          {poolPrizes.map((p) => (
            <Chip
              key={p.prize.id}
              size="small"
              variant="outlined"
              color={p.stockLeft === 0 ? "default" : "info"}
              label={`${p.prize.name} ${t("staffOps.prizeDeskStock", {
                left: p.stockLeft,
                total: p.prize.stock,
              })}`}
            />
          ))}
        </Stack>
        {status.bingoAchievers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("staffOps.prizeDeskBingoNone")}
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {status.bingoAchievers.map((a) => {
              const selected =
                choice[a.userId] ?? available[0]?.prize.id ?? "";
              return (
                <Stack key={a.userId} direction="row" spacing={1.5} alignItems="center">
                  <Chip
                    size="small"
                    color="success"
                    label={t("staffOps.bingoRankN", { rank: a.rank })}
                  />
                  <Avatar src={a.avatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
                    {a.name.slice(0, 1)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {a.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      @{a.username}
                    </Typography>
                  </Box>
                  {a.redeemedPrizeId ? (
                    <>
                      <Chip
                        size="small"
                        label={`${t("eventSocial.meetPrizeRedeemed")}: ${nameOf(a.redeemedPrizeId)}`}
                      />
                      <Button
                        size="small"
                        color="inherit"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(t("staffOps.prizeDeskUnredeemConfirm"))) {
                            unredeem.mutate(
                              { prizeId: a.redeemedPrizeId!, userId: a.userId },
                              { onError: (e) => onError(redeemErrorMessage(e)) },
                            );
                          }
                        }}
                      >
                        {t("staffOps.prizeDeskUnredeem")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <TextField
                        select
                        size="small"
                        value={selected}
                        onChange={(e) =>
                          setChoice((c) => ({ ...c, [a.userId]: e.target.value }))
                        }
                        sx={{ minWidth: 160 }}
                      >
                        {available.map((p) => (
                          <MenuItem key={p.prize.id} value={p.prize.id}>
                            {p.prize.name}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={busy || !selected}
                        onClick={() =>
                          redeem.mutate(
                            { prizeId: selected, userId: a.userId },
                            { onError: (e) => onError(redeemErrorMessage(e)) },
                          )
                        }
                      >
                        {t("staffOps.prizeDeskBingoChoose")}
                      </Button>
                    </>
                  )}
                </Stack>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/** 1位の確定（締め）カード。確定済みなら勝者を出し、締め直し・取り消しができる */
function WinnersCard({
  eventId,
  status,
  onError,
}: {
  eventId: string;
  status: { winners: { userId: string; name: string; username: string; avatarUrl: string | null; count: number }[] };
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const close = useCloseMeetWinners(eventId);
  const clear = useClearMeetWinners(eventId);
  const busy = close.isPending || clear.isPending;
  const decided = status.winners.length > 0;

  const doClose = () => {
    if (!window.confirm(t("staffOps.prizeDeskCloseConfirm"))) return;
    close.mutate(undefined, {
      onError: (e) =>
        onError(
          errorMessage(e, {
            no_meets: i18next.t("staffOps.prizeDeskNoMeets"),
          }),
        ),
    });
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <EmojiEventsIcon fontSize="small" sx={{ color: "#FFD54F" }} />
          {t("staffOps.prizeDeskWinnersTitle")}
        </Typography>
        {decided ? (
          <Stack spacing={0.75} sx={{ mb: 1.5 }}>
            {status.winners.map((w) => (
              <Stack key={w.userId} direction="row" spacing={1.5} alignItems="center">
                <Avatar src={w.avatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
                  {w.name.slice(0, 1)}
                </Avatar>
                <Typography variant="body2" fontWeight={600}>
                  {w.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("eventSocial.meetRankingCount", { n: w.count })}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("staffOps.prizeDeskWinnersUndecided")}
          </Typography>
        )}
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" disabled={busy} onClick={doClose}>
            {decided
              ? t("staffOps.prizeDeskRecloseWinners")
              : t("staffOps.prizeDeskCloseWinners")}
          </Button>
          {decided && (
            <Button
              size="small"
              color="inherit"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("staffOps.prizeDeskClearConfirm"))) {
                  clear.mutate(undefined, {
                    onError: (e) => onError(errorMessage(e)),
                  });
                }
              }}
            >
              {t("staffOps.prizeDeskClearWinners")}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function EventPrizeDeskPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  // イベント配下の表示はイベント内の役割だけで判定する（isAdmin は混ぜない）
  const isStaff = eventData?.myRole === "staff";
  const { data } = useMeetPrizeStatus(id, isStaff, true);
  const [filter, setFilter] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  if (eventData && !isStaff) {
    return <Alert severity="warning">{t("staffOps.prizeDeskStaffOnly")}</Alert>;
  }

  return (
    <Stack spacing={2}>
      {eventData && (
        <EventBreadcrumbs
          eventId={id}
          eventTitle={eventData.event.title}
          current={t("staffOps.prizeDeskTitle")}
        />
      )}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography
          variant="h5"
          fontWeight={700}
          sx={{ display: "flex", alignItems: "center", gap: 1 }}
        >
          <CardGiftcardIcon />
          {t("staffOps.prizeDeskTitle")}
        </Typography>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          component={RouterLink}
          to={`/events/${id}`}
        >
          {t("staffOps.backToEventLink")}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("staffOps.prizeDeskLead")}
      </Typography>
      {failure && (
        <Alert severity="error" onClose={() => setFailure(null)}>
          {failure}
        </Alert>
      )}
      {data && (
        <>
          {/* top_rank の景品が無くても締めはできる（ランキング企画だけの回もある） */}
          <WinnersCard eventId={id} status={data} onError={setFailure} />
          {/* ビンゴ景品プール (#436)。bingo 条件の景品はここに集約（下の一覧には出さない） */}
          <BingoPoolCard eventId={id} status={data} onError={setFailure} />
          {(() => {
            const regular = data.prizes.filter(
              (row) => row.prize.conditionType !== "bingo",
            );
            if (regular.length === 0) {
              // ビンゴ景品だけの回では、空の絞り込み欄と空一覧を出さない
              return data.prizes.length === 0 ? (
                <Alert severity="info">{t("staffOps.prizeDeskEmpty")}</Alert>
              ) : null;
            }
            return (
              <>
                <TextField
                  size="small"
                  label={t("staffOps.prizeDeskSearch")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  sx={{ maxWidth: 320 }}
                />
                {regular.map((row) => (
                  <PrizeCard
                    key={row.prize.id}
                    eventId={id}
                    row={row}
                    filter={filter}
                    onError={setFailure}
                  />
                ))}
              </>
            );
          })()}
        </>
      )}
    </Stack>
  );
}
