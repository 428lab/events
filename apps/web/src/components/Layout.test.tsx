import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@eventer/shared";
import { AppThemeProvider } from "../theme/ThemeContext.js";
import { Layout } from "./Layout.js";

/**
 * ヘッダーのメニューが、幅によって到達不能にならないこと (#316)。
 * 幅が足りないときはハンバーガーへ畳むので、畳んだ側に横並びの項目が
 * すべて入っていることを確かめる（片方だけに足す事故の退行防止）。
 */
const user = {
  id: "u-1",
  username: "tester",
  globalName: "テスター",
  avatarUrl: null,
} as User;

function renderLayout(isAdmin: boolean) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  qc.setQueryData(["me"], { id: "u-1", isAdmin });
  return render(
    <QueryClientProvider client={qc}>
      <AppThemeProvider>
        <MemoryRouter>
          <Layout user={user}>本文</Layout>
        </MemoryRouter>
      </AppThemeProvider>
    </QueryClientProvider>,
  );
}

/** ヘッダーの横並びナビに出ているリンク先 */
function inlineNavTargets(): string[] {
  const nav = document.querySelector("a[href='/communities']")
    ?.parentElement as HTMLElement;
  return Array.from(nav.querySelectorAll("a[href]")).map(
    (a) => a.getAttribute("href") ?? "",
  );
}

/**
 * jsdom はレイアウトを持たず幅が 0 になるため、そのままでは
 * 「収まっている」判定でハンバーガーが出ない。幅を偽装して畳ませる。
 */
function collapseHeader() {
  const nav = document.querySelector("a[href='/communities']")
    ?.parentElement as HTMLElement;
  Object.defineProperty(nav, "scrollWidth", { configurable: true, value: 800 });
  Object.defineProperty(nav.parentElement as HTMLElement, "clientWidth", {
    configurable: true,
    value: 100,
  });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function openMenu(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("menu");
}

function menuTargets(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll("a[href]")).map(
    (a) => a.getAttribute("href") ?? "",
  );
}

beforeEach(() => {
  // 背景の花火は canvas を使い jsdom で動かない。ヘッダーの検証には不要なので切る
  localStorage.setItem("eventer.fireworks", "off");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => "" })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ヘッダーのメニュー (#316)", () => {
  it("幅が足りるうちは横並び、足りなくなるとハンバーガーになる", () => {
    renderLayout(false);
    expect(screen.queryByRole("button", { name: "メニュー" })).toBeNull();

    collapseHeader();
    expect(screen.getByRole("button", { name: "メニュー" })).toBeTruthy();
  });

  it("横並びナビの行き先が、畳んだときのメニューにもすべてある", () => {
    renderLayout(false);
    const inline = inlineNavTargets();
    expect(inline).toEqual(
      expect.arrayContaining([
        "/communities",
        "/venues",
        "/decks",
        "/live-sets",
        // マイページは廃止して設定に置き換えた (#319)
        "/account",
      ]),
    );
    expect(inline).not.toContain("/me");

    collapseHeader();
    const targets = menuTargets(openMenu("メニュー"));
    for (const to of inline) expect(targets).toContain(to);
  });

  it("畳んだメニューには設定とログアウトもある", () => {
    renderLayout(false);
    collapseHeader();
    const menu = openMenu("メニュー");
    expect(menuTargets(menu)).toContain("/account");
    // 設定は NAV_ITEMS 側の1項目だけ。同じ行き先を二重に出さない (#319)
    expect(menuTargets(menu).filter((t) => t === "/account").length).toBe(1);
    expect(within(menu).getByText("ログアウト")).toBeTruthy();
  });

  it("右上のアイコンは自分のプロフィールを開く (#319)", () => {
    renderLayout(false);
    const avatar = document.querySelector("a[href='/users/tester']");
    expect(avatar).toBeTruthy();
    expect(avatar?.getAttribute("title")).toBe("自分のプロフィール");
  });

  it("運営管理者の「運用」項目が横並びと畳んだ側で一致する", () => {
    renderLayout(true);
    const adminTargets = menuTargets(openMenu(/運用/)).filter((t) =>
      t.startsWith("/admin/"),
    );
    expect(adminTargets.length).toBe(8);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    collapseHeader();
    const collapsedTargets = menuTargets(openMenu("メニュー")).filter((t) =>
      t.startsWith("/admin/"),
    );
    expect(collapsedTargets).toEqual(adminTargets);
  });
});
