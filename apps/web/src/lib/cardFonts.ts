import { DISPLAY_FONTS, type CardFont } from "@eventer/shared";
import { FONT_SANS } from "../components/licenseCard/cardTheme.js";

export type CardFontStatus = "loading" | "ready" | "error";
export function cardFontSpec(font: CardFont | undefined, bold: boolean) {
  const index = DISPLAY_FONTS.findIndex(f => f.family === font);
  if (index < 0) return { family: FONT_SANS, weight: bold ? 700 : 400, alias: null };
  const def = DISPLAY_FONTS[index]!;
  // Isolate these full-range faces from the image studio's text-limited faces.
  const alias = `EventCardFont${index}`;
  return { family: `"${alias}", ${FONT_SANS}`, alias,
    weight: bold ? def.weight : 400 };
}
export function cardFontCssUrl(font: CardFont): string {
  const def = DISPLAY_FONTS.find(f => f.family === font);
  if (!def) throw new Error("unknown_card_font");
  const weights = def.weight === 400 ? "400" : `400;${def.weight}`;
  // Never put participant text in Google's `text=` parameter.
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(def.family)}:wght@${weights}&display=swap`;
}

interface FaceDefinition { source: string; descriptors: FontFaceDescriptors }
/** Import only font-face descriptors, never arbitrary CSS rules or third-party origins. */
export function parseCardFontCss(css: string): FaceDefinition[] {
  if (css.length > 512 * 1024) throw new Error("font_css_too_large");
  const faces: FaceDefinition[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const properties = block[1]!;
    const rawUrl = /url\(([^)]+)\)/.exec(properties)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    if (!rawUrl) throw new Error("invalid_font_source");
    const url = new URL(rawUrl);
    if (url.origin !== "https://fonts.gstatic.com" || url.username || url.password)
      throw new Error("invalid_font_origin");
    const weight = /font-weight:\s*([\d ]+)\s*;/.exec(properties)?.[1]?.trim() ?? "400";
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(properties)?.[1]?.trim();
    faces.push({ source: `url(${JSON.stringify(url.href)})`, descriptors: {
      weight, style: "normal", display: "swap", ...(unicodeRange ? { unicodeRange } : {}),
    } });
  }
  if (!faces.length || faces.length > 512) throw new Error("missing_font_faces");
  return faces;
}

const registered = new Map<CardFont, Promise<void>>();
async function registerFont(font: CardFont): Promise<void> {
  const existing = registered.get(font); if (existing) return existing;
  const load = (async () => {
    const response = await fetch(cardFontCssUrl(font), { credentials: "omit", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("font_css_failed");
    const definitions = parseCardFontCss(await response.text());
    const alias = cardFontSpec(font, false).alias!;
    const faces = definitions.map(d => new FontFace(alias, d.source, d.descriptors));
    // Adding faces does not fetch every subset: FontFaceSet.load chooses matching ranges.
    for (const face of faces) document.fonts.add(face);
  })();
  registered.set(font, load);
  try { await load; } catch (error) { registered.delete(font); throw error; }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("font_load_timeout")), milliseconds);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
  });
}
export async function loadCardFont(font: CardFont | undefined, bold: boolean, text: string): Promise<void> {
  if (!font || font === "default" || !text.trim()) return;
  await registerFont(font);
  const spec = cardFontSpec(font, bold);
  // The text argument is local range selection in the browser, not an HTTP query.
  await withTimeout(document.fonts.load(`${spec.weight} 64px "${spec.alias}"`, text), 15000);
}
