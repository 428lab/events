import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@eventer/shared";
import { AppThemeProvider } from "../theme/ThemeContext.js";
import { Layout } from "../components/Layout.js";
import { dateLocale, detectLanguage, i18next } from "./index.js";

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
});

describe("訳が無い箇所 (#352)", () => {
  it("英語に訳が無いキーは日本語のまま出る（空欄にならない）", async () => {
    await i18next.changeLanguage("en");
    // ja にしか無いキーを1つ足して、英語表示でどうなるかを見る
    i18next.addResource("ja", "translation", "onlyJa.sample", "日本語だけ");
    expect(i18next.t("onlyJa.sample")).toBe("日本語だけ");
  });

  it("どちらにも無いキーでも例外にならない", () => {
    expect(() => i18next.t("nowhere.at.all")).not.toThrow();
    expect(typeof i18next.t("nowhere.at.all")).toBe("string");
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
