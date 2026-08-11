import { describe, it, expect, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageCard } from "../components/LanguageCard.js";
import { detectFromEnvironment, i18next, syncDocumentLanguage } from "./index.js";
import {
  readLanguageChoice,
  storedLanguage,
  writeLanguageChoice,
} from "./languagePreference.js";

/**
 * 設定ページから選ぶ表示言語 (#354)。
 *
 * 見張りたいのは3つ。
 * - 優先順位が **URLの指定 > 利用者の設定 > ブラウザの言語** のままであること
 * - 「自動」に戻すと保存値が消えて、ブラウザの言語判定に戻ること
 * - 保存領域が使えない環境でも例外にならず、その場の表示だけは切り替わること
 */

const realLanguages = navigator.languages;
const setBrowserLanguages = (langs: readonly string[]) =>
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: langs,
  });

/**
 * ボタンを押す。押した先で言語の切り替え（非同期）が走るので、
 * その反映まで act で包む（包まないと React が警告を出す）
 */
async function clickButton(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

afterEach(async () => {
  setBrowserLanguages(realLanguages);
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  // 描画したカードがまだ残っている段階で走るので、ここも act で包む
  await act(async () => {
    await i18next.changeLanguage("ja");
  });
});

describe("保存した言語の優先順位 (#354)", () => {
  it("保存値はブラウザの言語より強い", () => {
    setBrowserLanguages(["en-US"]);
    expect(detectFromEnvironment(storedLanguage())).toBe("en");
    writeLanguageChoice("ja");
    expect(detectFromEnvironment(storedLanguage())).toBe("ja");
  });

  it("保存値は ?lang= より弱い", () => {
    setBrowserLanguages(["en-US"]);
    writeLanguageChoice("ja");
    window.history.replaceState({}, "", "/account?lang=en");
    expect(detectFromEnvironment(storedLanguage())).toBe("en");
  });

  it("対応していない値が入っていても「自動」として扱う", () => {
    setBrowserLanguages(["en-US"]);
    localStorage.setItem("eventer:language", "zh");
    expect(readLanguageChoice()).toBe("auto");
    expect(detectFromEnvironment(storedLanguage())).toBe("en");
  });

  it("「自動」は保存値を消してブラウザの言語判定に戻す", () => {
    setBrowserLanguages(["en-US"]);
    writeLanguageChoice("ja");
    expect(localStorage.getItem("eventer:language")).toBe("ja");
    writeLanguageChoice("auto");
    expect(localStorage.getItem("eventer:language")).toBeNull();
    expect(readLanguageChoice()).toBe("auto");
    expect(detectFromEnvironment(storedLanguage())).toBe("en");
  });
});

describe("表示言語のカード (#354)", () => {
  it("選ぶとその場で切り替わり、端末に残る", async () => {
    setBrowserLanguages(["ja-JP"]);
    syncDocumentLanguage();
    render(<LanguageCard />);

    expect(screen.getByRole("button", { name: "自動" })).toBeInTheDocument();

    await clickButton("English");
    await waitFor(() => expect(i18next.language).toBe("en"));
    expect(localStorage.getItem("eventer:language")).toBe("en");
    // 再読み込みを求めずに文言が入れ替わる
    expect(screen.getByText("Display language")).toBeInTheDocument();
    // 読み上げ・辞書機能のために <html lang> も追従する
    expect(document.documentElement.lang).toBe("en");
  });

  it("「自動」に戻すと保存値が消えてブラウザの言語に戻る", async () => {
    setBrowserLanguages(["ja-JP"]);
    writeLanguageChoice("en");
    await i18next.changeLanguage("en");
    render(<LanguageCard />);

    await clickButton("Automatic");
    await waitFor(() => expect(i18next.language).toBe("ja"));
    expect(localStorage.getItem("eventer:language")).toBeNull();
    expect(screen.getByText("表示言語")).toBeInTheDocument();
  });

  it("同じものをもう一度押しても選択が外れない", async () => {
    setBrowserLanguages(["ja-JP"]);
    render(<LanguageCard />);

    await clickButton("English");
    await waitFor(() => expect(i18next.language).toBe("en"));
    await clickButton("English");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(i18next.language).toBe("en");
  });

  /**
   * プライベートモードなど保存が禁じられた環境。読み書きのどちらで例外が出ても
   * 画面は壊れず、そのセッションの表示だけは切り替わる。
   */
  it("保存領域が使えなくても壊れず、表示だけは切り替わる", async () => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(boom);
    try {
      setBrowserLanguages(["ja-JP"]);
      expect(() => readLanguageChoice()).not.toThrow();
      expect(readLanguageChoice()).toBe("auto");
      expect(() => writeLanguageChoice("en")).not.toThrow();
      expect(() => writeLanguageChoice("auto")).not.toThrow();

      render(<LanguageCard />);
      await clickButton("English");
      await waitFor(() => expect(i18next.language).toBe("en"));
      expect(screen.getByText("Display language")).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
      removeItem.mockRestore();
    }
  });
});
