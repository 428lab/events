import { deckContentSchema, type DeckContent, type DeckElement } from "./decks.js";
import { DECK_IMPORT_MAX_BYTES, hasLoneSurrogate, parseDeckImportJson } from "./deckImportJson.js";
export * from "./deckImportJson.js";

export const DECK_IMPORT_LIMITS = {
  slides: 60, elementsPerSlide: 50, elements: 1000, text: 10000, totalText: 100000,
  title: 120, issues: 50, bytes: DECK_IMPORT_MAX_BYTES,
} as const;
export const DECK_IMPORT_FONTS = ["default", "serif", "monospace"] as const;
export type DeckImportFont = typeof DECK_IMPORT_FONTS[number];
interface ImportBox { x: number; y: number; w: number; h: number }
export interface DeckImportText extends ImportBox {
  type: "text"; text: string; fontSize: number; font: DeckImportFont; color: string;
  bold: boolean; italic: boolean; align: "left" | "center" | "right";
}
export interface DeckImportPlaceholder extends ImportBox { type: "image-placeholder" }
export interface DeckImportV1 {
  format: "events-lab-deck"; version: 1; title: string;
  slides: { background: string; elements: (DeckImportText | DeckImportPlaceholder)[] }[];
}
export interface DeckImportIssue { path: string; code: string; message: string; example?: string }
export type DeckImportValidation =
  | { ok: true; value: DeckImportV1 }
  | { ok: false; issues: DeckImportIssue[]; truncated: boolean };

/** Public schema is also the structural definition used by the strict validator.
 * JSON Schema string lengths count code points; our runtime counts UTF-16 instead.
 */
const integer = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum } as const);
const color = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" } as const;
const box = { x: integer(0, 940), y: integer(0, 520), w: integer(20, 960), h: integer(20, 540) };
const object = (properties: Record<string, unknown>) => ({
  type: "object", additionalProperties: false, required: Object.keys(properties), properties,
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
        object({ type: { const: "text" }, ...box,
          text: { type: "string", minLength: 1, maxLength: DECK_IMPORT_LIMITS.text },
          fontSize: integer(12, 160), font: { enum: DECK_IMPORT_FONTS }, color,
          bold: { type: "boolean" }, italic: { type: "boolean" },
          align: { enum: ["left", "center", "right"] },
        }),
        object({ type: { const: "image-placeholder" }, ...box }),
      ] } },
    }) },
  }),
};
interface Rule {
  type?: string; const?: unknown; enum?: readonly unknown[]; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; pattern?: string; minItems?: number; maxItems?: number;
  items?: Rule; properties?: Record<string, Rule>; required?: string[]; oneOf?: Rule[];
}

export function validateDeckImport(value: unknown): DeckImportValidation {
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
      if (!selected) { issue(path ? `${path}.type` : "type", "invalid_type", "Use text or image-placeholder."); return; }
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
      if (record.type === "text" || record.type === "image-placeholder") {
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
    } else if (rule.type === "boolean" && typeof v !== "boolean") issue(path, "invalid_type", "Must be true or false, not a string.");
    else if (rule.type === "string") {
      if (typeof v !== "string") { issue(path, "invalid_type", "Must be a string."); return; }
      if (hasLoneSurrogate(v)) issue(path, "invalid_unicode", "Use valid Unicode without lone surrogates.");
      if (v.length < (rule.minLength ?? 0) || v.length > (rule.maxLength ?? Infinity)) issue(path, "invalid_length", `Use ${rule.minLength}–${rule.maxLength} UTF-16 units.`);
      if (rule.pattern && !new RegExp(rule.pattern).test(v)) issue(path, "invalid_color", "Use a six-digit RGB color, for example #172B24.");
      if (path === "title") {
        if (v !== v.trim() || /[\u0000-\u001f\u007f]/.test(v)) issue(path, "invalid_title", "Remove leading/trailing whitespace and control characters.");
      } else if (path.endsWith(".text")) {
        if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(v)) issue(path, "invalid_text", "Only LF is allowed among control characters.");
        textCount += v.length;
        if (textCount > DECK_IMPORT_LIMITS.totalText) issue(path, "too_much_text", "Use at most 100000 UTF-16 units across all text.");
      }
    }
  }
  visit(value, deckImportJsonSchema as Rule, "");
  return issues.length ? { ok: false, issues, truncated } : { ok: true, value: value as DeckImportV1 };
}

export function parseDeckImport(input: string | Uint8Array): DeckImportValidation {
  return validateDeckImport(parseDeckImportJson(input));
}

export type DeckImportIdFactory = (kind: "slide" | "element", slideIndex: number, elementIndex?: number) => string;
export const previewDeckImportId: DeckImportIdFactory = (kind, slide, element) =>
  kind === "slide" ? `preview-slide-${slide + 1}` : `preview-element-${slide + 1}-${element! + 1}`;

/** Only validated v1 inputs belong here. Explicit projection keeps all external asset fields absent. */
export function convertDeckImport(input: DeckImportV1, id: DeckImportIdFactory): { title: string; content: DeckContent } {
  const content: DeckContent = { slides: input.slides.map((slide, si) => ({
    id: id("slide", si), background: slide.background,
    elements: slide.elements.map((el, ei): DeckElement => {
      const base = { id: id("element", si, ei), x: el.x, y: el.y, w: el.w, h: el.h, rotation: 0 };
      if (el.type === "image-placeholder") return { ...base, type: "image" };
      return { ...base, type: "text", text: el.text, fontSize: el.fontSize,
        fontFamily: el.font === "default" ? "" : el.font, color: el.color,
        bold: el.bold, italic: el.italic, align: el.align };
    }),
  })) };
  return { title: input.title, content: deckContentSchema.parse(content) };
}
