import { CARD_DESIGN_HEIGHT, CARD_DESIGN_WIDTH, type CardPattern, type CardPatternKey, type CardPatternTheme } from "@eventer/shared";
import { ARC_CIRCLES, FLOW_BAND, FLOW_LINES, ROSETTE_CURVES, ROSETTE_WAVES, TOPO_CONTOURS } from "./patternData.js";
import { BG_VARIANTS, CARD_THEMES, themedPatternColor, type CardBgVariant } from "./cardTheme.js";
import { cardLook, DEFAULT_CARD_LOOK } from "./cardLook.js";
import { builtinBackgroundNodes, nodeMarkup, type BgNode } from "./builtinBackgrounds.js";

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

/** The license-card pattern lines on white: the same data and colours as BackgroundPattern, without the paper gradient or sheen,
 * with strength scaling every line's opacity. */
function licenseNodes(variant: CardBgVariant, palette: CardPatternTheme, strength: number): BgNode[] {
  const theme = CARD_THEMES.find(t => t.key === palette) ?? CARD_THEMES[0];
  const groups = { rosette: [ROSETTE_WAVES, ROSETTE_CURVES], topo: [TOPO_CONTOURS], arcs: [], flow: [FLOW_LINES] }[variant];
  const nodes: BgNode[] = [{ tag: "rect", attrs: { x: 0, y: 0, width: CARD_DESIGN_WIDTH, height: CARD_DESIGN_HEIGHT, fill: "#FFFFFF" } }];
  for (const group of groups) for (const p of group) nodes.push({ tag: "path", attrs: {
    d: p.d, fill: "none", stroke: themedPatternColor(p.stroke, theme), "stroke-width": p.strokeWidth, opacity: p.opacity * strength } });
  if (variant === "arcs") for (const c of ARC_CIRCLES) nodes.push({ tag: "circle", attrs: {
    cx: c.cx, cy: c.cy, r: c.r, fill: "none", stroke: theme.accentA, "stroke-width": c.strokeWidth, opacity: c.opacity * strength } });
  if (variant === "flow") nodes.push({ tag: "path", attrs: {
    d: FLOW_BAND.d, fill: themedPatternColor(FLOW_BAND.fill, theme), opacity: FLOW_BAND.opacity * strength } });
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
