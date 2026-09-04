import { describe, expect, it } from "vitest";
import { translations } from "@eventer/shared/i18n";
import { BG_VARIANTS, CARD_THEMES } from "./cardTheme.js";

/**
 * 見た目の選択肢の**呼び名が辞書から来ている**ことの見張り (#475)。
 *
 * 元は「ロゼット」「インディゴ」がカタログに直に書いてあり、英語で見ている人にも
 * 日本語のチップが出ていた。直っても、次に選択肢を足す人が同じ形で
 * `label: "ネオン"` と書けば静かに戻る。**型はキーの綴りしか見ない**ので、
 * ここが拾うのは型で拾えない2つ:
 *
 * 1. カタログに表示用の文字列そのものが戻ってくる（`label` / `name` の復活）
 * 2. 引き先のキーが片方の言語にしか無い（英語だけ・日本語だけ足した）
 *
 * 実際にチップへ訳が出るか（画面まで繋がっているか）は
 * `pages/LicenseCardPage.test.tsx` が英語に切り替えて確かめる。
 */

/** カタログの各項目が持ってよいフィールド。ここに無いものが増えたら止める */
const BG_FIELDS = ["key", "labelKey"];
const THEME_FIELDS = [
  "key",
  "nameKey",
  "paper",
  "accentA",
  "accentB",
  "accentBLight",
  "accentDeep",
  "watermark",
];

/** 選択肢が引く辞書キー（"profile.xxx" の形） */
const LABEL_KEYS = [
  ...BG_VARIANTS.map((v) => v.labelKey),
  ...CARD_THEMES.map((t) => t.nameKey),
];

describe("カードの見た目の呼び名 (#475)", () => {
  it("カタログは表示用の文字列を持たない", () => {
    for (const v of BG_VARIANTS) {
      expect(Object.keys(v).sort(), v.key).toEqual([...BG_FIELDS].sort());
    }
    for (const t of CARD_THEMES) {
      expect(Object.keys(t).sort(), t.key).toEqual([...THEME_FIELDS].sort());
    }
  });

  it("引く先のキーは日本語と英語の両方にある", () => {
    // 型（en: Record<keyof typeof ja, string>）は「両方に同じキーがある」ことしか
    // 守れない。キーごと辞書から消えた場合はここで落ちる
    for (const key of LABEL_KEYS) {
      const name = key.slice("profile.".length) as keyof typeof translations.ja.profile;
      for (const lang of ["ja", "en"] as const) {
        const text = translations[lang].profile[name];
        expect(typeof text, `${lang} ${key}`).toBe("string");
        expect(text, `${lang} ${key}`).not.toBe("");
      }
    }
  });

  it("選択肢の数だけ呼び名があり、使い回していない", () => {
    expect(LABEL_KEYS.length).toBe(BG_VARIANTS.length + CARD_THEMES.length);
    expect(new Set(LABEL_KEYS).size).toBe(LABEL_KEYS.length);
    // 同じ訳文を2つの選択肢に当てると、ピッカーで見分けがつかない
    for (const lang of ["ja", "en"] as const) {
      const texts = LABEL_KEYS.map(
        (k) =>
          translations[lang].profile[
            k.slice("profile.".length) as keyof typeof translations.ja.profile
          ],
      );
      expect(new Set(texts).size, lang).toBe(texts.length);
    }
  });
});
