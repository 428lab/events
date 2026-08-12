import { describe, it, expect, afterEach } from "vitest";
import { translations } from "@eventer/shared/i18n";
import { i18next, tDynamic } from "./index.js";

/**
 * 辞書そのものを見張るテスト (#363)。
 *
 * 第2段階で辞書はキー数百まで増えた。**型で守れるのは「両方の言語に同じキーが
 * あること」まで**で、中身までは見てくれない。ここが拾うのは型で拾えない3種類:
 *
 * 1. 英語側に日本語が残っている（訳し忘れ・コピペ漏れ）
 * 2. 数を含む英語が「1 days」になる（単数用のキーを足し忘れた）
 * 3. サーバーのコードで引く表が、辞書に無いコードでキー名を画面に出す
 *
 * 言語を切り替えるテストがあるので毎回日本語に戻す（test/setup.ts の
 * beforeEach も効くが、このファイルの中で切り替えたまま次へ渡さない）。
 */
afterEach(async () => {
  await i18next.changeLanguage("ja");
});

/** 仮名と漢字。英語の文言に混ざっていてはいけない */
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;
/** 和文の約物。英語では半角の記号に置き換わっているべき */
const JA_PUNCTUATION = /[、。「」『』（）・〜！？：]/;

/** 名前空間ごとに [キー, 文言] を平らに並べる */
function entries(lang: "ja" | "en"): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [ns, table] of Object.entries(translations[lang])) {
    for (const [key, value] of Object.entries(table)) {
      out.push([`${ns}.${key}`, value]);
    }
  }
  return out;
}

describe("辞書の中身 (#363)", () => {
  it("英語の文言に日本語が混ざっていない", () => {
    const leaked = entries("en")
      .filter(([, v]) => JAPANESE.test(v) || JA_PUNCTUATION.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(leaked).toEqual([]);
  });

  it("日本語と英語のキーが完全に一致する", () => {
    const ja = entries("ja").map(([k]) => k).sort();
    const en = entries("en").map(([k]) => k).sort();
    expect(en).toEqual(ja);
  });

  /**
   * 差し込みの穴は両方の言語で同じでなければならない。片方だけ `{{n}}` が
   * 抜けていると、その言語だけ数字が消えた文が出る（型では拾えない）。
   */
  it("差し込みの穴が両方の言語で揃っている", () => {
    const holes = (v: string) =>
      (v.match(/\{\{(\w+)\}\}/g) ?? []).sort().join(",");
    const en = new Map(entries("en"));
    const mismatched = entries("ja")
      .filter(([k, v]) => holes(v) !== holes(en.get(k) ?? ""))
      .map(([k, v]) => `${k}: ja[${holes(v)}] en[${holes(en.get(k) ?? "")}]`);
    expect(mismatched).toEqual([]);
  });
});

/**
 * 単数のときに英語が崩れないこと (#357 で「1 days」が出たのと同じ轍)。
 *
 * **画面には言語による分岐を書かない**約束なので、画面がやるのは
 * 「数が1なら単数用のキー」を選ぶことだけ。日本語はどちらのキーも同じ綴りで、
 * 英語だけが単複で変わる。その前提をここで固定する。
 */
describe("数を含む文言の単数・複数 (#363)", () => {
  const pairs: Array<[one: string, many: string]> = [
    ["staffOps.personCount", "staffOps.peopleCount"],
    ["staffOps.nameCardCountOneSheet", "staffOps.nameCardCount"],
    ["eventForm.surveyLoseAnswer", "eventForm.surveyLoseAnswers"],
  ];

  it("日本語は単数でも複数でも同じ綴り", () => {
    for (const [one, many] of pairs) {
      expect(tDynamic(one, ""), one).toBe(tDynamic(many, ""));
    }
  });

  it("英語は単数と複数で綴りが変わる", async () => {
    await i18next.changeLanguage("en");
    for (const [one, many] of pairs) {
      expect(tDynamic(one, ""), one).not.toBe(tDynamic(many, ""));
    }
    // 実際に出る形も見ておく（"1 people" / "1 sheets" にならない）
    expect(i18next.t("staffOps.personCount", { n: 1 })).toBe("1 person");
    expect(i18next.t("staffOps.peopleCount", { n: 3 })).toBe("3 people");
    expect(i18next.t("eventForm.surveyLoseAnswer", { n: 1 })).toBe(
      "This change deletes 1 answer. Continue?",
    );
  });
});

/**
 * サーバーが返すコードで引く表 (#363)。
 *
 * サーバーはコードを増やせるので、**辞書に無いコードが来たときに
 * キー名が画面に出ない**ことが要点。`tDynamic` の既定値がその受け皿。
 */
describe("コードで引く表 (#363)", () => {
  it("スタッフ招待の断り理由が両方の言語で出る", async () => {
    expect(tDynamic("staffInviteError.already_staff", "既定")).toBe(
      "その人はすでに運営です。",
    );
    await i18next.changeLanguage("en");
    expect(tDynamic("staffInviteError.already_staff", "default")).toBe(
      "They are already an organizer.",
    );
  });

  it("辞書に無いコードでもキー名が画面に出ない", () => {
    const fallback = "処理できませんでした。時間をおいて試してください。";
    expect(tDynamic("staffInviteError.brand_new_code", fallback)).toBe(fallback);
    expect(tDynamic("broadcastSegment.brand_new_segment", "全員")).toBe("全員");
    expect(tDynamic("staffInviteStatus.brand_new_status", "保留")).toBe("保留");
  });
});
