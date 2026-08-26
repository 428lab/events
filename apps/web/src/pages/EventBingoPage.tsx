import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";
import { useBingoState, useIssueBingoCard } from "../api/bingoHooks.js";
import { BingoCard } from "../components/BingoCard.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";

/**
 * 参加者のビンゴカード画面 (#436)。5秒ポーリングで自動マーク。
 * ゲームが無い・非メンバーはサーバーが 404 を返すので案内だけ出す
 * （出し分けは利便で、防御はサーバーの門）。
 */
export function EventBingoPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const state = useBingoState(id, Boolean(eventData));
  const issue = useIssueBingoCard(id);

  const data = state.data;
  const latest =
    data && data.drawnNumbers.length > 0
      ? data.drawnNumbers[data.drawnNumbers.length - 1]
      : null;

  return (
    <Stack spacing={2}>
      {eventData && (
        <EventBreadcrumbs
          eventId={id}
          eventTitle={eventData.event.title}
          current={t("eventSocial.bingoTitle")}
        />
      )}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography
          variant="h5"
          fontWeight={700}
          sx={{ display: "flex", alignItems: "center", gap: 1 }}
        >
          <CasinoOutlinedIcon />
          {t("eventSocial.bingoTitle")}
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

      {state.isError && (
        <Alert severity="info">{t("eventSocial.screenMembersOnly")}</Alert>
      )}

      {data && data.status !== "none" && (
        <>
          {/* 自分の状態バナー。ビンゴ時は順位と「選びに来て」の案内（引換券を兼ねる） */}
          {data.me?.bingo ? (
            <Alert severity="success">
              <Typography fontWeight={800} component="span">
                {t("eventSocial.bingoBingo")}
              </Typography>{" "}
              {data.me.rank !== null &&
                t("eventSocial.bingoYourRank", { rank: data.me.rank })}{" "}
              {t("eventSocial.bingoShowStaff")}
            </Alert>
          ) : data.me?.reach ? (
            <Alert severity="warning">{t("eventSocial.bingoReach")}</Alert>
          ) : null}
          {data.status === "setup" && (
            <Alert severity="info">{t("eventSocial.bingoWaiting")}</Alert>
          )}
          {data.status === "ended" && (
            <Alert severity="info">{t("eventSocial.bingoEnded")}</Alert>
          )}

          {/* 直近の番号と出た番号 */}
          {data.status !== "setup" && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("eventSocial.bingoLatest")}
              </Typography>
              <Typography variant="h3" fontWeight={800}>
                {latest ?? "—"}
              </Typography>
              {data.drawnNumbers.length > 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t("eventSocial.bingoHistory")}:{" "}
                  {data.drawnNumbers.join(" → ")}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("eventSocial.bingoNoDraws")}
                </Typography>
              )}
            </Box>
          )}

          {/* カード。無ければ受け取るボタン（ended 中は出さない） */}
          {data.card ? (
            <Box>
              <BingoCard numbers={data.card} drawn={data.drawnNumbers} />
            </Box>
          ) : (
            data.status !== "ended" && (
              <Box>
                <Button
                  variant="contained"
                  disabled={issue.isPending}
                  onClick={() => issue.mutate()}
                >
                  {t("eventSocial.bingoGetCard")}
                </Button>
              </Box>
            )
          )}

          <Chip
            sx={{ alignSelf: "flex-start" }}
            size="small"
            variant="outlined"
            label={t("eventSocial.bingoCounts", {
              cards: data.counts.cards,
              bingo: data.counts.bingo,
              reach: data.counts.reach,
            })}
          />
        </>
      )}
    </Stack>
  );
}
