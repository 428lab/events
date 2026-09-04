import { describe, it, expect } from "vitest";
import { staffOpsParts, translations } from "@eventer/shared/i18n";

const staffOps = { ja: translations.ja.staffOps, en: translations.en.staffOps };

/**
 * 画面ごとに分けた運営画面の文言を、繋ぎ目で見張るテスト (#466)。
 *
 * 8つの断片を1つのオブジェクトに広げているので、**同じキーが2つの断片にあると
 * 後ろが黙って前を上書きする**。型は「日本語と英語が同じキーを持つこと」しか
 * 見ないので、両方の言語に同じキーを足してしまえば型は素通りし、先に書いた画面の
 * 文言だけが差し替わる（辞書のキー一致テストも通ってしまう）。
 *
 * 繋いだ結果のキー数が断片のキー数の合計と一致するかを数えれば、重なりは必ず
 * ここで落ちる。落ちたときは、増えていない分のキー名が2か所にある。
 */
describe("運営画面の文言の繋ぎ目 (#466)", () => {
  it("繋いだキー数が、画面ごとの断片の合計と一致する（重なりがない）", () => {
    const sum = (lang: "ja" | "en") =>
      staffOpsParts.reduce(
        (total, part) => total + Object.keys(part[lang]).length,
        0,
      );
    expect(Object.keys(staffOps.ja).length).toBe(sum("ja"));
    expect(Object.keys(staffOps.en).length).toBe(sum("en"));
  });

  /**
   * 断片の中の日本語と英語は型で揃うが、**断片どうしの取り違え**（ある画面の
   * 日本語に、別の画面の英語を並べてしまう）は型では拾えない。合流後に見ておく。
   */
  it("繋いだあとも日本語と英語のキーが完全に一致する", () => {
    expect(Object.keys(staffOps.en).sort()).toEqual(
      Object.keys(staffOps.ja).sort(),
    );
  });
});
