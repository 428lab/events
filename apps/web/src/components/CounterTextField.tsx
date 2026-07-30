import { Box, TextField, type TextFieldProps } from "@mui/material";

/**
 * 文字数カウンタつき TextField。
 * サーバー側 zod の max と同じ値を `max` に渡すと、helperText 右端に
 * 「現在の文字数/上限」をリアルタイム表示し、maxLength でハードストップする。
 * 文字数は zod の max と同じ UTF-16 code unit（string.length）基準。
 */
export function CounterTextField({
  max,
  value,
  helperText,
  error,
  slotProps,
  ...rest
}: Omit<TextFieldProps, "value"> & { max: number; value: string }) {
  const over = value.length > max;
  return (
    <TextField
      {...rest}
      value={value}
      error={error || over}
      helperText={
        <Box
          component="span"
          sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}
        >
          <span>{helperText}</span>
          <Box
            component="span"
            sx={{ flexShrink: 0, color: over ? "error.main" : undefined }}
          >
            {value.length}/{max}
          </Box>
        </Box>
      }
      slotProps={{
        ...slotProps,
        htmlInput: {
          maxLength: max,
          ...(slotProps?.htmlInput as object | undefined),
        },
      }}
    />
  );
}
