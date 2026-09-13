import type { DeckImportIssue } from "@eventer/shared";
import type { TFunction } from "i18next";

/** Fixed constraints only: never interpolate input values into repair instructions. */
export function describeImportIssue(issue: DeckImportIssue, t: TFunction): string {
  const names: Record<string, string> = {
    required: "required", unknown_key: "unknown", invalid_type: "type", invalid_literal: "literal", invalid_enum: "enum",
    invalid_count: "count", too_many_elements: "elements", out_of_bounds: "bounds", out_of_range: "range",
    invalid_unicode: "unicode", invalid_length: "length", invalid_color: "color", invalid_title: "titleRule",
    invalid_text: "textRule", too_much_text: "totalText", converted_too_large: "converted",
  };
  const key = names[issue.code];
  return key ? t(`deckImportIssue.${key}`, { defaultValue: issue.message }) : t("deckImport.constraint");
}
export function importIssueLocation(path: string, t: TFunction): string {
  const match = /^slides\[(\d+)\](?:\.elements\[(\d+)\])?/.exec(path);
  const field = path.split(".").at(-1) ?? "";
  const fields = ["x", "y", "w", "h", "text", "fontSize", "font", "color", "background", "title", "align", "bold", "italic", "type", "version", "format", "slides", "elements"];
  return [match && t("deckImport.page", { n: Number(match[1]) + 1 }), match?.[2] && t("deckImport.element", { n: Number(match[2]) + 1 }), fields.includes(field) && t(`deckImportField.${field}`, { defaultValue: field })].filter(Boolean).join(" / ");
}
