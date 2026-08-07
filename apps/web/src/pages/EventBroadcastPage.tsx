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
  BROADCAST_SEGMENTS,
  BROADCAST_SEGMENT_LABELS,
  BROADCAST_SEGMENT_NOTES,
  BROADCAST_TITLE_MAX,
  type BroadcastSegment,
  type EventBroadcast,
} from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import {
  useEventBroadcasts,
  useSendBroadcast,
} from "../api/broadcastHooks.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { formatDateTime } from "../lib/format.js";

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
  const { data, error } = useEventBroadcasts(id, isStaff);
  const send = useSendBroadcast(id);

  const [segment, setSegment] = useState<BroadcastSegment>("confirmed");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sentInfo, setSentInfo] = useState<string | null>(null);

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

  const doSend = () => {
    send.mutate(
      { segment, title, body },
      {
        onSuccess: (r) => {
          setConfirming(false);
          setTitle("");
          setBody("");
          setSentInfo(
            `${r.recipientCount} 人にお知らせを送りました。` +
              (r.emailQueued > 0
                ? `そのうちメールを受け取る設定の ${r.emailQueued} 人には、順にメールも届きます。`
                : "メールの宛先はありませんでした。"),
          );
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
          送信先の区分を選んでお知らせを送ります。アプリ内のお知らせはすぐに届き、
          メールを受け取る設定の人には順にメールも届きます（人数によっては数分かかります）。
        </Typography>
      </Box>

      {sentInfo && (
        <Alert severity="success" onClose={() => setSentInfo(null)}>
          {sentInfo}
        </Alert>
      )}
      {send.isError && (
        <Alert severity="error">
          送信できませんでした。時間をおいて試してください。
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
                disabled={!canSend || send.isPending}
                onClick={() => setConfirming(true)}
              >
                送信内容を確認
              </Button>
              <Typography variant="body2" color="text.secondary">
                今日はあと {data.remainingToday} 回 ／ このイベントで通算あと{" "}
                {data.remainingTotal} 回 送れます
              </Typography>
            </Stack>
            {(data.remainingToday <= 0 || data.remainingTotal <= 0) && (
              <Alert severity="info">
                送信できる回数の上限に達しました。
                {data.remainingToday <= 0 && data.remainingTotal > 0
                  ? "しばらく時間をおいてから試してください。"
                  : ""}
              </Alert>
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
                  <Divider sx={{ mb: 1 }} />
                  <EmailStatus b={b} />
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
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
                {BROADCAST_SEGMENT_LABELS[segment]} ・ {count} 人
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
            {count === 0 && (
              <Alert severity="info">
                いまこの区分に当てはまる人はいません。送信しても誰にも届きません。
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>やめる</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={send.isPending}
            onClick={doSend}
          >
            {count} 人に送信する
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
