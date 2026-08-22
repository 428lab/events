/** タイムテーブルのトラック色 (#338)。
 *
 * テーマの primary と secondary を **色相でつないだ** 中間色を使う。
 * RGB で混ぜると中間が濁った灰色寄りになり、無彩色で描く「全トラック共通」の
 * 帯と見分けがつかなくなる。色そのものは各テーマのトークンから導くので、
 * ここに具体的な色は書かない。
 *
 * 色の差はトラックが増えるほど詰まる。5本を超えると隣どうしの区別は
 * ほとんど付かないので、**色は補助・見出しが主** という前提で使うこと。 */

import { publicTracks } from "@eventer/shared";
import type { ScheduleVisibility } from "@eventer/shared";

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

/** トラックの並びと同じ長さの色。**スタッフ用の列は色を持たない (`null`)** (#383)。
 *
 * 色は**公開トラックの本数だけ**で作る。スタッフ用トラックを本数に混ぜると、
 * 同じトラックが参加者の画面と運営の画面で別の色になる（スタッフ用トラックは
 * 参加者には返らないので本数が食い違う）。会場で「青の列」と口頭で伝えている
 * 運営がそれで壊れるので、**裏方を足しても表の色は動かさない**。
 *
 * `null` の列はトラック色を一切使わず、無彩色＋斜線で描く（呼ぶ側の仕事）。
 * 「どれか1本のトラックの色」と読み違えられないようにするため、
 * 全トラック共通の帯と同じ描き方に寄せてある。 */
export function trackColorsForTracks(
  primary: string,
  secondary: string,
  tracks: Array<{ visibility: ScheduleVisibility }>,
): Array<string | null> {
  // 「表の列」の判定は @eventer/shared の publicTracks が1か所で持つ（許可リスト）
  const count = publicTracks(tracks).length;
  const colors = trackColors(primary, secondary, count);
  let at = 0;
  // 配る側も同じ判定で書く。ここだけ拒否リストにすると、将来値が増えたときに
  // 新しい値の列が色を1本取り、公開トラックの色が1つずつ後ろへずれる
  return tracks.map((track) =>
    track.visibility === "public" ? (colors[at++] ?? null) : null,
  );
}
