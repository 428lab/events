import {
  Box,
  Button,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloseIcon from "@mui/icons-material/Close";
import type { TrackRow } from "./scheduleEditorModel.js";

/** トラック（並行して走る枠）の管理 (#338)。追加・改名・並べ替え・削除。
 * 並べ替えはボタンだけで完結する（スマホで使えないと意味がないため）。
 * トラックはイベント内の名前でしかなく、会場の部屋とは紐づけない。
 *
 * 「運営用の列」(#383) は受付・控え室のように、表のセッションに紐づかない
 * 持ち場を置く列。同じ表で持つので時間軸は表の列と1本のまま。 */
export function ScheduleTrackManager({
  tracks,
  onAdd,
  onRename,
  onMove,
  onRemove,
  onSetStaffOnly,
}: {
  tracks: TrackRow[];
  onAdd: () => void;
  onRename: (key: string, name: string) => void;
  onMove: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  /** 運営用の列にする / 表の列に戻す (#383) */
  onSetStaffOnly: (key: string, staffOnly: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t("schedule.tracks")}
      </Typography>
      <Stack spacing={0.5}>
        {tracks.map((track, i) => (
          <Stack key={track.key} spacing={0.25}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <TextField
                size="small"
                label={t("schedule.trackNameLabel", { n: i + 1 })}
                value={track.name}
                onChange={(e) => onRename(track.key, e.target.value)}
                error={track.name.trim() === ""}
                inputProps={{ maxLength: 50 }}
                sx={{ flex: 1, maxWidth: 320 }}
              />
              <IconButton
                size="small"
                disabled={i === 0}
                onClick={() => onMove(track.key, -1)}
                title={t("schedule.moveTrackUp")}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                disabled={i === tracks.length - 1}
                onClick={() => onMove(track.key, 1)}
                title={t("schedule.moveTrackDown")}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => onRemove(track.key)}
                title={t("schedule.removeTrack")}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            {/* 運営用の列 (#383)。名前の欄と同じ行に並べるとスマホで入り切らない
                ので、1本ぶんの下に置く */}
            <Stack direction="row" alignItems="center" spacing={0.25}>
              <Switch
                size="small"
                checked={track.visibility === "staff"}
                onChange={(e) =>
                  onSetStaffOnly(track.key, e.target.checked)
                }
                inputProps={{ "aria-label": t("schedule.staffTrackToggle") }}
              />
              <Typography variant="caption">
                {t("schedule.staffTrackToggle")}
              </Typography>
            </Stack>
            {track.visibility === "staff" && (
              <Typography variant="caption" color="text.secondary">
                {t("schedule.staffTrackHint")}
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>
      <Button
        size="small"
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={onAdd}
        sx={{ mt: tracks.length > 0 ? 1 : 0 }}
      >
        {t("schedule.addTrack")}
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {tracks.length > 0
          ? t("schedule.trackRemoveNote")
          : t("schedule.trackAddHint")}
      </Typography>
    </Box>
  );
}
