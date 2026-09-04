/** カードに刷る文字を枠に収めるための見積り (#178)。
 *
 * SVG では文字の実寸を測れないので、字種から幅を見積もってフォントサイズを決める。
 * 表示名・ハンドル・コミュニティ名の3か所が同じ見積りをしていたので1つに寄せた (#466)。
 * 3か所で別々に書いていると、片方だけ係数を直したときに揃わなくなる。 */

/** 1文字あたりの幅（em）。CJK ≒ 1.0em / 欧文 ≒ 0.62em */
export function charUnits(ch: string): number {
  return /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.62;
}

/** 文字列の幅（em）。サロゲートペアを1文字として数えるため [...s] で回す */
export function textUnits(s: string): number {
  return [...s].reduce((acc, ch) => acc + charUnits(ch), 0);
}

/**
 * `availW` に収まる字送りを返す。
 *
 * `textLength` はレンダラによって無視されるため使わない。
 * 安全係数 0.94 を掛けたサイズ計算だけで必ず枠内に収め、
 * `min` まで縮めても収まらない場合はそこで止める（読めない大きさにしない）。
 */
export function fitFontSize(
  availW: number,
  units: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, Math.floor((availW / Math.max(units, 1)) * 0.94)),
  );
}
