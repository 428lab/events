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
import CelebrationIcon from "@mui/icons-material/Celebration";
import DownloadIcon from "@mui/icons-material/Download";
import EggIcon from "@mui/icons-material/Egg";
import StadiumIcon from "@mui/icons-material/Stadium";
import { Link as RouterLink } from "react-router-dom";
import {
  useCreateVenueOffer,
  useMyVenues,
  useRespondVenueOffer,
  useVenueOffers,
  type EnrichedVenueOffer,
} from "../api/venueHooks.js";
import { useMyPage } from "../api/hooks.js";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { EventRequest } from "@eventer/shared";
import { CounterTextField } from "./CounterTextField.js";

const STATUS_LABEL: Record<string, string> = {
  pending: "回答待ち",
  accepted: "成立",
  declined: "見送り",
};

function statusChip(status: string) {
  return (
    <Chip
      size="small"
      color={status === "accepted" ? "success" : status === "pending" ? "warning" : "default"}
      icon={status === "accepted" ? <CelebrationIcon fontSize="small" /> : undefined}
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
        <Typography
          variant="h6"
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <StadiumIcon fontSize="small" />
          会場オファー
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
          <CounterTextField
            label="あなたの連絡先（任意・相手にのみ開示）"
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder="X: @xxx / Discord: xxx など"
            value={contact}
            max={500}
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
      <Button
        variant="outlined"
        color="success"
        startIcon={<StadiumIcon />}
        onClick={() => setOpen(true)}
      >
        会場を提供できます
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
  const { data: myRequests } = useQuery({
    queryKey: ["myRequests"],
    queryFn: async () =>
      (await api.get<{ requests: EventRequest[] }>("/me/requests")).requests,
  });
  const create = useCreateVenueOffer();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(""); // "e:<id>" | "r:<id>"
  const [contact, setContact] = useState("");

  // 自分がスタッフの開催予定イベント（公開済みのみ）と自分のたまごから選ぶ
  const candidates = (my?.ongoing ?? []).filter(
    (e) => e.myRole === "staff" && e.status === "published",
  );
  const eggs = (myRequests ?? []).filter((r) => !r.membersOnly);
  if (candidates.length === 0 && eggs.length === 0) return null;

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
              label="対象（イベント / たまご）"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              fullWidth
            >
              {candidates.map((e) => (
                <MenuItem key={e.id} value={`e:${e.id}`}>
                  {e.title}
                </MenuItem>
              ))}
              {eggs.map((r) => (
                <MenuItem key={r.id} value={`r:${r.id}`}>
                  たまご: {r.title}
                </MenuItem>
              ))}
            </TextField>
            <CounterTextField
              label="あなたの連絡先（承諾後に会場側へ開示）"
              slotProps={{ inputLabel: { shrink: true } }}
              placeholder="X: @xxx / Discord: xxx など"
              value={contact}
              max={500}
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
            disabled={!target || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  venueId,
                  ...(target.startsWith("e:")
                    ? { eventId: target.slice(2) }
                    : { requestId: target.slice(2) }),
                  contact,
                },
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
                ? {
                    label: (
                      <Box
                        component="span"
                        sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
                      >
                        <EggIcon fontSize="inherit" />
                        {o.request.title}
                      </Box>
                    ),
                    to: `/requests/${o.request.id}`,
                  }
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
                {/* 成立イベントの受付名簿（同一オリジンの <a> なので cookie 認証のまま） (#154) */}
                {o.status === "accepted" && o.event && (
                  <Box sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<DownloadIcon />}
                      component="a"
                      href={`/api/events/${o.event.id}/attendance.csv`}
                      download
                    >
                      入館名簿CSV
                    </Button>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mt: 0.5 }}
                    >
                      入館管理のためにご利用ください。個人情報の取り扱いにご注意ください
                    </Typography>
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
