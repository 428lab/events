import { describe, it, expect } from "vitest";
import { i18next, tDynamic } from "./index.js";

/**
 * 翻訳キーが型で守られていること (#352)。
 *
 * ここは**実行時よりも型が本体**。`@ts-expect-error` は
 * 「この行は型エラーになるはず」という表明で、**エラーにならなくなると
 * `pnpm typecheck` が落ちます**（未使用の抑制として報告される）。
 * つまり `apps/web/src/i18n/i18next.d.ts` の型拡張を外したり壊したりすると、
 * このファイルが気づかせてくれます。
 *
 * 逆に「実在するキーが型エラーになる」退行も、抑制なしの行が拾います。
 */
describe("翻訳キーの型チェック (#352)", () => {
  it("実在するキーはそのまま書ける", () => {
    // ここが型エラーになるなら、辞書の形か型拡張が壊れている
    expect(i18next.t("nav.venues")).toBe("会場");
    expect(i18next.t("errors.not_found")).toBe("見つかりませんでした");
    expect(i18next.t("common.save")).toBe("保存");
  });

  it("存在しないキーは型で落ちる", () => {
    // @ts-expect-error 名前空間ごと存在しない
    expect(() => i18next.t("nowhere.at.all")).not.toThrow();
    // @ts-expect-error 名前空間はあるがキーが無い（綴り違い）
    expect(() => i18next.t("nav.venue")).not.toThrow();
    // @ts-expect-error 名前空間の綴り違い
    expect(() => i18next.t("evnts.title")).not.toThrow();
    // @ts-expect-error 入れ子の途中までしか書いていない
    expect(() => i18next.t("errors")).not.toThrow();
  });

  it("補間の値を渡すキーも書ける", () => {
    expect(i18next.t("common.participants", { n: 5 })).toBe("参加 5 人");
  });

  /**
   * サーバーが増やせる値（エラーコード・ロールなど）をキーに混ぜる場合は
   * 型で縛れない。逃げ道は tDynamic の1か所だけ、というのがこの段の約束。
   */
  it("実行時に決まるキーは tDynamic を通す", () => {
    const codeFromServer = "not_found";
    expect(tDynamic(`errors.${codeFromServer}`, "既定")).toBe(
      "見つかりませんでした",
    );
  });

  it("tDynamic は辞書に無いキーでもキー名を画面に出さない", () => {
    const unknown = "brand_new_code_from_server";
    expect(tDynamic(`errors.${unknown}`, "既定の文言")).toBe("既定の文言");
  });
});
