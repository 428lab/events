import { CARD_DESIGN_HEIGHT, CARD_DESIGN_WIDTH, type CardPattern, type CardPatternKey, type CardPatternTheme } from "@eventer/shared";
import { ARC_CIRCLES, FLOW_BAND, FLOW_LINES, ROSETTE_CURVES, ROSETTE_WAVES, TOPO_CONTOURS } from "./patternData.js";
import { BG_VARIANTS, CARD_THEMES, themedPatternColor, type CardBgVariant } from "./cardTheme.js";
import { cardLook, DEFAULT_CARD_LOOK } from "./cardLook.js";
import { builtinBackgroundNodes, legibleStroke, mixColor, NAME_CARD_TEXT_COLORS, nodeMarkup, type BgNode, type BuiltinBackgroundPalette } from "./builtinBackgrounds.js";

/** The background one name card actually draws once the design's pattern mode is applied to its owner. */
export interface ResolvedCardPattern {
  key: CardPatternKey;
  palette: CardPatternTheme;
  strength: number;
}

/** license-* keys draw the license-card pattern (CardDecor's BackgroundPattern data) on white; the rest are generated guilloché backgrounds. */
export function licenseVariantOf(key: CardPatternKey): CardBgVariant | null {
  return key.startsWith("license-") ? key.slice(8) as CardBgVariant : null;
}

/** participant mode follows the owner's saved license-card look (cardImageKey "variant-theme");
 * owners who never saved one get the design's fallback, never the printing device's local default. */
export function resolveCardPattern(pattern: CardPattern | undefined, cardImageKey: string | null | undefined): ResolvedCardPattern | null {
  if (!pattern) return null;
  if (pattern.type === "builtin") return { key: pattern.key, palette: pattern.palette, strength: pattern.strength };
  const variant = (cardImageKey ?? "").split("-")[0];
  if (!BG_VARIANTS.some(v => v.key === variant))
    return { key: pattern.fallback.key, palette: pattern.fallback.palette, strength: pattern.strength };
  const look = cardLook(cardImageKey, DEFAULT_CARD_LOOK);
  return { key: `license-${look.variant}`, palette: look.theme, strength: pattern.strength };
}

const LEGIBLE_ON_WHITE: BuiltinBackgroundPalette = {
  key: "name-card", nameJa: "", nameEn: "", base: "#FFFFFF", colors: [],
  ink: NAME_CARD_TEXT_COLORS[0], inkSub: NAME_CARD_TEXT_COLORS[1], accent: NAME_CARD_TEXT_COLORS[2], onAccent: "#FFFFFF", // legibleStroke adds the rest
};
/** topo / arcs / flow lines are tuned for the license card's grey paper and nearly vanish on white; on name cards they are
 * drawn this much stronger (capped) so every license pattern carries about as much ink as the guilloché backgrounds. */
const ON_WHITE_BOOST = 2.5;
const ON_WHITE_MAX = 0.4;
/** The rosette curves in patternData repeat the same closed loop dozens of times; drawn once per loop they look the same
 * on the license card but do not stack into solid lines. Returns the path cut after its first full loop. */
export function firstLoop(d: string): string {
  const parts = d.trim().split(" ");
  const start = parts[0]!.slice(1);
  const end = parts.findIndex((t, i) => i > 0 && t.slice(1) === start);
  return end < 0 ? d : parts.slice(0, end + 1).join(" ");
}
/** A translucent line flattened onto white (opaque, so crossings never darken), lightened if it would crowd the text,
 * then lightened by strength. */
const onWhite = (color: string, opacity: number, strength: number) =>
  mixColor("#FFFFFF", legibleStroke(LEGIBLE_ON_WHITE, mixColor("#FFFFFF", color, opacity)), strength);

/** The license-card pattern on white for a name card: the same data and colours as BackgroundPattern (the license card itself
 * is untouched), without the paper gradient or sheen. */
function licenseNodes(variant: CardBgVariant, palette: CardPatternTheme, strength: number): BgNode[] {
  const theme = CARD_THEMES.find(t => t.key === palette) ?? CARD_THEMES[0];
  const boost = (opacity: number) => variant === "rosette" ? opacity : Math.min(ON_WHITE_MAX, opacity * ON_WHITE_BOOST);
  const groups = { rosette: [ROSETTE_WAVES, ROSETTE_CURVES], topo: [TOPO_CONTOURS], arcs: [], flow: [FLOW_LINES] }[variant];
  const nodes: BgNode[] = [{ tag: "rect", attrs: { x: 0, y: 0, width: CARD_DESIGN_WIDTH, height: CARD_DESIGN_HEIGHT, fill: "#FFFFFF" } }];
  if (variant === "flow") nodes.push({ tag: "path", attrs: {
    d: FLOW_BAND.d, fill: mixColor("#FFFFFF", themedPatternColor(FLOW_BAND.fill, theme), FLOW_BAND.opacity * strength) } });
  for (const group of groups) for (const p of group) nodes.push({ tag: "path", attrs: {
    d: group === ROSETTE_CURVES ? firstLoop(p.d) : p.d, fill: "none",
    stroke: onWhite(themedPatternColor(p.stroke, theme), boost(p.opacity), strength), "stroke-width": p.strokeWidth } });
  if (variant === "arcs") for (const c of ARC_CIRCLES) nodes.push({ tag: "circle", attrs: {
    cx: c.cx, cy: c.cy, r: c.r, fill: "none", stroke: onWhite(theme.accentA, boost(c.opacity), strength), "stroke-width": c.strokeWidth } });
  return nodes;
}

/** The element tree for one resolved pattern. Guilloché generation is memoised per (key, palette, strength) in builtinBackgroundNodes. */
export function cardPatternNodes(pattern: ResolvedCardPattern): BgNode[] {
  const variant = licenseVariantOf(pattern.key);
  return variant ? licenseNodes(variant, pattern.palette, pattern.strength)
    : builtinBackgroundNodes(pattern.key, pattern.palette, "bg", pattern.strength);
}

/** Stand-alone SVG markup for thumbnails and size checks. */
export function cardPatternMarkup(pattern: ResolvedCardPattern): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_DESIGN_WIDTH} ${CARD_DESIGN_HEIGHT}" width="${CARD_DESIGN_WIDTH}" height="${CARD_DESIGN_HEIGHT}">${
    cardPatternNodes(pattern).map(nodeMarkup).join("")}</svg>`;
}
