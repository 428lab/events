import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  ARC_CIRCLES,
  FLOW_LINES,
  ROSETTE_CURVES,
  ROSETTE_WAVES,
  TOPO_CONTOURS,
} from "./patternData.js";
import { LicenseCardSvg } from "./LicenseCardSvg.js";
import { toCardData, type CardProfile } from "./cardData.js";
import { charUnits, fitFontSize, textUnits } from "./cardText.js";
import { AVATAR, MARGIN_X, NAME_MAX_W, QR } from "./cardLayout.js";
import { BG_VARIANTS, CARD_THEMES, type CardBgVariant } from "./cardTheme.js";

/**
 * カードの描画が静かにずれないための見張り (#466)。
 *
 * カードは「見て確かめる」ものなので、壊れても테スト結果は緑のまま通りやすい。
 * #466 で絵から切り出したもの（配色カタログ・座標定数・文字幅の見積り・
 * 背景パターンの表）は、**間違えても例外が飛ばず、位置や大きさが少しずれるだけ**。
 * ここが拾うのはその4種類:
 *
 * 1. 背景パターンの表 (`STROKE_GROUPS`) の取り違え（別の変種の線が出る／出ない）
 * 2. 座標定数の置き換え漏れ（アバターの4つの図形が別々の枠を指す）
 * 3. 文字幅の見積り（`cardText.ts`）が元の式と違う値を返す
 * 4. コミュニティ帯がQRパネルに重なる（帯の幅はQRの左端で決まる）
 */

const profile: CardProfile = {
  id: "abcdef0123456789",
  handle: "kojira",
  name: "kojira",
  avatarUrl: "https://example.test/a.png",
  createdAt: Date.UTC(2024, 4, 17, 3, 0, 0),
  participation: { attended: 12, noShow: 3, hosted: 7, spoken: 4 },
  gamification: { level: 9, xp: 4321, badges: [{ key: "first_host", tier: 1 }] },
  communities: [],
};

function draw(p: CardProfile, variant: CardBgVariant = "rosette") {
  const { container } = render(
    <LicenseCardSvg
      card={toCardData(p, "fallback", "events.example")}
      variant={variant}
      theme="indigo"
      qrUrl="https://events.example/u/kojira"
    />,
  );
  return container;
}

describe("背景パターン (#466)", () => {
  /** 変種ごとに「何本の線と何個の円が出るか」は patternData.ts が決めている。
   * 表を1つ取り違えると、例外は飛ばずに別の背景が描かれるだけなので数で押さえる */
  const expected = {
    rosette: { paths: ROSETTE_WAVES.length + ROSETTE_CURVES.length, circles: 0 },
    topo: { paths: TOPO_CONTOURS.length, circles: 0 },
    arcs: { paths: 0, circles: ARC_CIRCLES.length },
    // flow は線に加えて帯（塗りのパス）が1枚
    flow: { paths: FLOW_LINES.length + 1, circles: 0 },
  } as const;

  for (const v of BG_VARIANTS) {
    it(`${v.key} は決まった数の図形を描く`, () => {
      const c = draw(profile, v.key);
      // ロゴグリフ（パス1・円4）はヘッダーとウォーターマークで2回出るので差し引く
      const paths = c.querySelectorAll("path").length - 2;
      const circles = c.querySelectorAll("circle").length - 8;
      expect({ paths, circles }).toEqual(expected[v.key]);
    });
  }

  it("配色テーマは背景の線の色に効く", () => {
    // themedPatternColor が写像を止めると、どのテーマでも indigo の色が出る
    const seen = CARD_THEMES.map((t) => {
      const { container } = render(
        <LicenseCardSvg
          card={toCardData(profile, "f", "h")}
          variant="rosette"
          theme={t.key}
          qrUrl="u"
        />,
      );
      // 背景はロゴグリフより先に描かれるので先頭が背景の線
      return container.querySelectorAll("path")[0]?.getAttribute("stroke");
    });
    expect(new Set(seen).size).toBe(CARD_THEMES.length);
  });
});

describe("座標定数 (#466)", () => {
  it("アバターの下地・クリップ・画像は同じ枠を指す", () => {
    const c = draw(profile);
    const box = `${AVATAR.x},${AVATAR.y},${AVATAR.size},${AVATAR.size}`;
    const at = (el: Element) =>
      `${el.getAttribute("x")},${el.getAttribute("y")},${el.getAttribute("width")},${el.getAttribute("height")}`;
    const img = c.querySelector("image[data-avatar]")!;
    const clip = c.querySelector("#lc-avatar-clip rect")!;
    // 白下地・イニシャル下地の2枚（defs のクリップは別に数える）
    const plates = [...c.querySelectorAll("rect")].filter(
      (r) => at(r) === box && !r.closest("defs"),
    );
    expect(at(img)).toBe(box);
    expect(at(clip)).toBe(box);
    expect(plates.length).toBe(2);
  });

  it("コミュニティ帯はQRパネルに届かない", () => {
    const many: CardProfile = {
      ...profile,
      communities: Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        name: "とても長いコミュニティ名だとしても",
        iconUrl: null,
        myEventCount: 5 - i,
      })),
    };
    const c = draw(many);
    const chips = [...c.querySelectorAll("g[transform^='translate(']")].filter(
      (g) => g.querySelector(":scope > rect[rx='14']"),
    );
    expect(chips.length).toBe(5);
    // 帯は MARGIN_X から始まり、右端は QR.x を越えない
    const last = chips[chips.length - 1]!;
    const dx = Number(/translate\(([-\d.]+),/.exec(last.getAttribute("transform")!)![1]);
    const w = Number(last.querySelector("rect[rx='14']")!.getAttribute("width"));
    expect(MARGIN_X + dx + w).toBeLessThanOrEqual(QR.x);
  });
});

describe("文字幅の見積り (#466)", () => {
  it("字種ごとの幅は CJK 1.0 / 欧文 0.62", () => {
    // 正規表現を取り違えると折り返しと縮小が静かにずれる
    expect(charUnits("あ")).toBe(1);
    expect(charUnits("漢")).toBe(1);
    expect(charUnits("　")).toBe(1); // 全角スペース
    expect(charUnits("Ａ")).toBe(1); // 全角英字
    expect(charUnits("a")).toBe(0.62);
    expect(charUnits("!")).toBe(0.62);
    expect(textUnits("あa")).toBeCloseTo(1.62, 5);
  });

  /** #466 で3か所の式を fitFontSize に寄せた。元の式と同じ値を返すことを、
   * 表示名・ハンドル・コミュニティ名それぞれの元の書き方と突き合わせて確かめる */
  it("元の式と同じ大きさを返す", () => {
    for (let len = 0; len <= 60; len++) {
      const ascii = "a".repeat(len);
      const cjk = "あ".repeat(len);

      // 表示名: Math.max(16, Math.min(72, floor((742 / max(units,1)) * 0.94)))
      for (const s of [ascii, cjk]) {
        const units = textUnits(s);
        const old = Math.max(
          16,
          Math.min(72, Math.floor((NAME_MAX_W / Math.max(units, 1)) * 0.94)),
        );
        expect(fitFontSize(NAME_MAX_W, units, 16, 72)).toBe(old);
      }

      // ハンドル: 元は max(units,1) の下駄が無かった。桁数0でも同じ値になること
      const hUnits = (len + 1) * 0.62;
      const oldHandle = Math.max(
        11,
        Math.min(19, Math.floor((NAME_MAX_W / hUnits) * 0.94)),
      );
      expect(fitFontSize(NAME_MAX_W, hUnits, 11, 19)).toBe(oldHandle);

      // コミュニティ名: 幅は LABEL_W * 2（2行に収める）
      for (const labelW of [20, 40, 74]) {
        const units = textUnits(cjk);
        const old = Math.max(
          9,
          Math.min(14, Math.floor(((labelW * 2) / Math.max(units, 1)) * 0.94)),
        );
        expect(fitFontSize(labelW * 2, units, 9, 14)).toBe(old);
      }
    }
  });
});
