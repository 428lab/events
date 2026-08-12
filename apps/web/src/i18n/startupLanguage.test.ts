import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 保存した言語が**起動時の初期化に実際に効いている**こと (#354)。
 *
 * ほかのテストは判定関数を直接呼ぶので、`i18n/index.ts` の init が
 * 保存値を渡し忘れても（`lng: detectFromEnvironment()` に戻しても）気づけない。
 * それだと「English を選ぶ → 再読み込み → 日本語に戻る」が素通りする。
 *
 * ここだけはモジュールを読み込み直して、**i18next が実際に立ち上がった言語**を
 * 見る。読み込み直しは他のテストのモジュール状態を汚すので、この1ファイルに
 * 閉じ込めてある。
 */

const realLanguages = navigator.languages;
const setBrowserLanguages = (langs: readonly string[]) =>
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: langs,
  });

/** 保存領域とブラウザの状態を整えたうえで、言語まわりを一から読み込み直す */
async function boot() {
  vi.resetModules();
  return await import("./index.js");
}

afterEach(() => {
  setBrowserLanguages(realLanguages);
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  vi.resetModules();
});

describe("起動時に保存した言語で立ち上がる (#354)", () => {
  it("保存値があれば、ブラウザが日本語でも英語で立ち上がる", async () => {
    setBrowserLanguages(["ja-JP", "ja"]);
    localStorage.setItem("eventer:language", "en");

    const { i18next } = await boot();

    await vi.waitFor(() => expect(i18next.language).toBe("en"));
    expect(i18next.t("settings.languageTitle")).toBe("Display language");
  });

  it("保存値が無ければブラウザの言語で立ち上がる", async () => {
    setBrowserLanguages(["ja-JP", "ja"]);

    const { i18next } = await boot();

    await vi.waitFor(() => expect(i18next.language).toBe("ja"));
    expect(i18next.t("settings.languageTitle")).toBe("表示言語");
  });

  it("URLの指定は保存値より優先される", async () => {
    setBrowserLanguages(["ja-JP", "ja"]);
    localStorage.setItem("eventer:language", "ja");
    window.history.replaceState({}, "", "/account?lang=en");

    const { i18next } = await boot();

    await vi.waitFor(() => expect(i18next.language).toBe("en"));
  });
});
