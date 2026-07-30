import { useState } from "react";
import {
  Box,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Markdown } from "./Markdown.js";

/** Markdown 入力欄（編集/プレビュー切替つき）。イベント説明・参加者限定文章・コメントで使用 */
export function MarkdownEditor({
  value,
  onChange,
  label,
  placeholder,
  minRows = 3,
  helperText,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  minRows?: number;
  helperText?: string;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 0.5 }}
      >
        {label ? (
          <Typography variant="subtitle2">{label}</Typography>
        ) : (
          <Box />
        )}
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_e, v: "edit" | "preview" | null) => v && setMode(v)}
        >
          <ToggleButton value="edit" sx={{ px: 1, py: 0.25, gap: 0.5 }}>
            <EditIcon sx={{ fontSize: 16 }} />
            編集
          </ToggleButton>
          <ToggleButton value="preview" sx={{ px: 1, py: 0.25, gap: 0.5 }}>
            <VisibilityIcon sx={{ fontSize: 16 }} />
            プレビュー
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {mode === "edit" ? (
        <TextField
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          multiline
          minRows={minRows}
          fullWidth
          helperText={helperText}
        />
      ) : (
        <Box
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            px: 1.75,
            py: 1.5,
            // 編集欄とおおよそ同じ高さを確保してガタつきを抑える
            minHeight: `${minRows * 1.5 + 2}em`,
          }}
        >
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <Typography color="text.secondary" variant="body2">
              プレビューする内容がありません。
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
