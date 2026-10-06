import { CARD_DESIGN_HEIGHT, CARD_DESIGN_WIDTH, type CardPattern, type CardPatternKey, type CardPatternPaper, type CardPatternTheme } from "@eventer/shared";
import { ARC_CIRCLES, FLOW_BAND, FLOW_LINES, ROSETTE_CURVES, ROSETTE_WAVES, TOPO_CONTOURS } from "./patternData.js";
import { BG_VARIANTS, CARD_THEMES, themedPatternColor, type CardBgVariant, type CardTheme } from "./cardTheme.js";
import { cardLook, DEFAULT_CARD_LOOK } from "./cardLook.js";
import { builtinBackgroundNodes, legibleStroke, mixColor, NAME_CARD_TEXT_COLORS, nodeMarkup, type BgNode, type BuiltinBackgroundPalette } from "./builtinBackgrounds.js";

/** The background one name card actually draws once the design's pattern mode is applied to its owner. */
export interface ResolvedCardPattern {
  key: CardPatternKey;
  palette: CardPatternTheme;
  strength: number;
  paper: CardPatternPaper;
}

/** license-* keys draw the license-card pattern (CardDecor's BackgroundPattern data); the rest are generated guilloché backgrounds. */
export function licenseVariantOf(key: CardPatternKey): CardBgVariant | null {
  return key.startsWith("license-") ? key.slice(8) as CardBgVariant : null;
}

/** participant mode follows the owner's saved license-card look (cardImageKey "variant-theme");
 * owners who never saved one get the design's fallback, never the printing device's local default. */
export function resolveCardPattern(pattern: CardPattern | undefined, cardImageKey: string | null | undefined): ResolvedCardPattern | null {
  if (!pattern) return null;
  const { strength, paper } = pattern;
  if (pattern.type === "builtin") return { key: pattern.key, palette: pattern.palette, strength, paper };
  const variant = (cardImageKey ?? "").split("-")[0];
  if (!BG_VARIANTS.some(v => v.key === variant))
    return { key: pattern.fallback.key, palette: pattern.fallback.palette, strength, paper };
  const look = cardLook(cardImageKey, DEFAULT_CARD_LOOK);
  return { key: `license-${look.variant}`, palette: look.theme, strength, paper };
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

const themeOf = (palette: CardPatternTheme): CardTheme => CARD_THEMES.find(t => t.key === palette) ?? CARD_THEMES[0];

/** The license-card pattern on white for a name card (paper "none"): the same data and colours as BackgroundPattern, with the
 * rosette loop drawn once and the faint patterns boosted so they read without the paper. */
function licenseNodesOnWhite(variant: CardBgVariant, palette: CardPatternTheme, strength: number): BgNode[] {
  const theme = themeOf(palette);
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

/** The license-card pattern as BackgroundPattern draws it on the license card (paper "card"): same colours, element opacities and
 * order, no on-white boost. The rosette curves are drawn once per loop: identical at 2x and in print, and at 1x Chromium would
 * otherwise stack the repeated hairline loops into near-solid lines under the text. strength scales each opacity. */
function licenseNodesOnPaper(variant: CardBgVariant, palette: CardPatternTheme, strength: number): BgNode[] {
  const theme = themeOf(palette);
  const opacity = (o: number) => Math.round(o * strength * 10000) / 10000;
  const groups = { rosette: [ROSETTE_WAVES, ROSETTE_CURVES], topo: [TOPO_CONTOURS], arcs: [], flow: [FLOW_LINES] }[variant];
  const nodes: BgNode[] = [];
  for (const group of groups) for (const p of group) nodes.push({ tag: "path", attrs: {
    d: group === ROSETTE_CURVES ? firstLoop(p.d) : p.d, fill: "none",
    stroke: themedPatternColor(p.stroke, theme), "stroke-width": p.strokeWidth, opacity: opacity(p.opacity) } });
  if (variant === "arcs") for (const c of ARC_CIRCLES) nodes.push({ tag: "circle", attrs: {
    cx: c.cx, cy: c.cy, r: c.r, fill: "none", stroke: theme.accentA, "stroke-width": c.strokeWidth, opacity: opacity(c.opacity) } });
  if (variant === "flow") nodes.push({ tag: "path", attrs: {
    d: FLOW_BAND.d, fill: themedPatternColor(FLOW_BAND.fill, theme), opacity: opacity(FLOW_BAND.opacity) } });
  return nodes;
}

/** How far the paper departs from white at a strength: 1 is the license card's paper, 0.4 keeps only 40% of its tint. */
export const paperDeparture = (strength: number) => strength;
/** The paper colours at a strength (the license card's three gradient stops, pulled towards white). */
export function paperStops(palette: CardPatternTheme, strength: number): [string, string, string] {
  const t = paperDeparture(strength);
  return themeOf(palette).paper.map(c => mixColor("#FFFFFF", c, t)) as [string, string, string];
}
/** The darkest paper colour at a strength, the one the guilloché lines are laid onto and kept readable against. */
function darkestPaper(palette: CardPatternTheme, strength: number): string {
  const sum = (hex: string) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0);
  return paperStops(palette, strength).sort((a, b) => sum(a) - sum(b))[0]!;
}

/** The license card's paper: the theme gradient and the sheen (LicenseCardSvg's lc-bg / lc-sheen), with their own ids under idPrefix.
 * Built per card (it is a handful of elements) so ids never collide when many cards share a sheet. */
function paperNodes(palette: CardPatternTheme, strength: number, idPrefix: string): { defs: BgNode; under: BgNode; over: BgNode } {
  const [a, b, c] = paperStops(palette, strength);
  const bg = `${idPrefix}-paper`, sheen = `${idPrefix}-sheen`;
  const stop = (offset: number, color: string, opacity?: number): BgNode => ({ tag: "stop", attrs: opacity === undefined
    ? { offset, "stop-color": color } : { offset, "stop-color": color, "stop-opacity": opacity } });
  const full = { x: 0, y: 0, width: CARD_DESIGN_WIDTH, height: CARD_DESIGN_HEIGHT };
  return {
    defs: { tag: "defs", attrs: {}, children: [
      { tag: "linearGradient", attrs: { id: bg, x1: 0, y1: 0, x2: 1, y2: 1 }, children: [stop(0, a), stop(0.5, b), stop(1, c)] },
      { tag: "linearGradient", attrs: { id: sheen, x1: 0, y1: 1, x2: 1, y2: 0 }, children: [
        stop(0.3, "#FFFFFF", 0), stop(0.46, "#B7C4FF", 0.2), stop(0.54, "#9BE8DE", 0.16), stop(0.7, "#FFFFFF", 0)] },
    ] },
    under: { tag: "rect", attrs: { ...full, fill: `url(#${bg})` } },
    over: { tag: "rect", attrs: { ...full, fill: `url(#${sheen})`, opacity: Math.round(0.16 * paperDeparture(strength) * 10000) / 10000 } },
  };
}

/** The element tree for one resolved pattern. Guilloché generation is memoised per (key, palette, strength, paper) in
 * builtinBackgroundNodes. Paper "card" adds gradient ids under idPrefix, so give each card on a page its own prefix. */
export function cardPatternNodes(pattern: ResolvedCardPattern, idPrefix = "card-bg"): BgNode[] {
  const variant = licenseVariantOf(pattern.key);
  if (pattern.paper === "none") return variant ? licenseNodesOnWhite(variant, pattern.palette, pattern.strength)
    : builtinBackgroundNodes(pattern.key, pattern.palette, "bg", pattern.strength);
  const paper = paperNodes(pattern.palette, pattern.strength, idPrefix);
  const lines = variant ? licenseNodesOnPaper(variant, pattern.palette, pattern.strength)
    : builtinBackgroundNodes(pattern.key, pattern.palette, "bg", pattern.strength, darkestPaper(pattern.palette, pattern.strength));
  return [paper.defs, paper.under, ...lines, paper.over];
}

/** Stand-alone SVG markup for thumbnails and size checks. */
export function cardPatternMarkup(pattern: ResolvedCardPattern): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_DESIGN_WIDTH} ${CARD_DESIGN_HEIGHT}" width="${CARD_DESIGN_WIDTH}" height="${CARD_DESIGN_HEIGHT}">${
    cardPatternNodes(pattern).map(nodeMarkup).join("")}</svg>`;
}
