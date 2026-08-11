import { Box, Button, IconButton, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloseIcon from "@mui/icons-material/Close";
import type { TrackRow } from "./scheduleEditorModel.js";

/** トラック（並行して走る枠）の管理 (#338)。追加・改名・並べ替え・削除。
 * 並べ替えはボタンだけで完結する（スマホで使えないと意味がないため）。
 * トラックはイベント内の名前でしかなく、会場の部屋とは紐づけない。 */
export function ScheduleTrackManager({
  tracks,
  onAdd,
  onRename,
  onMove,
  onRemove,
}: {
  tracks: TrackRow[];
  onAdd: () => void;
  onRename: (key: string, name: string) => void;
  onMove: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        トラック
      </Typography>
      <Stack spacing={0.5}>
        {tracks.map((t, i) => (
          <Stack key={t.key} direction="row" spacing={0.5} alignItems="center">
            <TextField
              size="small"
              label={`トラック${i + 1}の名前`}
              value={t.name}
              onChange={(e) => onRename(t.key, e.target.value)}
              error={t.name.trim() === ""}
              inputProps={{ maxLength: 50 }}
              sx={{ flex: 1, maxWidth: 320 }}
            />
            <IconButton
              size="small"
              disabled={i === 0}
              onClick={() => onMove(t.key, -1)}
              title="このトラックを前へ"
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              disabled={i === tracks.length - 1}
              onClick={() => onMove(t.key, 1)}
              title="このトラックを後ろへ"
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => onRemove(t.key)}
              title="このトラックを削除"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
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
        トラックを追加
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {tracks.length > 0
          ? "トラックを削除すると、そのトラックにだけ載っていたセッションは未割り当てに戻ります。"
          : "同じ時間に並行して走る枠がある場合に追加します。"}
      </Typography>
    </Box>
  );
}
