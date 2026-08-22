import { describe, expect, it } from "vitest";
import {
  hexToHsl,
  trackColors,
  trackColorsForTracks,
} from "./trackColors.js";

/**
 * トラック色 (#338)。テーマの primary と secondary を色相でつないだ中間色を使う。
 * ここに具体的な色を書かない（テーマを増やしても勝手に付いてくる）ことと、
 * 中間が濁って「全トラック共通」の無彩色の帯と紛れないことを確かめる。
 */

/** "hsl(h, s%, l%)" を数値に戻す */
function parse(css: string): { h: number; s: number; l: number } {
  const m = /^hsl\(([\d.]+), ([\d.]+)%, ([\d.]+)%\)$/.exec(css);
  if (!m) throw new Error(`読めない色: ${css}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

describe("trackColors", () => {
  it("両端はテーマの primary と secondary そのもの", () => {
    const got = trackColors("#2DD4BF", "#FB923C", 3).map(parse);

    expect(got[0]!.h).toBeCloseTo(hexToHsl("#2DD4BF").h, 0);
    expect(got[2]!.h).toBeCloseTo(hexToHsl("#FB923C").h, 0);
  });

  it("色相を等間隔でつなぐ（中間が濁らない＝彩度が落ちない）", () => {
    const got = trackColors("#2DD4BF", "#FB923C", 3).map(parse);

    // 172° → 27° の中間は 100° 付近
    expect(got[1]!.h).toBeCloseTo(100, 0);
    // 中間の彩度が両端より低いと灰色寄りになり、無彩色の共通帯と紛れる
    expect(got[1]!.s).toBeGreaterThanOrEqual(Math.min(got[0]!.s, got[2]!.s));
  });

  it("色相環は近いほうに回す（360 をまたぐ組み合わせでも遠回りしない）", () => {
    // 330° → 38°。0 をまたぐ 68° の側を通る
    const got = trackColors("#EC4899", "#F59E0B", 3).map(parse);

    expect(got[1]!.h).toBeCloseTo(4, 0);
  });

  it("トラックが1本なら primary をそのまま使う", () => {
    const got = trackColors("#2DD4BF", "#FB923C", 1).map(parse);

    expect(got).toHaveLength(1);
    expect(got[0]!.h).toBeCloseTo(hexToHsl("#2DD4BF").h, 0);
  });

  it("本数が0なら空。読めない色でも落ちない", () => {
    expect(trackColors("#2DD4BF", "#FB923C", 0)).toEqual([]);
    expect(trackColors("いろ", "#FB923C", 2)).toHaveLength(2);
  });
});

/**
 * スタッフ用トラック (#383)。
 *
 * 色はトラックの本数から作るので、スタッフ用の列を本数に混ぜると
 * **公開トラックの色が動く**。スタッフ用トラックは参加者には返らないため、
 * 動いた瞬間に「同じトラックが参加者と運営で別の色」になり、会場で
 * 「青の列」と口頭で伝えている運営が壊れる。
 */
describe("trackColorsForTracks (#383)", () => {
  const track = (id: string, visibility: "public" | "staff") => ({
    id,
    visibility,
  });

  it("スタッフ用トラックが混ざっても、公開トラックの色は変わらない", () => {
    const withoutStaff = trackColorsForTracks("#2DD4BF", "#FB923C", [
      track("tr-a", "public"),
      track("tr-b", "public"),
    ]);
    const withStaff = trackColorsForTracks("#2DD4BF", "#FB923C", [
      track("tr-a", "public"),
      track("tr-s", "staff"),
      track("tr-b", "public"),
    ]);

    // スタッフ用の列は色を持たない（無彩色＋斜線で描く）
    expect(withStaff[1]).toBeNull();
    // 公開トラックは、間に挟まれても並び順どおりに同じ色を受け取る
    expect([withStaff[0], withStaff[2]]).toEqual(withoutStaff);
  });
});
