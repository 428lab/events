import { useEffect, useState } from "react";
import type { TextFieldProps } from "@mui/material";
import { CounterTextField } from "./CounterTextField.js";

/** onBlur 保存用の文字数カウンタ付きフィールド。
 * 外側の値（保存や再取得）が変わったら同期する。 */
export function BlurCounterField({
  label,
  initial,
  max,
  onSave,
  ...rest
}: {
  label: string;
  initial: string;
  max: number;
  onSave: (value: string) => void;
} & Omit<TextFieldProps, "value" | "onChange" | "onBlur" | "label">) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <CounterTextField
      label={label}
      value={value}
      max={max}
      size="small"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSave(value)}
      {...rest}
    />
  );
}
