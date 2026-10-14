import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { MAX_EVENT_COHOSTS } from "@eventer/shared";
import type { EventCohost } from "@eventer/shared";
import { useEventCohosts, useRemoveCohost, useRequestCohost } from "../api/cohostHooks.js";
import { errorMessage } from "../lib/errorMessage.js";

/** 共催コミュニティ (#625)。運営ページの「その場で管理」に出す。
 *
 * ここで作るのは相手コミュニティへの依頼だけで、相手の owner/admin が承認して
 * 初めて共催になる。共催は表示と一覧掲載だけで権限は付かない（補足文で明示する）。 */
export function EventCohostsCard({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const { data: cohosts } = useEventCohosts(eventId, true);
  const request = useRequestCohost(eventId);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const full = (cohosts?.length ?? 0) >= MAX_EVENT_COHOSTS;

  const send = () => {
    setError("");
    request.mutate(slug.trim(), {
      onSuccess: () => setSlug(""),
      onError: (e) =>
        setError(
          errorMessage(e, {
            default: t("cohost.errorDefault"),
            community_not_found: t("cohost.errorCommunityNotFound"),
            host_community: t("cohost.errorHostCommunity"),
            already_cohost: t("cohost.errorAlreadyCohost"),
            cohost_limit: t("cohost.errorLimit", { n: MAX_EVENT_COHOSTS }),
          }),
        ),
    });
  };

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {t("cohost.manageIntro")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("cohost.manageHowTo")}
      </Typography>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          sx={{ flex: 1 }}
          label={t("cohost.field")}
          placeholder={t("cohost.placeholder")}
          value={slug}
          disabled={full}
          onChange={(e) => setSlug(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Button
          variant="outlined"
          disabled={full || !slug.trim() || request.isPending}
          onClick={send}
          sx={{ flexShrink: 0 }}
        >
          {t("cohost.send")}
        </Button>
      </Stack>
      {full && (
        <Typography variant="body2" color="text.secondary">
          {t("cohost.limitReached", { n: MAX_EVENT_COHOSTS })}
        </Typography>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {!cohosts || cohosts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("cohost.manageEmpty")}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {cohosts.map((cohost) => (
            <CohostRow key={cohost.communityId} eventId={eventId} cohost={cohost} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function CohostRow({ eventId, cohost }: { eventId: string; cohost: EventCohost }) {
  const { t } = useTranslation();
  // 行ごとに持つ（1件を外している間に他の行のボタンまで止めないため）
  const remove = useRemoveCohost(eventId);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const pending = cohost.status === "pending";

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar
          src={cohost.iconUrl ?? undefined}
          variant="rounded"
          sx={{ width: 28, height: 28, fontSize: 14, borderRadius: "6px" }}
        >
          {cohost.name.charAt(0)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {cohost.name}{" "}
            <Typography component="span" variant="caption" color="text.secondary">
              /c/{cohost.slug}
            </Typography>
          </Typography>
        </Box>
        <Chip
          size="small"
          color={pending ? "warning" : "success"}
          variant={pending ? "filled" : "outlined"}
          label={t(pending ? "cohost.statusPending" : "cohost.statusAccepted")}
        />
        <Chip
          size="small"
          label={t("cohost.remove")}
          clickable
          disabled={remove.isPending}
          onClick={() => setConfirming(true)}
        />
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 0.5 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>{t("cohost.removeConfirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("cohost.removeConfirmBody", { name: cohost.name })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={() => {
              setError("");
              remove.mutate(cohost.communityId, {
                onSuccess: () => setConfirming(false),
                onError: (e) => {
                  setConfirming(false);
                  setError(errorMessage(e, { default: t("cohost.actionError") }));
                },
              });
            }}
          >
            {t("cohost.remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
