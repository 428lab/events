import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ScheduleItem } from "@eventer/shared";
import { useMyDecks } from "../api/deckHooks.js";
import { useSetScheduleLiveDeck } from "../api/eventScheduleHooks.js";
import { formatDateTime } from "../lib/format.js";

/** 「この発表で使うスライド」(#571)。登壇者本人が、自分のコマに自分のデッキを1つ紐付ける。
 * タイムテーブル行の資料URL編集 (#148) と同じ入口から開く。
 * 選べるのは自分のデッキだけ（`/api/decks/mine` と同じ一覧）。 */
export function LiveDeckDialog({
  eventId,
  item,
  onClose,
}: {
  eventId: string;
  item: ScheduleItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: decks, isLoading } = useMyDecks();
  const save = useSetScheduleLiveDeck(eventId, item.id);
  const [picked, setPicked] = useState<string | null>(item.liveDeck?.id ?? null);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("schedule.liveDeckDialogTitle", { title: item.title })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("schedule.liveDeckDialogLead")}
        </Typography>
        {isLoading || !decks ? (
          <Typography>{t("common.loading")}</Typography>
        ) : decks.length === 0 ? (
          <Box sx={{ mb: 1.5 }}>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              {t("schedule.liveDeckNoDecks")}
            </Typography>
            <Button component={RouterLink} to="/decks" variant="outlined" size="small">
              {t("schedule.liveDeckCreate")}
            </Button>
          </Box>
        ) : (
          <Box
            role="radiogroup"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
              gap: 1,
              mb: 1.5,
            }}
          >
            {decks.map((d) => {
              const selected = d.id === picked;
              return (
                <Card
                  key={d.id}
                  variant="outlined"
                  sx={{ borderWidth: 2, borderColor: selected ? "primary.main" : "divider" }}
                >
                  <CardActionArea
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPicked(d.id)}
                    sx={{ p: 1.25 }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography fontWeight={700} noWrap sx={{ flex: 1, minWidth: 0 }}>
                        {d.title || t("studio.untitledDeck")}
                      </Typography>
                      {selected && (
                        <Chip size="small" color="primary" label={t("schedule.liveDeckSelected")} />
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {t(d.slideCount === 1 ? "studio.pageCountOne" : "studio.pageCount", { n: d.slideCount })}
                      {t("common.dotSeparator")}
                      {t("studio.updatedAt", { time: formatDateTime(d.updatedAt) })}
                    </Typography>
                  </CardActionArea>
                </Card>
              );
            })}
          </Box>
        )}
        <Alert severity="warning" icon={false}>
          {t("schedule.liveDeckConsent")}
        </Alert>
        {save.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {t("schedule.liveDeckSaveError")}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button size="small" onClick={onClose} disabled={save.isPending}>
          {t("common.cancel")}
        </Button>
        {item.liveDeck && (
          <Button
            size="small"
            color="error"
            disabled={save.isPending}
            onClick={() => save.mutate(null, { onSuccess: onClose })}
          >
            {t("schedule.liveDeckUnlink")}
          </Button>
        )}
        <Button
          size="small"
          variant="contained"
          disabled={!picked || picked === item.liveDeck?.id || save.isPending}
          onClick={() => picked && save.mutate(picked, { onSuccess: onClose })}
        >
          {t("schedule.liveDeckUse")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
