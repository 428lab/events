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
import { useTranslation } from "react-i18next";
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
import { errorCode } from "../lib/errorMessage.js";
import { i18next, tDynamic } from "../i18n/index.js";
import { CounterTextField } from "./CounterTextField.js";

/** オファーの送信・応答が断られたときの文言。表は辞書 (`venueOfferError`) にあり、
 *  知らないコードは default に落ちる */
function offerErrorMessage(error: unknown): string {
  const fallback = i18next.t("venueOfferError.default");
  const code = errorCode(error);
  return code ? tDynamic(`venueOfferError.${code}`, fallback) : fallback;
}

function statusChip(status: string) {
  return (
    <Chip
      size="small"
      color={status === "accepted" ? "success" : status === "pending" ? "warning" : "default"}
      icon={status === "accepted" ? <CelebrationIcon fontSize="small" /> : undefined}
      label={tDynamic(`venueOfferStatus.${status}`, status)}
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
  const { t } = useTranslation();
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
          {t("venue.offersHeading")}
        </Typography>
        <Stack spacing={1.5}>
          {offers.map((o) => {
            // 住所・連絡先は「ある分だけ」つなぐ。語順は辞書 (`venue.matched`) が持つ
            const details = [
              o.venueAddress && t("venue.matchedAddress", { address: o.venueAddress }),
              o.venueContact && t("venue.matchedContact", { contact: o.venueContact }),
            ]
              .filter(Boolean)
              .join(t("venue.detailSeparator"));
            return (
              <Box key={o.id}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {statusChip(o.status)}
                  <Typography variant="body2">
                    {o.direction === "venue_to_event"
                      ? t("venue.directionOffer")
                      : t("venue.directionRequest")}{" "}
                    <RouterLink to={`/venues/${o.venueId}`}>
                      {o.venue?.name ?? t("venue.nameFallback")}
                    </RouterLink>
                    {o.venue?.area
                      ? t("common.parenName", { name: o.venue.area })
                      : ""}
                  </Typography>
                  {o.status === "pending" && o.direction === "venue_to_event" && (
                    <>
                      <Button size="small" variant="contained" onClick={() => setAcceptTarget(o)}>
                        {t("venue.accept")}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => respond.mutate({ offerId: o.id, action: "decline" })}
                      >
                        {t("venue.decline")}
                      </Button>
                    </>
                  )}
                </Stack>
                {o.status === "accepted" && (o.venueContact || o.venueAddress) && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    {t("venue.matched", { details })}
                  </Alert>
                )}
              </Box>
            );
          })}
        </Stack>
      </CardContent>

      {/* 承諾ダイアログ（自分の連絡先を添えられる） */}
      <Dialog open={Boolean(acceptTarget)} onClose={() => setAcceptTarget(null)} fullWidth>
        <DialogTitle>{t("venue.acceptTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("venue.acceptLead")}
          </Typography>
          <CounterTextField
            label={t("venue.myContactLabel")}
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder={t("venue.myContactPlaceholder")}
            value={contact}
            max={500}
            onChange={(e) => setContact(e.target.value)}
            fullWidth
          />
          {respond.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {offerErrorMessage(respond.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAcceptTarget(null)}>{t("common.cancel")}</Button>
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
            {t("venue.acceptSubmit")}
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
  const { t } = useTranslation();
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
        {t("venue.offerCta")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth>
        <DialogTitle>{t("venue.offerTitle")}</DialogTitle>
        <DialogContent>
          <TextField
            select
            label={t("venue.offerVenueLabel")}
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          >
            {candidates.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name}
                {t("common.parenName", { name: v.area })}
              </MenuItem>
            ))}
          </TextField>
          {create.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {offerErrorMessage(create.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
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
            {t("venue.offerSubmit")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** イベンター側（会場詳細）: 「この会場を使いたい」ボタン */
export function UseVenueButton({ venueId }: { venueId: string }) {
  const { t } = useTranslation();
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
        {t("venue.useCta")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth>
        <DialogTitle>{t("venue.useTitle")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label={t("venue.useTargetLabel")}
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
                  {t("venue.useTargetEgg", { title: r.title })}
                </MenuItem>
              ))}
            </TextField>
            <CounterTextField
              label={t("venue.useContactLabel")}
              slotProps={{ inputLabel: { shrink: true } }}
              placeholder={t("venue.myContactPlaceholder")}
              value={contact}
              max={500}
              onChange={(e) => setContact(e.target.value)}
              fullWidth
            />
            {create.isError && (
              <Alert severity="error">{offerErrorMessage(create.error)}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
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
            {t("venue.useSubmit")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** 会場オーナー側（会場詳細）: この会場のオファー一覧と応答 */
export function VenueOwnerOffers({ venueId }: { venueId: string }) {
  const { t } = useTranslation();
  const { data: offers } = useVenueOffers("for-venue", venueId, true);
  const respond = useRespondVenueOffer();
  if (!offers || offers.length === 0) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("venue.ownerOffersHeading")}
        </Typography>
        {respond.isError && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {offerErrorMessage(respond.error)}
          </Alert>
        )}
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
                    {o.direction === "event_to_venue"
                      ? t("venue.directionRequest")
                      : t("venue.directionOffer")}{" "}
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
                        {t("venue.accept")}
                      </Button>
                      <Button
                        size="small"
                        disabled={respond.isPending}
                        onClick={() => respond.mutate({ offerId: o.id, action: "decline" })}
                      >
                        {t("venue.decline")}
                      </Button>
                    </>
                  )}
                </Stack>
                {o.status === "accepted" && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    {o.organizerContact
                      ? t("venue.matchedOrganizer", {
                          contact: o.organizerContact,
                        })
                      : t("venue.matchedWaiting")}
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
                      {t("venue.attendanceCsv")}
                    </Button>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mt: 0.5 }}
                    >
                      {t("venue.attendanceCsvNote")}
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
