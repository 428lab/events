import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BROADCAST_BODY_MAX,
  BROADCAST_EMAILS_PER_HOUR,
  BROADCAST_SEGMENTS,
  BROADCAST_SEGMENT_LABELS,
  BROADCAST_SEGMENT_NOTES,
  BROADCAST_TITLE_MAX,
  broadcastEmailMinutes,
  type BroadcastSegment,
  type EventBroadcast,
} from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import {
  useEventBroadcasts,
  useRetryBroadcastEmails,
  useSendBroadcast,
} from "../api/broadcastHooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { i18next, tDynamic } from "../i18n/index.js";
import { errorMessage } from "../lib/errorMessage.js";
import { formatDateTime } from "../lib/format.js";

/** 送信先の区分の名前と補足。もとの定数は日本語なので、訳が入るまでの受け皿に使う */
function segmentLabel(segment: string): string {
  return tDynamic(
    `broadcastSegment.${segment}`,
    BROADCAST_SEGMENT_LABELS[segment as BroadcastSegment] ?? segment,
  );
}
function segmentNote(segment: BroadcastSegment): string {
  return tDynamic(
    `broadcastSegmentNote.${segment}`,
    BROADCAST_SEGMENT_NOTES[segment],
  );
}

/** メールを送りきるまでのおおよその時間。所要時間の計算だけを shared から借り、
 * 表記は辞書から組み立てる（`formatBroadcastEmailEta` は日本語しか返せない） */
function emailEta(count: number): string {
  const minutes = broadcastEmailMinutes(count);
  if (minutes <= 0) return "";
  if (minutes < 60) return i18next.t("staffOps.etaMinutes", { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0
    ? i18next.t("staffOps.etaHours", { n: h })
    : i18next.t("staffOps.etaHoursMinutes", { h, m });
}

/** 送信できなかったときの文言。上限に達した場合は時間をおいても直らないので分ける */
function sendErrorMessage(error: unknown): string {
  return errorMessage(error, {
    broadcast_limit_total: i18next.t("staffOps.broadcastLimitTotalError"),
    broadcast_limit_day: i18next.t("staffOps.broadcastLimitDayNotice"),
    default: i18next.t("staffOps.broadcastSendFailed"),
  });
}

/** 送信結果の1行。0 件の項目は出さない（読みづらくなるだけなので） */
function EmailStatus({ b }: { b: EventBroadcast }) {
  const { t } = useTranslation();
  const { pending, sent, failed, skipped } = b.email;
  const total = pending + sent + failed + skipped;
  if (total === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("staffOps.broadcastEmailNone")}
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {pending > 0 && (
        <Chip
          size="small"
          color="info"
          label={t("staffOps.broadcastEmailPending", { n: pending })}
        />
      )}
      {sent > 0 && (
        <Chip
          size="small"
          color="success"
          label={t("staffOps.broadcastEmailSent", { n: sent })}
        />
      )}
      {failed > 0 && (
        <Chip
          size="small"
          color="error"
          label={t("staffOps.broadcastEmailFailed", { n: failed })}
        />
      )}
      {skipped > 0 && (
        <Chip
          size="small"
          label={t("staffOps.broadcastEmailSkipped", { n: skipped })}
        />
      )}
    </Stack>
  );
}

export function EventBroadcastPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  // イベント配下の表示はイベント内の役割だけで判定する（サイト管理者かどうかは混ぜない）
  const isStaff = eventData?.myRole === "staff";
  const { data, error, refetch } = useEventBroadcasts(id, isStaff);
  const send = useSendBroadcast(id);
  const retry = useRetryBroadcastEmails(id);

  const [segment, setSegment] = useState<BroadcastSegment>("confirmed");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // 確認ダイアログを開くときに取り直した人数。開いている間はこの数字で固定する
  // （開いてから送るまでの間に増減しても、確認した数字と送信ボタンの数字がずれない）
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [sentInfo, setSentInfo] = useState<string | null>(null);
  const [partialInfo, setPartialInfo] = useState<string | null>(null);

  if (!eventData) return <Typography>{t("common.loading")}</Typography>;
  if (!isStaff) {
    return <Alert severity="info">{t("staffOps.broadcastStaffOnly")}</Alert>;
  }
  if (!data) {
    return (
      <Typography>
        {t(error ? "staffOps.loadFailed" : "common.loading")}
      </Typography>
    );
  }

  const count = data.counts[segment] ?? 0;
  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    data.remainingToday > 0 &&
    data.remainingTotal > 0;

  /** 確認の直前に人数を取り直す。「45人に送る」と確認したのに65人に届く、を防ぐ */
  const openConfirm = async () => {
    setChecking(true);
    try {
      const fresh = await refetch();
      setConfirmCount(fresh.data?.counts[segment] ?? count);
    } catch {
      // 取り直せなかったら手元の数字で確認する（送信時にサーバー側で数え直される）
      setConfirmCount(count);
    } finally {
      setChecking(false);
    }
  };

  const doSend = () => {
    setSentInfo(null);
    setPartialInfo(null);
    send.mutate(
      { segment, title, body },
      {
        onSuccess: (r) => {
          setConfirmCount(null);
          setTitle("");
          setBody("");
          const base =
            t(
              r.recipientCount === 1
                ? "staffOps.broadcastSentOne"
                : "staffOps.broadcastSent",
              { n: r.recipientCount },
            ) +
            (r.emailQueued > 0
              ? t(
                  r.emailQueued === 1
                    ? "staffOps.broadcastSentEmailOne"
                    : "staffOps.broadcastSentEmail",
                  { n: r.emailQueued, eta: emailEta(r.emailQueued) },
                )
              : t("staffOps.broadcastSentNoEmail"));
          if (r.incomplete) {
            // 途中で失敗している。同じ内容をもう一度送ると、届いた人には2通になる
            setPartialInfo(
              t("staffOps.broadcastPartial", { n: r.recipientCount }),
            );
          } else {
            setSentInfo(
              base +
                (r.truncatedFrom !== null
                  ? t("staffOps.broadcastTruncated", {
                      total: r.truncatedFrom,
                      n: r.recipientCount,
                    })
                  : ""),
            );
          }
        },
      },
    );
  };

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("eventDetail.broadcast")}
      />
      <Box>
        <Typography variant="h5" fontWeight={700}>
          {t("eventDetail.broadcast")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("staffOps.broadcastIntro", {
            perHour: BROADCAST_EMAILS_PER_HOUR,
            eta100: emailEta(100),
            eta300: emailEta(300),
          })}
        </Typography>
      </Box>

      {sentInfo && (
        <Alert severity="success" onClose={() => setSentInfo(null)}>
          {sentInfo}
        </Alert>
      )}
      {partialInfo && (
        <Alert severity="warning" onClose={() => setPartialInfo(null)}>
          {partialInfo}
        </Alert>
      )}
      {send.isError && (
        <Alert severity="error">{sendErrorMessage(send.error)}</Alert>
      )}
      {retry.isError && (
        <Alert severity="error">{t("staffOps.broadcastRetryFailed")}</Alert>
      )}

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <TextField
              select
              label={t("staffOps.broadcastSegmentField")}
              value={segment}
              onChange={(e) => setSegment(e.target.value as BroadcastSegment)}
              helperText={segmentNote(segment)}
            >
              {BROADCAST_SEGMENTS.map((s) => (
                <MenuItem key={s} value={s}>
                  {t("staffOps.broadcastSegmentOption", {
                    label: segmentLabel(s),
                    n: data.counts[s] ?? 0,
                  })}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="body2" color="text.secondary">
              {t("staffOps.segmentOverlapNote")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("staffOps.broadcastCountNote")}
            </Typography>

            <CounterTextField
              label={t("common.subject")}
              max={BROADCAST_TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              helperText={t("staffOps.broadcastTitleHelp")}
            />
            <CounterTextField
              label={t("staffOps.broadcastBodyField")}
              max={BROADCAST_BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              multiline
              minRows={5}
              helperText={t("staffOps.broadcastBodyHelp")}
            />

            <Alert severity="warning">
              {t("staffOps.broadcastNoUndoWarning")}
            </Alert>

            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Button
                variant="contained"
                disabled={!canSend || checking || send.isPending}
                onClick={openConfirm}
              >
                {t("staffOps.broadcastConfirmOpen")}
              </Button>
              <Typography variant="body2" color="text.secondary">
                {t("staffOps.broadcastRemaining", {
                  today: data.remainingToday,
                  total: data.remainingTotal,
                })}
              </Typography>
            </Stack>
            {data.remainingTotal <= 0 ? (
              <Alert severity="info">
                {t("staffOps.broadcastLimitTotalNotice")}
              </Alert>
            ) : (
              data.remainingToday <= 0 && (
                <Alert severity="info">
                  {t("staffOps.broadcastLimitDayNotice")}
                </Alert>
              )
            )}
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("staffOps.broadcastHistoryTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("staffOps.broadcastHistoryNote")}
        </Typography>
        {data.broadcasts.length === 0 ? (
          <Typography color="text.secondary">
            {t("staffOps.broadcastHistoryEmpty")}
          </Typography>
        ) : (
          <Stack spacing={2}>
            {data.broadcasts.map((b) => (
              <Card key={b.id} variant="outlined">
                <CardContent>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                    sx={{ mb: 1 }}
                  >
                    <Chip
                      size="small"
                      color="primary"
                      label={segmentLabel(b.segment)}
                    />
                    {b.incomplete && (
                      <Chip
                        size="small"
                        color="warning"
                        label={t("staffOps.broadcastIncompleteChip")}
                      />
                    )}
                    <Typography variant="body2" color="text.secondary">
                      {[
                        formatDateTime(b.createdAt),
                        t(
                          b.recipientCount === 1
                            ? "staffOps.broadcastSentToOne"
                            : "staffOps.broadcastSentTo",
                          { n: b.recipientCount },
                        ),
                        ...(b.senderName ? [b.senderName] : []),
                      ].join(t("common.dotSeparator"))}
                    </Typography>
                  </Stack>
                  <Typography fontWeight={700}>{b.title}</Typography>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-wrap", mb: 1 }}
                  >
                    {b.body}
                  </Typography>
                  {b.incomplete && (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      {t("staffOps.broadcastIncompleteNotice")}
                    </Alert>
                  )}
                  <Divider sx={{ mb: 1 }} />
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <EmailStatus b={b} />
                    {b.email.failed > 0 && (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(b.id)}
                      >
                        {t(
                          b.email.failed === 1
                            ? "staffOps.broadcastRetryOne"
                            : "staffOps.broadcastRetry",
                          { n: b.email.failed },
                        )}
                      </Button>
                    )}
                  </Stack>
                  {b.email.failed > 0 && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      {t("staffOps.broadcastRetryNote")}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      <Dialog
        open={confirmCount !== null}
        onClose={() => setConfirmCount(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{t("staffOps.broadcastConfirmTitle")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">
              {t("staffOps.broadcastConfirmWarning")}
            </Alert>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {t("staffOps.broadcastSegmentField")}
              </Typography>
              <Typography fontWeight={700}>
                {[
                  segmentLabel(segment),
                  t(
                    (confirmCount ?? 0) === 1
                      ? "staffOps.personCount"
                      : "staffOps.peopleCount",
                    { n: confirmCount ?? 0 },
                  ),
                ].join(t("common.dotSeparator"))}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {segmentNote(segment)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {t("common.subject")}
              </Typography>
              <Typography fontWeight={700}>{title}</Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {t("staffOps.broadcastBodyField")}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {body}
              </Typography>
            </Box>
            {confirmCount === 0 && (
              <Alert severity="info">
                {t("staffOps.broadcastConfirmEmpty")}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCount(null)}>
            {t("staffOps.broadcastConfirmCancel")}
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={send.isPending}
            onClick={doSend}
          >
            {t(
              (confirmCount ?? 0) === 1
                ? "staffOps.broadcastSendOne"
                : "staffOps.broadcastSend",
              { n: confirmCount ?? 0 },
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
