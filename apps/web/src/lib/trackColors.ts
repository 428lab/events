/** タイムテーブルのトラック色 (#338)。
 *
 * テーマの primary と secondary を **色相でつないだ** 中間色を使う。
 * RGB で混ぜると中間が濁った灰色寄りになり、無彩色で描く「全トラック共通」の
 * 帯と見分けがつかなくなる。色そのものは各テーマのトークンから導くので、
 * ここに具体的な色は書かない。
 *
 * 色の差はトラックが増えるほど詰まる。5本を超えると隣どうしの区別は
 * ほとんど付かないので、**色は補助・見出しが主** という前提で使うこと。 */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** "#RRGGBB" / "#RGB" → HSL。読めない値は無彩色として返す */
export function hexToHsl(hex: string): Hsl {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { h: 0, s: 0, l: 50 };
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: hue, s: s * 100, l: l * 100 };
}

/** トラックの本数ぶんの色を作る。
 * 1本なら primary そのもの、2本以上は primary から secondary へ等間隔に並べる。
 * 色相は近いほうの回り（172°→27° は下り、330°→38° は 360 をまたぐ）で回す。 */
export function trackColors(
  primary: string,
  secondary: string,
  count: number,
): string[] {
  if (count <= 0) return [];
  const a = hexToHsl(primary);
  const b = hexToHsl(secondary);
  // 色相環の近いほう。180°より遠ければ反対回りにする
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const h = ((a.h + dh * t) % 360 + 360) % 360;
    const s = a.s + (b.s - a.s) * t;
    const l = a.l + (b.l - a.l) * t;
    // カンマ区切りで書く。MUI の alpha() が読める形はこちらだけ
    out.push(`hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`);
  }
  return out;
}
