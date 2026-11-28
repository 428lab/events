import { deckContentSchema, type DeckContent, type DeckElement } from "./decks.js";
import { DECK_IMPORT_MAX_BYTES, hasLoneSurrogate, parseDeckImportJson } from "./deckImportJson.js";
import { DISPLAY_FONTS } from "./displayFonts.js";
export * from "./deckImportJson.js";

export const DECK_IMPORT_LIMITS = {
  slides: 60, elementsPerSlide: 50, elements: 1000, text: 10000, totalText: 100000,
  title: 120, issues: 50, bytes: DECK_IMPORT_MAX_BYTES,
} as const;
/** v1 の書体（据え置き） */
export const DECK_IMPORT_V1_FONTS = ["default", "serif", "monospace"] as const;
/** スライドの編集画面で選べる書体の一覧。編集画面の選択肢（web lib/deckFonts.ts）と v2 JSON の
 * `font` はここから引く。並びは編集画面の並び。`default` は既定（fontFamily ""）、それ以外は
 * fontFamily の値そのもの。v2 で AI に直してもらっても書体が変わらないようにするため（kojira 2026-11-28） */
export const DECK_IMPORT_FONTS = [
  "default", "Plus Jakarta Sans", "serif", "monospace", ...DISPLAY_FONTS.map((f) => f.family),
] as const;
export type DeckImportFont = typeof DECK_IMPORT_FONTS[number];

/** v2 は回転（度）とグループ（同じ値の要素はまとめて動く）も持てる。v1 には無い */
interface ImportBox { x: number; y: number; w: number; h: number; rotation?: number; group?: string }
/** v1 は全部必須。v2 は fontSize / font / color / bold / italic / align を省ける（省けば表示の既定） */
export interface DeckImportText extends ImportBox {
  type: "text"; text: string; fontSize: number; font: DeckImportFont; color: string;
  bold: boolean; italic: boolean; align: "left" | "center" | "right";
}
export type DeckImportV2Text = Omit<DeckImportText, "fontSize" | "font" | "color" | "bold" | "italic" | "align">
  & Partial<Pick<DeckImportText, "fontSize" | "font" | "color" | "bold" | "italic" | "align">>;
export interface DeckImportPlaceholder extends ImportBox { type: "image-placeholder" }
export interface DeckImportImageUrl extends ImportBox { type: "image-url"; src: string }
export interface DeckImportV1 {
  format: "events-lab-deck"; version: 1; title: string;
  slides: { background: string; elements: (DeckImportText | DeckImportPlaceholder)[] }[];
}
export interface DeckImportV2 {
  format: "events-lab-deck"; version: 2; title: string;
  slides: { background: string; elements: (DeckImportV2Text | DeckImportPlaceholder | DeckImportImageUrl)[] }[];
}
export type DeckImport = DeckImportV1 | DeckImportV2;
export interface DeckImportIssue { path: string; code: string; message: string; example?: string }
export type DeckImportValidation =
  | { ok: true; value: DeckImport }
  | { ok: false; issues: DeckImportIssue[]; truncated: boolean };

/** Public schema is also the structural definition used by the strict validator.
 * JSON Schema string lengths count code points; our runtime counts UTF-16 instead.
 */
const integer = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum } as const);
const color = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" } as const;
const box = { x: integer(0, 940), y: integer(0, 520), w: integer(20, 960), h: integer(20, 540) };
const object = <T extends Record<string, unknown>>(properties: T) => ({
  type: "object", additionalProperties: false, required: Object.keys(properties), properties,
});
const textRule = (fonts: readonly string[]) => object({ type: { const: "text" }, ...box,
  text: { type: "string", minLength: 1, maxLength: DECK_IMPORT_LIMITS.text },
  fontSize: integer(12, 160), font: { enum: fonts }, color,
  bold: { type: "boolean" }, italic: { type: "boolean" },
  align: { enum: ["left", "center", "right"] },
});
export const deckImportJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "/deck-import/v1/schema.json",
  $comment: "Schema alone cannot guarantee acceptance. spec.md and the shared validator additionally enforce UTF-16 lengths, valid Unicode, duplicate keys, depth, UTF-8 bytes, coordinate sums and aggregate counts.",
  ...object({
    format: { const: "events-lab-deck" }, version: { const: 1 },
    title: { type: "string", minLength: 1, maxLength: DECK_IMPORT_LIMITS.title },
    slides: { type: "array", minItems: 1, maxItems: DECK_IMPORT_LIMITS.slides, items: object({
      background: color,
      elements: { type: "array", maxItems: DECK_IMPORT_LIMITS.elementsPerSlide, items: { oneOf: [
        textRule(DECK_IMPORT_V1_FONTS),
        object({ type: { const: "image-placeholder" }, ...box }),
      ] } },
    }) },
  }),
};

/** v2 は編集画面が作れる中身をそのまま持てる（AI に直してもらっても元の内容が変わらない。kojira 2026-11-28）。
 * 位置と大きさは小数・スライドの外も可、文字と題名は空も可。回転・グループと文字の装飾は省ける */
const num = (minimum?: number, maximum?: number) => ({
  type: "number", ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }),
} as const);
const v2Object = <R extends Record<string, unknown>, O extends Record<string, unknown>>(required: R, optional: O) => ({
  type: "object", additionalProperties: false, required: Object.keys(required),
  properties: { ...required, ...optional, rotation: num(), group: { type: "string", minLength: 1, maxLength: 64 } },
});
const v2Box = { x: num(), y: num(), w: num(0), h: num(0) };
export const deckImportV2JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "/deck-import/v2/schema.json",
  $comment: "Schema alone cannot guarantee acceptance. spec.md and the shared validator additionally enforce UTF-16 lengths, valid Unicode, URL protocol and credentials, duplicate keys, depth, UTF-8 bytes and aggregate counts.",
  ...object({
    format: { const: "events-lab-deck" }, version: { const: 2 },
    title: { type: "string", minLength: 0, maxLength: DECK_IMPORT_LIMITS.title },
    slides: { type: "array", minItems: 1, maxItems: DECK_IMPORT_LIMITS.slides, items: object({
      background: color,
      elements: { type: "array", maxItems: DECK_IMPORT_LIMITS.elementsPerSlide, items: { oneOf: [
        v2Object({ type: { const: "text" }, ...v2Box, text: { type: "string", minLength: 0, maxLength: DECK_IMPORT_LIMITS.text } }, {
          fontSize: num(0), font: { enum: DECK_IMPORT_FONTS }, color,
          bold: { type: "boolean" }, italic: { type: "boolean" }, align: { enum: ["left", "center", "right"] },
        }),
        v2Object({ type: { const: "image-placeholder" }, ...v2Box }, {}),
        v2Object({ type: { const: "image-url" }, ...v2Box, src: { type: "string", minLength: 1, maxLength: 500 } }, {}),
      ] } },
    }) },
  }),
};
interface Rule {
  type?: string; const?: unknown; enum?: readonly unknown[]; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; pattern?: string; minItems?: number; maxItems?: number;
  items?: Rule; properties?: Record<string, Rule>; required?: string[]; oneOf?: Rule[];
}

export interface DeckImportOptions {
  /** Agent writes (docs/agent-deck-token.md) may reference images already uploaded to
   * their bound deck by the relative path the upload returned. Everything else stays HTTPS-only. */
  uploadedImageSrc?: (src: string) => boolean;
}

export function validateDeckImport(value: unknown, options: DeckImportOptions = {}): DeckImportValidation {
  const schema = value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).version === 2
    ? deckImportV2JsonSchema : deckImportJsonSchema;
  const issues: DeckImportIssue[] = [];
  let truncated = false;
  let elementCount = 0;
  let textCount = 0;
  const issue = (path: string, code: string, message: string) => {
    if (issues.length < DECK_IMPORT_LIMITS.issues) issues.push({ path, code, message });
    else truncated = true;
  };
  function visit(v: unknown, rule: Rule, path: string) {
    if (truncated) return;
    if (rule.oneOf) {
      const type = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>).type : undefined;
      const selected = rule.oneOf.find((r) => r.properties?.type.const === type);
      if (!selected) { issue(path ? `${path}.type` : "type", "invalid_type", schema === deckImportJsonSchema ? "Use text or image-placeholder." : "Use text, image-placeholder or image-url."); return; }
      visit(v, selected, path);
      return;
    }
    if ("const" in rule && v !== rule.const) { issue(path, "invalid_literal", `Must be ${JSON.stringify(rule.const)}.`); return; }
    if (rule.enum && !rule.enum.includes(v)) { issue(path, "invalid_enum", `Use one of: ${rule.enum.join(", ")}.`); return; }
    if (rule.type === "object") {
      if (!v || typeof v !== "object" || Array.isArray(v)) { issue(path, "invalid_type", "Must be an object."); return; }
      const record = v as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        const next = path ? `${path}.${key.slice(0, 80)}` : key.slice(0, 80);
        if (!Object.hasOwn(rule.properties!, key)) issue(next, "unknown_key", "Remove this unknown key (key display limited to 80 UTF-16 units).");
        else visit(record[key], rule.properties![key], next);
        if (truncated) break;
      }
      for (const key of rule.required!) {
        if (!Object.hasOwn(record, key)) issue(path ? `${path}.${key}` : key, "required", "This key is required.");
      }
      // v1 はスライドの内側だけ。v2 はスライドの外にはみ出した位置もそのまま持てる
      if (schema === deckImportJsonSchema && (record.type === "text" || record.type === "image-placeholder")) {
        for (const [origin, size, max] of [["x", "w", 960], ["y", "h", 540]] as const) {
          if (typeof record[origin] === "number" && typeof record[size] === "number" &&
              (record[origin] as number) + (record[size] as number) > max) {
            issue(`${path}.${size}`, "out_of_bounds", `${origin}+${size} must be at most ${max}; reduce the position or size.`);
          }
        }
      }
      return;
    }
    if (rule.type === "array") {
      if (!Array.isArray(v)) { issue(path, "invalid_type", "Must be an array."); return; }
      if (v.length < (rule.minItems ?? 0) || v.length > rule.maxItems!) issue(path, "invalid_count", `Use ${rule.minItems ?? 0}–${rule.maxItems} items.`);
      if (path.endsWith(".elements")) {
        elementCount += v.length;
        if (elementCount > DECK_IMPORT_LIMITS.elements) issue(path, "too_many_elements", "Use at most 1000 elements across all slides.");
      }
      for (let i = 0; i < v.length && !truncated; i++) visit(v[i], rule.items!, `${path}[${i}]`);
      return;
    }
    if (rule.type === "integer") {
      if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) issue(path, "invalid_type", "Must be a finite integer.");
      else if (v < rule.minimum! || v > rule.maximum!) issue(path, "out_of_range", `Use an integer from ${rule.minimum} to ${rule.maximum}.`);
    } else if (rule.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) issue(path, "invalid_type", "Must be a finite number.");
      else if ((rule.minimum !== undefined && v < rule.minimum) || (rule.maximum !== undefined && v > rule.maximum)) {
        issue(path, "out_of_range", rule.maximum === undefined ? `Use a number of at least ${rule.minimum}.` : `Use a number from ${rule.minimum} to ${rule.maximum}.`);
      }
    } else if (rule.type === "boolean" && typeof v !== "boolean") issue(path, "invalid_type", "Must be true or false, not a string.");
    else if (rule.type === "string") {
      if (path.endsWith(".src")) {
        if (typeof v === "string" && options.uploadedImageSrc?.(v)) return;
        let valid = typeof v === "string" && v.length > 0 && v.length <= 500 && !hasLoneSurrogate(v) && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
        if (valid) {
          try {
            const url = new URL(v as string);
            valid = url.protocol === "https:" && url.username === "" && url.password === "";
          } catch { valid = false; }
        }
        if (!valid) issue(path, "invalid_image_url", "Use an absolute HTTPS image URL of at most 500 UTF-16 units without controls or credentials.");
        return;
      }
      if (typeof v !== "string") { issue(path, "invalid_type", "Must be a string."); return; }
      if (hasLoneSurrogate(v)) issue(path, "invalid_unicode", "Use valid Unicode without lone surrogates.");
      if (v.length < (rule.minLength ?? 0) || v.length > (rule.maxLength ?? Infinity)) issue(path, "invalid_length", `Use ${rule.minLength}–${rule.maxLength} UTF-16 units.`);
      if (rule.pattern && !new RegExp(rule.pattern).test(v)) issue(path, "invalid_color", "Use a six-digit RGB color, for example #172B24.");
      if (path === "title") {
        if (v !== v.trim() || /[\u0000-\u001f\u007f]/.test(v)) issue(path, "invalid_title", "Remove leading/trailing whitespace and control characters.");
      } else if (path.endsWith(".text")) {
        // v2 は編集画面で打てる文字をそのまま持つ（制御文字も JSON のエスケープで運べる）
        if (schema === deckImportJsonSchema && /[\u0000-\u0009\u000b-\u001f\u007f]/.test(v)) issue(path, "invalid_text", "Only LF is allowed among control characters.");
        textCount += v.length;
        if (textCount > DECK_IMPORT_LIMITS.totalText) issue(path, "too_much_text", "Use at most 100000 UTF-16 units across all text.");
      }
    }
  }
  visit(value, schema as Rule, "");
  return issues.length ? { ok: false, issues, truncated } : { ok: true, value: value as DeckImport };
}

export function parseDeckImport(input: string | Uint8Array, options: DeckImportOptions = {}): DeckImportValidation {
  return validateDeckImport(parseDeckImportJson(input), options);
}

export type DeckImportIdFactory = (kind: "slide" | "element", slideIndex: number, elementIndex?: number) => string;
export const previewDeckImportId: DeckImportIdFactory = (kind, slide, element) =>
  kind === "slide" ? `preview-slide-${slide + 1}` : `preview-element-${slide + 1}-${element! + 1}`;

/** Only validated inputs belong here. Project each version's allowed fields explicitly. */
export function convertDeckImport(input: DeckImport, id: DeckImportIdFactory): { title: string; content: DeckContent } {
  const content: DeckContent = { slides: input.slides.map((slide, si) => ({
    id: id("slide", si), background: slide.background,
    elements: slide.elements.map((el, ei): DeckElement => {
      const base = { id: id("element", si, ei), x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation ?? 0,
        ...(el.group === undefined ? {} : { groupId: el.group }) };
      if (el.type === "image-placeholder") return { ...base, type: "image" };
      if (el.type === "image-url") return { ...base, type: "image", src: el.src };
      // v2 で省いた装飾は省いたまま（表示の既定）。書き出しも元に無いものは書かない
      const text: DeckElement = { ...base, type: "text", text: el.text };
      if (el.fontSize !== undefined) text.fontSize = el.fontSize;
      if (el.font !== undefined) text.fontFamily = el.font === "default" ? "" : el.font;
      if (el.color !== undefined) text.color = el.color;
      if (el.bold !== undefined) text.bold = el.bold;
      if (el.italic !== undefined) text.italic = el.italic;
      if (el.align !== undefined) text.align = el.align;
      return text;
    }),
  })) };
  return { title: input.title, content: deckContentSchema.parse(content) };
}
