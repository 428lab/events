import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useTranslation } from "react-i18next";
import type { MeetPrizeMe, MeetPrizeView } from "@eventer/shared";
import { useMeetPrizes } from "../api/meetPrizeHooks.js";

/**
 * 出会いの景品 (#431) のイベントページ用カード。
 *
 * 景品一覧は誰でも見える（何がもらえるかが参加の動機）。確定メンバーには
 * 自分の進捗・達成・交換済みが付く。達成していて未交換のものがあれば
 * 「この画面をスタッフに見せて」の案内を出す＝これが引換券を兼ねる。
 * オフのイベントにはサーバーが 404 を返すので、描画の出し分けは利便であって
 * 防御ではない（門は docs/meet-prizes.md §3.9）。
 */

/** 本人がこの景品を達成しているか（表示用の導出。判定の正は引き換え時のサーバー）。
 * bingo はプール全体で1人1つなので、どれかを受け取ったら他の bingo 景品を
 * 「達成！」のままにしない（poolTaken） */
function achieved(
  prize: MeetPrizeView,
  me: MeetPrizeMe,
  poolTaken: boolean,
): boolean {
  if (prize.conditionType === "meet_count") {
    return me.count >= (prize.threshold ?? Infinity);
  }
  if (prize.conditionType === "top_rank") return me.won;
  return me.bingo && !poolTaken;
}

function PrizeRow({
  prize,
  me,
  winnersDecided,
  poolTaken,
}: {
  prize: MeetPrizeView;
  me: MeetPrizeMe | null;
  winnersDecided: boolean;
  poolTaken: boolean;
}) {
  const { t } = useTranslation();
  const done = me ? achieved(prize, me, poolTaken) : false;
  const redeemed = me ? me.redeemedPrizeIds.includes(prize.id) : false;
  const soldOut = prize.stockLeft === 0;
  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: 1,
        border: 1,
        borderColor: done && !redeemed ? "success.main" : "divider",
        opacity: soldOut && !redeemed ? 0.6 : 1,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {prize.imageUrl && (
          <Box
            component="img"
            src={prize.imageUrl}
            alt={prize.name}
            sx={{ width: 56, height: 56, objectFit: "cover", borderRadius: 1 }}
          />
        )}
        {prize.conditionType === "top_rank" && (
          <EmojiEventsIcon fontSize="small" sx={{ color: "#FFD54F" }} />
        )}
        <Typography variant="body1" fontWeight={600}>
          {prize.name}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={
            prize.conditionType === "meet_count"
              ? t("eventSocial.meetPrizeCondCount", { n: prize.threshold ?? 0 })
              : prize.conditionType === "top_rank"
                ? t("eventSocial.meetPrizeCondTop")
                : t("eventSocial.meetPrizeCondBingo")
          }
        />
        <Chip
          size="small"
          color={soldOut ? "default" : "info"}
          variant={soldOut ? "filled" : "outlined"}
          label={
            soldOut
              ? t("eventSocial.meetPrizeOutOfStock")
              : t("eventSocial.meetPrizeStockLeft", { n: prize.stockLeft })
          }
        />
        {redeemed ? (
          <Chip size="small" color="default" label={t("eventSocial.meetPrizeRedeemed")} />
        ) : (
          done && (
            <Chip size="small" color="success" label={t("eventSocial.meetPrizeAchieved")} />
          )
        )}
      </Stack>
      {prize.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {prize.description}
        </Typography>
      )}
      {prize.conditionType === "top_rank" && !winnersDecided && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          {t("eventSocial.meetPrizeTopUndecided")}
        </Typography>
      )}
    </Box>
  );
}

/** イベント詳細ページの景品カード。event.meetPrizes がオンのときだけ描画される */
export function MeetPrizePanel({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const { data } = useMeetPrizes(eventId, Boolean(eventId));
  if (!data || data.prizes.length === 0) return null;

  const me = data.me;
  // ビンゴ景品プール (#436)。1人1つの選び取りなので、まとまりで見せる
  const poolPrizes = data.prizes.filter((p) => p.conditionType === "bingo");
  const regularPrizes = data.prizes.filter((p) => p.conditionType !== "bingo");
  const poolTaken =
    me !== null && poolPrizes.some((p) => me.redeemedPrizeIds.includes(p.id));
  const hasUnredeemed =
    me !== null &&
    data.prizes.some(
      (p) => achieved(p, me, poolTaken) && !me.redeemedPrizeIds.includes(p.id),
    );

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <CardGiftcardIcon fontSize="small" />
          {t("eventSocial.meetPrizesHeading")}
        </Typography>
        {me && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("eventSocial.meetPrizeMyCount", { n: me.count })}
            {me.won && ` ${t("eventSocial.meetPrizeYouWon")}`}
          </Typography>
        )}
        {hasUnredeemed && (
          <Alert severity="success" sx={{ mb: 1.5 }}>
            {t("eventSocial.meetPrizeShowStaff")}
          </Alert>
        )}
        <Stack spacing={1}>
          {regularPrizes.map((p) => (
            <PrizeRow
              key={p.id}
              prize={p}
              me={me}
              winnersDecided={data.winnersDecided}
              poolTaken={poolTaken}
            />
          ))}
        </Stack>
        {poolPrizes.length > 0 && (
          <Box sx={{ mt: regularPrizes.length > 0 ? 1.5 : 0 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
              {t("eventSocial.meetPrizePoolHeading")}
            </Typography>
            <Stack spacing={1}>
              {poolPrizes.map((p) => (
                <PrizeRow
                  key={p.id}
                  prize={p}
                  me={me}
                  winnersDecided={data.winnersDecided}
                  poolTaken={poolTaken}
                />
              ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
