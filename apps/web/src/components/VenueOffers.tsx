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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import {
  useCreateVenueOffer,
  useMyVenues,
  useRespondVenueOffer,
  useVenueOffers,
  type EnrichedVenueOffer,
} from "../api/venueHooks.js";
import { useMyPage } from "../api/hooks.js";

const STATUS_LABEL: Record<string, string> = {
  pending: "回答待ち",
  accepted: "成立🎉",
  declined: "見送り",
};

function statusChip(status: string) {
  return (
    <Chip
      size="small"
      color={status === "accepted" ? "success" : status === "pending" ? "warning" : "default"}
      label={STATUS_LABEL[status] ?? status}
    />
  );
}

/** 主催者側（イベント/たまご詳細）: 届いた・送ったオファーの一覧と応答 */
export function VenueOfferPanel({
  kind,
  id,
  enabled,
}: {
  kind: "for-event" | "for-request";
  id: string;
  enabled: boolean;
}) {
  const { data: offers } = useVenueOffers(kind, id, enabled);
  const respond = useRespondVenueOffer();
  const [contact, setContact] = useState("");
  const [acceptTarget, setAcceptTarget] = useState<EnrichedVenueOffer | null>(null);

  if (!enabled || !offers || offers.length === 0) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          🏟️ 会場オファー
        </Typography>
        <Stack spacing={1.5}>
          {offers.map((o) => (
            <Box key={o.id}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                {statusChip(o.status)}
                <Typography variant="body2">
                  {o.direction === "venue_to_event" ? "提供オファー: " : "利用申込: "}
                  <RouterLink to={`/venues/${o.venueId}`}>
                    {o.venue?.name ?? "会場"}
                  </RouterLink>
                  {o.venue?.area ? `（${o.venue.area}）` : ""}
                </Typography>
                {o.status === "pending" && o.direction === "venue_to_event" && (
                  <>
                    <Button size="small" variant="contained" onClick={() => setAcceptTarget(o)}>
                      承諾
                    </Button>
                    <Button
                      size="small"
                      onClick={() => respond.mutate({ offerId: o.id, action: "decline" })}
                    >
                      辞退
                    </Button>
                  </>
                )}
              </Stack>
              {o.status === "accepted" && (o.venueContact || o.venueAddress) && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  マッチング成立！{o.venueAddress && ` 住所: ${o.venueAddress}`}
                  {o.venueContact && ` ／ 連絡先: ${o.venueContact}`}
                  （以後の相談は直接どうぞ）
                </Alert>
              )}
            </Box>
          ))}
        </Stack>
      </CardContent>

      {/* 承諾ダイアログ（自分の連絡先を添えられる） */}
      <Dialog open={Boolean(acceptTarget)} onClose={() => setAcceptTarget(null)} fullWidth>
        <DialogTitle>オファーを承諾</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            承諾すると会場側の連絡先・住所が開示されます。あなたの連絡先も伝えるとやりとりがスムーズです。
          </Typography>
          <TextField
            label="あなたの連絡先（任意・相手にのみ開示）"
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder="X: @xxx / Discord: xxx など"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAcceptTarget(null)}>キャンセル</Button>
          <Button
            variant="contained"
            disabled={respond.isPending}
            onClick={() =>
              acceptTarget &&
              respond.mutate(
                { offerId: acceptTarget.id, action: "accept", contact },
                { onSuccess: () => setAcceptTarget(null) },
              )
            }
          >
            承諾する
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

/** 会場オーナー側（イベント/たまご詳細）: 「会場を提供できます」ボタン */
export function OfferVenueButton({
  eventId,
  requestId,
}: {
  eventId?: string;
  requestId?: string;
}) {
  const { data: myVenues } = useMyVenues();
  const create = useCreateVenueOffer();
  const [open, setOpen] = useState(false);
  const [venueId, setVenueId] = useState("");

  const candidates = (myVenues ?? []).filter((v) => v.status === "open");
  if (candidates.length === 0) return null;

  return (
    <>
      <Button variant="outlined" color="success" onClick={() => setOpen(true)}>
        🏟️ 会場を提供できます
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth>
        <DialogTitle>会場を提供する</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="提供する会場"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          >
            {candidates.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name}（{v.area}）
              </MenuItem>
            ))}
          </TextField>
          {create.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              送信できませんでした（同じ会場で既にオファー済みの可能性）。
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>キャンセル</Button>
          <Button
            variant="contained"
            disabled={!venueId || create.isPending}
            onClick={() =>
              create.mutate(
                { venueId, eventId, requestId },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            オファーを送る
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** イベンター側（会場詳細）: 「この会場を使いたい」ボタン */
export function UseVenueButton({ venueId }: { venueId: string }) {
  const { data: my } = useMyPage();
  const create = useCreateVenueOffer();
  const [open, setOpen] = useState(false);
  const [eventId, setEventId] = useState("");
  const [contact, setContact] = useState("");

  // 自分がスタッフの開催予定イベントから選ぶ
  const candidates = (my?.ongoing ?? []).filter((e) => e.myRole === "staff");
  if (candidates.length === 0) return null;

  return (
    <>
      <Button variant="contained" onClick={() => setOpen(true)}>
        この会場を使いたい
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth>
        <DialogTitle>会場の利用を申し込む</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="対象イベント"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              fullWidth
            >
              {candidates.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {e.title}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="あなたの連絡先（承諾後に会場側へ開示）"
              slotProps={{ inputLabel: { shrink: true } }}
              placeholder="X: @xxx / Discord: xxx など"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              fullWidth
            />
            {create.isError && (
              <Alert severity="error">
                送信できませんでした（既にオファー済みの可能性）。
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>キャンセル</Button>
          <Button
            variant="contained"
            disabled={!eventId || create.isPending}
            onClick={() =>
              create.mutate(
                { venueId, eventId, contact },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            申し込む
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** 会場オーナー側（会場詳細）: この会場のオファー一覧と応答 */
export function VenueOwnerOffers({ venueId }: { venueId: string }) {
  const { data: offers } = useVenueOffers("for-venue", venueId, true);
  const respond = useRespondVenueOffer();
  if (!offers || offers.length === 0) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          この会場へのオファー
        </Typography>
        <Stack spacing={1.5}>
          {offers.map((o) => {
            const target = o.event
              ? { label: o.event.title, to: `/events/${o.event.id}` }
              : o.request
                ? { label: `🥚 ${o.request.title}`, to: `/requests/${o.request.id}` }
                : null;
            return (
              <Box key={o.id}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {statusChip(o.status)}
                  <Typography variant="body2">
                    {o.direction === "event_to_venue" ? "利用申込: " : "提供オファー: "}
                    {target && <RouterLink to={target.to}>{target.label}</RouterLink>}
                  </Typography>
                  {o.status === "pending" && o.direction === "event_to_venue" && (
                    <>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={respond.isPending}
                        onClick={() => respond.mutate({ offerId: o.id, action: "accept" })}
                      >
                        承諾
                      </Button>
                      <Button
                        size="small"
                        disabled={respond.isPending}
                        onClick={() => respond.mutate({ offerId: o.id, action: "decline" })}
                      >
                        辞退
                      </Button>
                    </>
                  )}
                </Stack>
                {o.status === "accepted" && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    マッチング成立！
                    {o.organizerContact
                      ? ` 主催者の連絡先: ${o.organizerContact}（以後の相談は直接どうぞ）`
                      : " 主催者からの連絡をお待ちください（あなたの連絡先が開示されています）"}
                  </Alert>
                )}
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
