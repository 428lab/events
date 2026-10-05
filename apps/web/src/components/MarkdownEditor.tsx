import { useRef, useState, type ReactNode, type SyntheticEvent } from "react";
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
import { useTranslation } from "react-i18next";
import { Markdown } from "./Markdown.js";
import { CounterTextField } from "./CounterTextField.js";
import { insertAtSelection, type TextSelection } from "../lib/descriptionImages.js";

/** Markdown 入力欄（編集/プレビュー切替つき）。イベント説明・参加者限定文章・コメントで使用 */
export function MarkdownEditor({
  value,
  onChange,
  label,
  placeholder,
  minRows = 3,
  helperText,
  max,
  footer,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  minRows?: number;
  helperText?: string;
  /** 文字数上限（サーバー側 zod の max と同値）。指定時のみカウンタ表示 */
  max?: number;
  /** 入力欄の下に置く部品（説明文画像のトレイ）。`insert` は**この入力欄**の
   * 最後のカーソル位置に文字列を差し込む（入力欄から外れても位置を覚えている。
   * まだ触っていなければ末尾に足す） */
  footer?: (insert: (text: string) => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const selection = useRef<TextSelection | null>(null);
  const rememberSelection = (e: SyntheticEvent) => {
    const el = e.target as HTMLTextAreaElement;
    if (typeof el.selectionStart === "number") {
      selection.current = { start: el.selectionStart, end: el.selectionEnd };
    }
  };
  const insert = (text: string) => {
    const next = insertAtSelection(value, text, selection.current);
    selection.current = { start: next.caret, end: next.caret };
    onChange(next.value);
  };
  const editInputProps = footer ? { onSelect: rememberSelection } : {};

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
            {t("eventForm.markdownEdit")}
          </ToggleButton>
          <ToggleButton value="preview" sx={{ px: 1, py: 0.25, gap: 0.5 }}>
            <VisibilityIcon sx={{ fontSize: 16 }} />
            {t("eventForm.markdownPreview")}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {mode === "edit" ? (
        max != null ? (
          <CounterTextField
            max={max}
            value={value}
            onChange={(e) => {
              if (footer) rememberSelection(e);
              onChange(e.target.value);
            }}
            {...editInputProps}
            placeholder={placeholder}
            multiline
            minRows={minRows}
            fullWidth
            helperText={helperText}
          />
        ) : (
          <TextField
            value={value}
            onChange={(e) => {
              if (footer) rememberSelection(e);
              onChange(e.target.value);
            }}
            {...editInputProps}
            placeholder={placeholder}
            multiline
            minRows={minRows}
            fullWidth
            helperText={helperText}
          />
        )
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
              {t("eventForm.markdownEmptyPreview")}
            </Typography>
          )}
        </Box>
      )}
      {footer?.(insert)}
    </Box>
  );
}
