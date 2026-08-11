import { describe, it, expect, afterEach, vi } from "vitest";
import { normalizeLanguage } from "@eventer/shared/i18n";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@eventer/shared";
import { AppThemeProvider } from "../theme/ThemeContext.js";
import { Layout } from "../components/Layout.js";
import {
  dateLocale,
  detectFromEnvironment,
  detectLanguage,
  i18next,
  syncDocumentLanguage,
  tDynamic,
} from "./index.js";

/**
 * 表示言語の決め方と、訳が無いときの振る舞い (#352)。
 *
 * 第2段階までは訳の無い画面が残る前提なので、「訳が無くても壊れない」ことを
 * ここで見張る。壊れ方（空欄になる・キー名が出る・例外）を退行させないため。
 */

// 言語を変えるテストがあるので、毎回日本語に戻す（test/setup.ts の beforeEach も
// 効くが、このファイルの中で切り替えたまま次へ渡さないことを明示しておく）
afterEach(async () => {
  await i18next.changeLanguage("ja");
});

describe("表示言語の決め方 (#352)", () => {
  it("ブラウザの言語で切り替わる", () => {
    expect(detectLanguage("", ["en-US", "en"])).toBe("en");
    expect(detectLanguage("", ["ja-JP", "ja"])).toBe("ja");
  });

  it("URLの指定がブラウザの言語より優先される", () => {
    expect(detectLanguage("?lang=en", ["ja-JP"])).toBe("en");
    expect(detectLanguage("?lang=ja", ["en-US"])).toBe("ja");
  });

  it("URLの指定は利用者の設定より優先される", () => {
    expect(detectLanguage("?lang=en", ["ja-JP"], "ja")).toBe("en");
  });

  it("利用者の設定はブラウザの言語より優先される", () => {
    expect(detectLanguage("", ["en-US"], "ja")).toBe("ja");
  });

  it("対応していない言語は飛ばして次の候補を見る", () => {
    expect(detectLanguage("?lang=fr", ["en-US"])).toBe("en");
    expect(detectLanguage("", ["fr-FR", "de", "ja"])).toBe("ja");
  });

  it("どれも決まらなければ日本語", () => {
    expect(detectLanguage("", [])).toBe("ja");
    expect(detectLanguage("?lang=", ["fr-FR"])).toBe("ja");
  });

  /**
   * 言語タグは「最初の `-` まで」が言語部分。前方一致で見ると `jbo`（ロジバン）や
   * `jam`（ジャマイカ・クレオール）を日本語と取り違える。同じく `enm`（中英語）を
   * 英語と取り違える。判定を `startsWith` に書き換えたら、ここで落ちる。
   */
  it("先頭が同じだけの別言語を取り違えない", () => {
    expect(normalizeLanguage("jbo")).toBeNull();
    expect(normalizeLanguage("jam")).toBeNull();
    expect(normalizeLanguage("enm")).toBeNull();
    // 日本語と誤判定していれば "ja" が返る。英語に落ちるのが正しい
    expect(detectLanguage("", ["jbo", "en-US"])).toBe("en");
    expect(detectLanguage("", ["jam", "en"])).toBe("en");
    // 正しい書き方は取りこぼさない
    expect(normalizeLanguage("ja")).toBe("ja");
    expect(normalizeLanguage("ja-JP")).toBe("ja");
    expect(normalizeLanguage("JA-jp")).toBe("ja");
  });

  /**
   * URLの指定は**対応している言語のときだけ**優先される。未知の値が
   * ブラウザの言語を横取りして日本語に落とすと、英語圏の人が
   * `?lang=zh` のリンクを踏んだだけで日本語になってしまう。
   */
  it("対応していない ?lang は無視して、ブラウザの言語に落ちる", () => {
    expect(detectLanguage("?lang=zh", ["en-US"])).toBe("en");
    expect(detectLanguage("?lang=xx", ["en-US"])).toBe("en");
    expect(detectLanguage("?lang=jbo", ["en-US"])).toBe("en");
    // 利用者の設定も同じ扱い。未知の値は次の段に落とす
    expect(detectLanguage("?lang=zh", ["en-US"], "zh")).toBe("en");
  });
});

describe("起動時の判定 (#352)", () => {
  const realLanguages = navigator.languages;
  const setBrowserLanguages = (langs: readonly string[]) =>
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: langs,
    });

  afterEach(() => {
    setBrowserLanguages(realLanguages);
    window.history.replaceState({}, "", "/");
  });

  it("URLに指定が無ければブラウザの言語を見る", () => {
    setBrowserLanguages(["ja-JP", "ja"]);
    expect(detectFromEnvironment()).toBe("ja");
    setBrowserLanguages(["en-GB"]);
    expect(detectFromEnvironment()).toBe("en");
  });

  it("URLの指定はブラウザの言語を上書きする", () => {
    setBrowserLanguages(["ja-JP"]);
    window.history.replaceState({}, "", "/events?lang=en");
    expect(detectFromEnvironment()).toBe("en");
  });

  /**
   * 言語の判定は保存領域を読まない。プライベートモードや保存領域を
   * 無効にした環境では `localStorage` に触れるだけで例外が飛び、
   * 起動時に判定している都合上そのまま画面が真っ白になるため。
   *
   * 「利用者の設定」を保存する段になっても、読み取りは try/catch で
   * 包んでから `detectLanguage` の第3引数に渡すこと（判定そのものは
   * 保存領域を知らないままにしておく）。
   */
  it("保存領域が使えなくても判定が落ちない", () => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    try {
      setBrowserLanguages(["en-US"]);
      expect(() => detectFromEnvironment()).not.toThrow();
      expect(detectFromEnvironment()).toBe("en");
      // そもそも保存領域を見ていない
      expect(getItem).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("<html lang> が実際の言語に追従する", async () => {
    syncDocumentLanguage();
    expect(document.documentElement.lang).toBe("ja");
    await i18next.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

/**
 * 辞書に無いキーは**型で落ちる**ようになったので (#352 の型拡張)、
 * ここは実行時に辞書へ足したキーと `tDynamic` 経由で確かめる。
 * 型で守れる範囲は i18n/keys.test.ts が見張っている。
 */
describe("訳が無い箇所 (#352)", () => {
  it("英語に訳が無いキーは日本語のまま出る（空欄にならない）", async () => {
    await i18next.changeLanguage("en");
    // ja にしか無いキーを1つ足して、英語表示でどうなるかを見る
    i18next.addResource("ja", "translation", "onlyJa.sample", "日本語だけ");
    expect(tDynamic("onlyJa.sample", "")).toBe("日本語だけ");
  });

  it("どちらにも無いキーでも例外にならない", () => {
    expect(() => tDynamic("nowhere.at.all", "既定")).not.toThrow();
    expect(tDynamic("nowhere.at.all", "既定")).toBe("既定");
  });
});

describe("エラーコードの辞書 (#352)", () => {
  it("両方の言語で文言が出る", async () => {
    expect(i18next.t("errors.not_found")).toBe("見つかりませんでした");
    await i18next.changeLanguage("en");
    expect(i18next.t("errors.not_found")).toBe("Not found.");
  });

  it("辞書に無いコードは既定の文言に落ちる", () => {
    const fallback = i18next.t("errors.default");
    expect(
      i18next.t("errors.brand_new_code_from_server", { defaultValue: fallback }),
    ).toBe(fallback);
  });
});

describe("日時のロケール (#352)", () => {
  it("言語に合わせて切り替わる", async () => {
    expect(dateLocale()).toBe("ja-JP");
    await i18next.changeLanguage("en");
    expect(dateLocale()).toBe("en-US");
  });

  it("ロケールが変わってもタイムゾーンは端末のまま (#322 の固定を壊さない)", async () => {
    const ms = new Date("2026-05-03T13:00:00+09:00").getTime();
    const opts = { hour: "2-digit", minute: "2-digit" } as const;
    // テストの TZ は Asia/Tokyo 固定。英語表示でも「13時」であることは変わらない
    expect(new Intl.DateTimeFormat(dateLocale(), opts).format(ms)).toBe("13:00");
    await i18next.changeLanguage("en");
    expect(new Intl.DateTimeFormat(dateLocale(), opts).format(ms)).toBe("01:00 PM");
  });
});

describe("ヘッダーの表示 (#352)", () => {
  function renderLayout() {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      },
    });
    qc.setQueryData(["me"], { id: "u-1", isAdmin: false });
    return render(
      <QueryClientProvider client={qc}>
        <AppThemeProvider>
          <MemoryRouter>
            <Layout
              user={
                { id: "u-1", username: "tester", globalName: "テスター", avatarUrl: null } as User
              }
            >
              本文
            </Layout>
          </MemoryRouter>
        </AppThemeProvider>
      </QueryClientProvider>,
    );
  }

  it("日本語のときは日本語で出る", () => {
    renderLayout();
    expect(screen.getByText("コミュニティ")).toBeInTheDocument();
    expect(screen.getByText("ログアウト")).toBeInTheDocument();
  });

  it("英語のときは英語で出る", async () => {
    await i18next.changeLanguage("en");
    renderLayout();
    expect(screen.getByText("Communities")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });
});
