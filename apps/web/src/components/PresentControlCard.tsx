import { useState } from "react";
import { Alert, Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { EventState } from "@eventer/shared";
import { deckSlugFromUrl } from "../lib/presentationDeck.js";
import { useSetPresentControl } from "../api/scoringHooks.js";

/** 運営: 発表中のエントリーのスライドを選び、ページめくりを発表者に渡す／運営に戻す
 * （docs/contest-organizer-ux.md「発表のページめくり」）。
 * 渡すと発表中のエントリーのメンバー全員（チームなら誰が操作するかはチームで決める）がめくれ、
 * 見ている人の画面もそのページに切り替わる。どの操作でも鍵が変わり、前にめくっていた画面からはもうめくれない */
export function PresentControlCard({
  eventId,
  state,
  submissionUrl,
}: {
  eventId: string;
  state: EventState;
  /** 発表中のエントリーの成果物の資料URL */
  submissionUrl: string | null | undefined;
}) {
  const { t } = useTranslation();
  const set = useSetPresentControl(eventId);
  const [url, setUrl] = useState("");
  const control = state.presentControl;
  if (!state.presentingEntryId || !control) return null;

  const submissionSlug = deckSlugFromUrl(submissionUrl, window.location.origin);
  const slug = control.deckSlug ?? submissionSlug;
  const typedSlug = deckSlugFromUrl(url, window.location.origin);
  const toPresenter = control.control === "staff";

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" gutterBottom>{t("eventRun.presentDeckHeading")}</Typography>
      <Typography variant="body2">
        {slug
          ? t(control.deckSlug ? "eventRun.presentDeckChosen" : "eventRun.presentDeckFromSubmission", { slug })
          : t("eventRun.presentDeckNone")}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
        <TextField
          size="small"
          fullWidth
          label={t("eventRun.presentDeckUrlLabel")}
          placeholder="/d/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={url.trim() !== "" && !typedSlug}
          helperText={url.trim() !== "" && !typedSlug ? t("eventRun.presentDeckUrlInvalid") : undefined}
        />
        <Button variant="outlined" disabled={!typedSlug || set.isPending}
          onClick={() => set.mutate({ deckUrl: url.trim() }, { onSuccess: () => setUrl("") })}>
          {t("eventRun.presentDeckUse")}
        </Button>
        {control.deckSlug && (
          <Button disabled={set.isPending} onClick={() => set.mutate({ deckUrl: null })}>
            {t("eventRun.presentDeckUseSubmission")}
          </Button>
        )}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
        <Chip
          size="small"
          color={toPresenter ? "default" : "primary"}
          label={t(toPresenter ? "eventRun.presentControlStaff" : "eventRun.presentControlPresenter")}
        />
        <Button
          variant={toPresenter ? "contained" : "outlined"}
          disabled={set.isPending || (toPresenter && !slug)}
          onClick={() => set.mutate({ control: toPresenter ? "presenter" : "staff" })}
        >
          {t(toPresenter ? "eventRun.presentControlGive" : "eventRun.presentControlTake")}
        </Button>
      </Stack>
      {set.isError && <Alert severity="error" sx={{ mt: 1 }}>{t("eventRun.presentControlError")}</Alert>}
    </Box>
  );
}
