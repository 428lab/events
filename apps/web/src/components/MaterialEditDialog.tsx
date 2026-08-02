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
  const [url, setUrl] = useState(item.materialUrl);
  const save = useUpdateScheduleMaterial(eventId, item.id);

  const trimmed = url.trim();
  const invalid = trimmed !== "" && !/^https?:\/\//.test(trimmed);

  const submit = () => save.mutate(trimmed, { onSuccess: onClose });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>登壇資料URL</DialogTitle>
      <DialogContent>
        <TextField
          label="資料URL（Speaker Deck / Googleスライド / デッキ等）"
          size="small"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={invalid}
          helperText={
            invalid
              ? "http(s):// で始まるURLを入力してください"
              : "空にすると資料リンクを外せます"
          }
          inputProps={{ maxLength: 500 }}
          fullWidth
          autoFocus
          sx={{ mt: 1 }}
        />
        {save.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            資料URLの保存に失敗しました。
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={save.isPending}>
          キャンセル
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={submit}
          disabled={invalid || save.isPending}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
