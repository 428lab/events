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
import {
  BROADCAST_BODY_MAX,
  BROADCAST_EMAILS_PER_HOUR,
  BROADCAST_OVERLAP_NOTE,
  BROADCAST_SEGMENTS,
  BROADCAST_SEGMENT_LABELS,
  BROADCAST_SEGMENT_NOTES,
  BROADCAST_TITLE_MAX,
  formatBroadcastEmailEta,
  type BroadcastSegment,
  type EventBroadcast,
} from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import {
  useEventBroadcasts,
  useRetryBroadcastEmails,
  useSendBroadcast,
} from "../api/broadcastHooks.js";
import { ApiError } from "../api/client.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { formatDateTime } from "../lib/format.js";

/** 送信できなかったときの文言。上限に達した場合は時間をおいても直らないので分ける */
function sendErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    const code = (error.body as { error?: string } | null)?.error;
    if (code === "broadcast_limit_total") {
      return "このイベントで送れる回数を使い切りました。時間をおいても増えません。どうしても必要な場合は運営にお問い合わせください。";
    }
    if (code === "broadcast_limit_day") {
      return "24時間あたりの送信回数の上限に達しました。いちばん古い送信から24時間が過ぎると、また送れるようになります。";
    }
  }
  return "送信できませんでした。時間をおいて試してください。";
}

/** 送信結果の1行。0 件の項目は出さない（読みづらくなるだけなので） */
function EmailStatus({ b }: { b: EventBroadcast }) {
  const { pending, sent, failed, skipped } = b.email;
  const total = pending + sent + failed + skipped;
  if (total === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        メールの宛先はありません（アプリ内のお知らせのみ）
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {pending > 0 && (
        <Chip size="small" color="info" label={`送信待ち ${pending}`} />
      )}
      {sent > 0 && (
        <Chip size="small" color="success" label={`送信済み ${sent}`} />
      )}
      {failed > 0 && (
        <Chip size="small" color="error" label={`失敗 ${failed}`} />
      )}
      {skipped > 0 && <Chip size="small" label={`対象外 ${skipped}`} />}
    </Stack>
  );
}

export function EventBroadcastPage() {
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

  if (!eventData) return <Typography>読み込み中…</Typography>;
  if (!isStaff) {
    return <Alert severity="info">一斉連絡はスタッフ専用です。</Alert>;
  }
  if (!data) {
    return (
      <Typography>{error ? "読み込めませんでした。" : "読み込み中…"}</Typography>
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
          const eta = formatBroadcastEmailEta(r.emailQueued);
          const base =
            `${r.recipientCount} 人にお知らせを送りました。` +
            (r.emailQueued > 0
              ? `そのうちメールを受け取る設定の ${r.emailQueued} 人には、順にメールも届きます（送りきるまで${eta}ほどかかります）。`
              : "メールの宛先はありませんでした。");
          if (r.incomplete) {
            // 途中で失敗している。同じ内容をもう一度送ると、届いた人には2通になる
            setPartialInfo(
              `途中で失敗したため、${r.recipientCount} 人までにしかお知らせが届いていません。` +
                "同じ内容をもう一度送ると、すでに届いている人には2通届きます。" +
                "下の送信履歴で届いた人数を確かめてから、必要な場合だけ送り直してください。",
            );
          } else {
            setSentInfo(
              base +
                (r.truncatedFrom !== null
                  ? `なお、区分に当てはまる ${r.truncatedFrom} 人のうち ${r.recipientCount} 人までで打ち切りました。残りの人には届いていません。`
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
        current="一斉連絡"
      />
      <Box>
        <Typography variant="h5" fontWeight={700}>
          一斉連絡
        </Typography>
        <Typography variant="body2" color="text.secondary">
          送信先の区分を選んでお知らせを送ります。アプリ内のお知らせはすぐに届きます。
          メールは順番に送るため、送りきるまで
          1時間あたり{BROADCAST_EMAILS_PER_HOUR}通ほどのペースになります
          （100人なら{formatBroadcastEmailEta(100)}、300人なら
          {formatBroadcastEmailEta(300)}）。
          他のイベントの一斉連絡と同時に送信待ちがあるときは、順番を分け合うため
          さらに時間がかかることがあります。急ぎの連絡はアプリ内のお知らせが先に届きます。
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
        <Alert severity="error">
          送り直せませんでした。時間をおいて試してください。
        </Alert>
      )}

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <TextField
              select
              label="送信先"
              value={segment}
              onChange={(e) => setSegment(e.target.value as BroadcastSegment)}
              helperText={BROADCAST_SEGMENT_NOTES[segment]}
            >
              {BROADCAST_SEGMENTS.map((s) => (
                <MenuItem key={s} value={s}>
                  {BROADCAST_SEGMENT_LABELS[s]}（{data.counts[s] ?? 0} 人）
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="body2" color="text.secondary">
              {BROADCAST_OVERLAP_NOTE}
            </Typography>

            <CounterTextField
              label="件名"
              max={BROADCAST_TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              helperText="お知らせの見出しになります"
            />
            <CounterTextField
              label="本文"
              max={BROADCAST_BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              multiline
              minRows={5}
              helperText="送信後は取り消せません"
            />

            <Alert severity="warning">
              送信後は取り消せません。届いたお知らせやメールを消すことはできません。
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
                送信内容を確認
              </Button>
              <Typography variant="body2" color="text.secondary">
                今日はあと {data.remainingToday} 回 ／ このイベントで通算あと{" "}
                {data.remainingTotal} 回 送れます
              </Typography>
            </Stack>
            {data.remainingTotal <= 0 ? (
              <Alert severity="info">
                このイベントで送れる回数（通算）を使い切りました。時間をおいても増えません。
              </Alert>
            ) : (
              data.remainingToday <= 0 && (
                <Alert severity="info">
                  24時間あたりの送信回数の上限に達しました。いちばん古い送信から24時間が過ぎると、また送れるようになります。
                </Alert>
              )
            )}
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          送信履歴
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          この一覧はスタッフだけが見られます。
        </Typography>
        {data.broadcasts.length === 0 ? (
          <Typography color="text.secondary">まだ送信していません。</Typography>
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
                      label={
                        BROADCAST_SEGMENT_LABELS[
                          b.segment as BroadcastSegment
                        ] ?? b.segment
                      }
                    />
                    {b.incomplete && (
                      <Chip size="small" color="warning" label="一部のみ送信" />
                    )}
                    <Typography variant="body2" color="text.secondary">
                      {formatDateTime(b.createdAt)} ・ {b.recipientCount} 人へ
                      {b.senderName ? ` ・ ${b.senderName}` : ""}
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
                      途中で失敗したため、この人数までにしかお知らせが届いていません。
                      同じ内容をもう一度送ると、すでに届いている人には2通届きます。
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
                        失敗した {b.email.failed} 件を送り直す
                      </Button>
                    )}
                  </Stack>
                  {b.email.failed > 0 && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      送り直しても、すでに届いた人にもう1通増えることはありません。送信回数も消費しません。
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
        <DialogTitle>この内容で送信します</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">
              送信後は取り消せません。送る相手と人数を確かめてください。
            </Alert>
            <Box>
              <Typography variant="body2" color="text.secondary">
                送信先
              </Typography>
              <Typography fontWeight={700}>
                {BROADCAST_SEGMENT_LABELS[segment]} ・ {confirmCount ?? 0} 人
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {BROADCAST_SEGMENT_NOTES[segment]}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">
                件名
              </Typography>
              <Typography fontWeight={700}>{title}</Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">
                本文
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {body}
              </Typography>
            </Box>
            {confirmCount === 0 && (
              <Alert severity="info">
                いまこの区分に当てはまる人はいません。送信しても誰にも届きません。
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCount(null)}>やめる</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={send.isPending}
            onClick={doSend}
          >
            {confirmCount ?? 0} 人に送信する
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
