import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ScheduleItem } from "@eventer/shared";
import { useUpdateScheduleMaterial } from "../api/eventScheduleHooks.js";

/** 登壇資料URLの自己編集ダイアログ (#148)。
 * タイムテーブル行と資料ギャラリーの両方から、リンクされた登壇者本人が開ける。 */
export function MaterialEditDialog({
  eventId,
  item,
  onClose,
}: {
  eventId: string;
  item: ScheduleItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(item.materialUrl);
  const save = useUpdateScheduleMaterial(eventId, item.id);

  const trimmed = url.trim();
  const invalid = trimmed !== "" && !/^https?:\/\//.test(trimmed);

  const submit = () => save.mutate(trimmed, { onSuccess: onClose });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("eventForm.materialUrlTitle")}</DialogTitle>
      <DialogContent>
        <TextField
          label={t("eventForm.materialUrlLabel")}
          size="small"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={invalid}
          helperText={
            invalid
              ? t("eventForm.materialUrlInvalid")
              : t("eventForm.materialUrlHelp")
          }
          inputProps={{ maxLength: 500 }}
          fullWidth
          autoFocus
          sx={{ mt: 1 }}
        />
        {save.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {t("eventForm.materialSaveError")}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={save.isPending}>
          {t("common.cancel")}
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={submit}
          disabled={invalid || save.isPending}
        >
          {t("common.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
