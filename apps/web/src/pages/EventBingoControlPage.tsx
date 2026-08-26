import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent } from "../api/hooks.js";
import {
  useBingoStatus,
  useCreateBingo,
  useDeleteBingo,
  useDrawBingo,
  useEndBingo,
  useResetBingo,
  useStartBingo,
  useUndoBingoDraw,
} from "../api/bingoHooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { errorMessage } from "../lib/errorMessage.js";
import { i18next } from "../i18n/index.js";

/**
 * ビンゴの抽選コントロール (#436)。スタッフ専用（司会の手元）。
 * ライフサイクル操作・「次を引く」・読み上げ用のリーチ/ビンゴ一覧（名前入り）。
 * 判定はすべてサーバー導出で、この画面は表示と操作だけ。
 * 見えるのは `myRole === "staff"` の人だけ（isAdmin は混ぜない）。
 */
export function EventBingoControlPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isStaff = eventData?.myRole === "staff";
  const status = useBingoStatus(id, isStaff);
  const [failure, setFailure] = useState<string | null>(null);

  const create = useCreateBingo(id);
  const start = useStartBingo(id);
  const draw = useDrawBingo(id);
  const undoDraw = useUndoBingoDraw(id);
  const end = useEndBingo(id);
  const reset = useResetBingo(id);
  const removeGame = useDeleteBingo(id);
  const busy =
    create.isPending ||
    start.isPending ||
    draw.isPending ||
    undoDraw.isPending ||
    end.isPending ||
    reset.isPending ||
    removeGame.isPending;

  const onError = (e: unknown) =>
    setFailure(
      errorMessage(e, {
        exhausted: i18next.t("staffOps.bingoExhausted"),
        default: i18next.t("staffOps.bingoOpFailed"),
      }),
    );
  /** 確認つきの操作。confirmKey が null なら確認なしで実行 */
  const run = (
    mutation: { mutate: (v: undefined, o: { onError: (e: unknown) => void }) => void },
    confirmKey: string | null,
  ) => {
    if (confirmKey && !window.confirm(t(confirmKey as never))) return;
    setFailure(null);
    mutation.mutate(undefined, { onError });
  };

  if (eventData && !isStaff) {
    return <Alert severity="warning">{t("staffOps.bingoControlStaffOnly")}</Alert>;
  }
  const data = status.data;
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
          current={t("staffOps.bingoControlTitle")}
        />
      )}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography
          variant="h5"
          fontWeight={700}
          sx={{ display: "flex", alignItems: "center", gap: 1 }}
        >
          <CasinoOutlinedIcon />
          {t("staffOps.bingoControlTitle")}
        </Typography>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          component={RouterLink}
          to={`/events/${id}`}
        >
          {t("staffOps.backToEventLink")}
        </Button>
        <Button size="small" component={RouterLink} to={`/events/${id}/bingo/screen`}>
          {t("eventSocial.meetRankingOpenScreen")}
        </Button>
      </Stack>
      {failure && (
        <Alert severity="error" onClose={() => setFailure(null)}>
          {failure}
        </Alert>
      )}

      {data && (
        <>
          {data.status === "none" ? (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {t("staffOps.bingoCreateNote")}
                </Typography>
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => run(create, null)}
                >
                  {t("staffOps.bingoCreate")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* 直近の番号（司会が読む） */}
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center" }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("eventSocial.bingoLatest")}
                  </Typography>
                  <Typography sx={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>
                    {latest ?? "—"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {data.drawnNumbers.length > 0
                      ? `${t("eventSocial.bingoHistory")}: ${data.drawnNumbers.join(" → ")}`
                      : t("eventSocial.bingoNoDraws")}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    justifyContent="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    {data.status === "setup" && (
                      <Button
                        variant="contained"
                        disabled={busy}
                        onClick={() => run(start, "staffOps.bingoStartConfirm")}
                      >
                        {t("staffOps.bingoStart")}
                      </Button>
                    )}
                    {data.status === "running" && (
                      <>
                        <Button
                          variant="contained"
                          size="large"
                          disabled={busy}
                          onClick={() => run(draw, null)}
                        >
                          {t("staffOps.bingoDraw")}
                        </Button>
                        <Button
                          color="inherit"
                          disabled={busy || data.drawnNumbers.length === 0}
                          onClick={() => run(undoDraw, "staffOps.bingoUndoConfirm")}
                        >
                          {t("staffOps.bingoUndoDraw")}
                        </Button>
                        <Button
                          color="inherit"
                          disabled={busy}
                          onClick={() => run(end, "staffOps.bingoEndConfirm")}
                        >
                          {t("staffOps.bingoEnd")}
                        </Button>
                      </>
                    )}
                    {data.status === "ended" && (
                      <Button
                        color="inherit"
                        disabled={busy}
                        onClick={() => run(reset, "staffOps.bingoResetConfirm")}
                      >
                        {t("staffOps.bingoReset")}
                      </Button>
                    )}
                    <Button
                      color="error"
                      disabled={busy}
                      onClick={() => run(removeGame, "staffOps.bingoDeleteConfirm")}
                    >
                      {t("staffOps.bingoDelete")}
                    </Button>
                  </Stack>
                  {data.status === "running" && data.drawnNumbers.length > 0 && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1, display: "block" }}
                    >
                      {t("staffOps.bingoUndoHelp")}
                    </Typography>
                  )}
                  <Box sx={{ mt: 1.5 }}>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t("eventSocial.bingoCounts", {
                        cards: data.counts.cards,
                        bingo: data.counts.bingo,
                        reach: data.counts.reach,
                      })}
                    />
                  </Box>
                </CardContent>
              </Card>

              {/* 読み上げ用のリーチ/ビンゴ一覧（staff だけが名前を見る） */}
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    {t("staffOps.bingoAchieversTitle")}
                  </Typography>
                  {data.rows.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t("staffOps.bingoNoRows")}
                    </Typography>
                  ) : (
                    <Stack spacing={0.75}>
                      {data.rows
                        .filter((r) => r.bingo || r.reach)
                        .map((r) => (
                          <Stack
                            key={r.userId}
                            direction="row"
                            spacing={1.5}
                            alignItems="center"
                          >
                            <Avatar
                              src={r.avatarUrl ?? undefined}
                              sx={{ width: 28, height: 28 }}
                            >
                              {r.name.slice(0, 1)}
                            </Avatar>
                            <Typography variant="body2" fontWeight={600} noWrap>
                              {r.name}
                            </Typography>
                            {r.bingo ? (
                              <Chip
                                size="small"
                                color="success"
                                label={t("staffOps.bingoRankN", { rank: r.rank ?? 0 })}
                              />
                            ) : (
                              <Chip
                                size="small"
                                color="warning"
                                variant="outlined"
                                label={t("eventSocial.bingoReach")}
                              />
                            )}
                          </Stack>
                        ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
