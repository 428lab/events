import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { CommunityCohost } from "@eventer/shared";
import { useCommunityCohosts, useRespondCohost } from "../api/cohostHooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { formatDateTime } from "../lib/format.js";
import { useContestAnchor } from "../lib/useContestAnchor.js";

/** 共催 (#625)。コミュニティ編集ページ（owner/admin のみ）に出す。
 *
 * 他のイベントからこのコミュニティに届いた共催の依頼を承諾・辞退し、共催中のものを
 * やめられる。承諾しても運営の権限は付かない（表示と一覧掲載だけ）。
 * 通知のリンク（/c/<slug>/edit#cohosts）からここへ直接来る */
export function CommunityCohostsSection({ communityId }: { communityId: string }) {
  const { t } = useTranslation();
  const { data: cohosts } = useCommunityCohosts(communityId, true);
  useContestAnchor("cohosts", Boolean(cohosts));
  const requests = (cohosts ?? []).filter((c) => c.status === "pending");
  const active = (cohosts ?? []).filter((c) => c.status === "accepted");

  return (
    <Box id="cohosts" tabIndex={-1} sx={{ scrollMarginTop: 88 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        {t("cohost.communityTitle")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("cohost.communityIntro")}
      </Typography>
      {cohosts && cohosts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("cohost.communityEmpty")}
        </Typography>
      ) : (
        <Stack spacing={2}>
          {requests.length > 0 && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t("cohost.requestsHeading")}
              </Typography>
              <Stack spacing={1.5}>
                {requests.map((c) => (
                  <CohostItem key={c.eventId} communityId={communityId} cohost={c} />
                ))}
              </Stack>
            </Box>
          )}
          {active.length > 0 && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t("cohost.activeHeading")}
              </Typography>
              <Stack spacing={1.5}>
                {active.map((c) => (
                  <CohostItem key={c.eventId} communityId={communityId} cohost={c} />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      )}
    </Box>
  );
}

function CohostItem({
  communityId,
  cohost,
}: {
  communityId: string;
  cohost: CommunityCohost;
}) {
  const { t } = useTranslation();
  // 行ごとに持つ（1件を処理している間に他の行のボタンまで止めないため）
  const accept = useRespondCohost(communityId, "accept");
  const remove = useRespondCohost(communityId, "remove");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const pending = cohost.status === "pending";
  const busy = accept.isPending || remove.isPending;
  const onError = (e: unknown) => setError(errorMessage(e, { default: t("cohost.actionError") }));
  // 閲覧できないイベントはサーバーが題名・日時・主催名を伏せて（null で）返す。汎用の表示にする
  const title = cohost.eventTitle ?? t("cohost.hiddenEvent");
  // 承諾するか決める材料に、下書き・公開範囲を添える（公開・公開済みは何も出さない）
  const chips = [
    cohost.eventStatus === "draft" && t("events.draftBadge"),
    cohost.eventVisibility === "private" && t("eventAccess.private"),
    cohost.eventVisibility === "unlisted" && t("eventAccess.unlisted"),
  ].filter((label): label is string => Boolean(label));

  return (
    <Box>
      <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography variant="body2" fontWeight={700}>
          {title}
        </Typography>
        {chips.map((label) => (
          <Chip key={label} label={label} size="small" variant="outlined" />
        ))}
      </Stack>
      {cohost.eventTitle !== null && (
        <Typography variant="caption" color="text.secondary" display="block">
          {cohost.hostCommunityName && t("cohost.hostedBy", { name: cohost.hostCommunityName })}
          {cohost.hostCommunityName && " / "}
          {cohost.eventStartsAt
            ? formatDateTime(cohost.eventStartsAt)
            : t("cohost.dateTbd")}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
        {pending ? (
          <>
            <Button
              size="small"
              variant="contained"
              disabled={busy}
              onClick={() => {
                setError("");
                accept.mutate(cohost.eventId, { onError });
              }}
            >
              {t("cohost.accept")}
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={busy}
              onClick={() => {
                setError("");
                remove.mutate(cohost.eventId, { onError });
              }}
            >
              {t("cohost.decline")}
            </Button>
          </>
        ) : (
          <Button size="small" variant="outlined" disabled={busy} onClick={() => setConfirming(true)}>
            {t("cohost.stop")}
          </Button>
        )}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 0.5 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>{t("cohost.stopConfirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("cohost.stopConfirmBody", { title })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
          <Button
            color="error"
            disabled={busy}
            onClick={() => {
              setError("");
              remove.mutate(cohost.eventId, {
                onSuccess: () => setConfirming(false),
                onError: (e) => {
                  setConfirming(false);
                  onError(e);
                },
              });
            }}
          >
            {t("cohost.stop")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
