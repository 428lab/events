import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { completedBingoCells } from "@eventer/shared";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";
import { useBingoState, useIssueBingoCard } from "../api/bingoHooks.js";
import { BingoCard } from "../components/BingoCard.js";
import { BingoWithChat } from "../components/BingoWithChat.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { useBingoCardEffects } from "../lib/useBingoCardEffects.js";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion.js";

/**
 * 参加者のビンゴカード画面 (#436)。抽選の合図（topic `bingo`）で取り直して自動マーク。
 * 非メンバーはサーバーが 404 を返すので案内だけ出す。ゲーム作成前（"none"）は何も出さず、
 * 作成の合図で切り替わる（出し分けは利便で、防御はサーバーの門）。
 * リーチ・ビンゴになった瞬間の演出は useBingoCardEffects（#681 PR2）。
 */
export function EventBingoPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const state = useBingoState(id, Boolean(eventData), true);
  const issue = useIssueBingoCard(id);

  const data = state.data;
  const reduced = usePrefersReducedMotion();
  const fx = useBingoCardEffects(data, reduced);
  const latest =
    data && data.drawnNumbers.length > 0
      ? data.drawnNumbers[data.drawnNumbers.length - 1]
      : null;

  return (
    <BingoWithChat eventId={id}>
    <>
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

          {/* 直近の番号と出た番号。参加者はほぼスマホなので中央寄せ */}
          {data.status !== "setup" && (
            <Box sx={{ textAlign: "center" }}>
              <Typography variant="caption" color="text.secondary">
                {t("eventSocial.bingoLatest")}
              </Typography>
              <Typography variant="h3" fontWeight={800}>
                {latest ?? "—"}
              </Typography>
              {data.drawnNumbers.length > 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxHeight: "var(--bingo-history-height, none)", overflowY: "auto" }}>
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

          {/* カード。無ければ受け取るボタン（ended 中は出さない）。
              スマホで左に寄っていた実機フィードバックを受けて横位置は常に中央 */}
          {data.card ? (
            <Box sx={{ display: "flex", justifyContent: "center" }}>
              <BingoCard
                numbers={data.card}
                drawn={data.drawnNumbers}
                highlightCells={data.me?.bingo ? completedBingoCells(data.card, data.drawnNumbers) : undefined}
                pulseNumbers={fx.pulseNumbers}
              />
            </Box>
          ) : (
            data.status !== "ended" && (
              <Box sx={{ display: "flex", justifyContent: "center" }}>
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
            sx={{ alignSelf: "center" }}
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
    {/* 演出の層は Stack の外に置く（Stack の spacing の余白で、固定の層が上端からずれないように） */}
      {/* リーチの瞬間: 画面全体を一度光らせる（自動で消える。操作は邪魔しない） */}
      {fx.reachFlash !== null && (
        <Box
          key={fx.reachFlash}
          role="status"
          sx={(theme) => ({
            position: "fixed",
            inset: 0,
            zIndex: theme.zIndex.modal,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "warning.main",
            animation: "bingoReachFlash 1500ms ease-out forwards",
            "@keyframes bingoReachFlash": {
              "0%": { opacity: 0 },
              "15%": { opacity: 0.92 },
              "70%": { opacity: 0.92 },
              "100%": { opacity: 0 },
            },
          })}
        >
          <Typography sx={{ fontSize: 64, fontWeight: 900, color: "warning.contrastText" }}>
            {t("eventSocial.bingoReach")}
          </Typography>
        </Box>
      )}

      {/* ビンゴの瞬間: 全画面の層。手で閉じるまで残す（司会・スタッフに見せる）。
          固定のチャット枠より上に出す */}
      {fx.bingoOpen && data?.me?.bingo && (
        <Box
          role="dialog"
          aria-modal="true"
          aria-labelledby="bingo-win-title"
          sx={(theme) => ({
            position: "fixed",
            inset: 0,
            zIndex: theme.zIndex.modal,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            p: 3,
            textAlign: "center",
            bgcolor: "success.main",
            color: "success.contrastText",
            ...(reduced ? {} : {
              animation: "bingoWinIn 400ms ease-out",
              "@keyframes bingoWinIn": {
                "0%": { opacity: 0, transform: "scale(1.15)" },
                "100%": { opacity: 1, transform: "scale(1)" },
              },
            }),
          })}
        >
          <Typography id="bingo-win-title" component="h2" sx={{ fontSize: 72, fontWeight: 900, lineHeight: 1.1 }}>
            {t("eventSocial.bingoBingo")}
          </Typography>
          {data.me.rank !== null && (
            <Typography sx={{ fontSize: 24, fontWeight: 700 }}>
              {t("eventSocial.bingoYourRank", { rank: data.me.rank })}
            </Typography>
          )}
          <Typography>{t("eventSocial.bingoShowStaff")}</Typography>
          <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 320, mt: 1 }}>
            <Button
              autoFocus
              variant="contained"
              size="large"
              color="inherit"
              component={RouterLink}
              to={`/events/${id}#prizes`}
              sx={{ color: "success.dark", bgcolor: "common.white", minHeight: 48 }}
            >
              {t("eventSocial.bingoGoToPrizes")}
            </Button>
            <Button variant="outlined" color="inherit" size="large" onClick={fx.closeBingo}>
              {t("eventSocial.bingoBackToCard")}
            </Button>
          </Stack>
        </Box>
      )}
    </>
    </BingoWithChat>
  );
}
