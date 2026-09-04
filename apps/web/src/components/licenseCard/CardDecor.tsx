/** カードの装飾レイヤー (#178)。
 *
 * ロゴグリフと背景パターン。どちらもカードのデータを一切見ず、
 * 色とパターン種別だけで決まるので、カード本体の絵から切り出してある (#466)。 */
import {
  ARC_CIRCLES,
  FLOW_BAND,
  FLOW_LINES,
  ROSETTE_CURVES,
  ROSETTE_WAVES,
  TOPO_CONTOURS,
  type PatternStroke,
} from "./patternData.js";
import {
  themedPatternColor,
  type CardBgVariant,
  type CardTheme,
} from "./cardTheme.js";

/** ロゴグリフ（ヘッダー・ウォーターマーク共用）。64x64グリッドの座標系 */
export function LogoGlyph({ color }: { color: string }) {
  return (
    <>
      <g fill={color}>
        <circle cx={32} cy={14.5} r={1.6} />
        <polygon points="32,15 11,30 53,30" />
        <circle cx={24} cy={35.5} r={2.4} />
        <circle cx={32} cy={35.5} r={2.4} />
        <circle cx={40} cy={35.5} r={2.4} />
      </g>
      <path
        d="M24 41 L40 41 L44 54 L20 54 Z"
        fill="none"
        stroke={color}
        strokeWidth={2.4}
      />
    </>
  );
}

/** 変種ごとの線パターン。4種のうち3種は「同じ <path> を配列の数だけ描く」だけで、
 * 違うのは束ねる配列と、arcs の円・flow の帯という2つの例外にすぎない。
 * 以前は変種ごとに同じ <path> を書き写した4分岐だったので、表と1つの map に畳んだ (#466) */
const STROKE_GROUPS: Record<
  CardBgVariant,
  readonly (readonly PatternStroke[])[]
> = {
  rosette: [ROSETTE_WAVES, ROSETTE_CURVES],
  topo: [TOPO_CONTOURS],
  /** arcs は線ではなく円（下の例外で描く） */
  arcs: [],
  flow: [FLOW_LINES],
};

/** 背景パターン（4種）。パスデータはモックアップからの逐語移植。
 * 色のみ描画時にテーマへ写像する（themedPatternColor） */
export function BackgroundPattern({
  variant,
  theme,
}: {
  variant: CardBgVariant;
  theme: CardTheme;
}) {
  return (
    <>
      {STROKE_GROUPS[variant].map((group, gi) =>
        group.map((p, i) => (
          <path
            key={`${gi}-${i}`}
            d={p.d}
            fill="none"
            stroke={themedPatternColor(p.stroke, theme)}
            strokeWidth={p.strokeWidth}
            opacity={p.opacity}
          />
        )),
      )}
      {variant === "arcs" &&
        ARC_CIRCLES.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill="none"
            stroke={theme.accentA}
            strokeWidth={c.strokeWidth}
            opacity={c.opacity}
          />
        ))}
      {variant === "flow" && (
        <path
          d={FLOW_BAND.d}
          fill={themedPatternColor(FLOW_BAND.fill, theme)}
          opacity={FLOW_BAND.opacity}
        />
      )}
    </>
  );
}
