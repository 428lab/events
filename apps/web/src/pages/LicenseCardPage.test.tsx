import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserProfile } from "@eventer/shared";

/**
 * カードのデザイン画面 (#334)。
 *
 * この画面は**自分のカードを仕立てるための画面**で、他人のカードには編集も
 * 印刷も無い。他人が直接URLを開いたらプロフィールへ戻すこと、本人のときは
 * 保存済みの見た目で描く（手元の既定で上書きしない）ことを固定する。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

const { LicenseCardPage } = await import("./LicenseCardPage.js");

/** カード上端のバーは配色テーマの主アクセント色。誰の配色で描かれたかの手掛かり */
const ACCENT = { teal: "#0D9488", rose: "#DB2777" };

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "u-1",
    handle: "tester",
    name: "テスター",
    avatarUrl: null,
    createdAt: 1_700_000_000_000,
    events: [],
    communities: [],
    awards: [],
    speakerEventIds: [],
    meetCounts: {},
    meetTotal: 0,
    eventPhotos: [],
    participation: {
      attended: 0,
      noShow: 0,
      cancelEarly: 0,
      cancelLate: 0,
      hosted: 0,
      staffed: 0,
      spoken: 0,
      likesReceived: 0,
    },
    gamification: {
      xp: 0,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 10,
      badges: [],
    },
    followerCount: 0,
    followingCount: 0,
    isFollowing: false,
    isMe: true,
    cardImageUpdatedAt: null,
    cardImageKey: null,
    ...over,
  } as UserProfile;
}

function renderCardPage(p: UserProfile) {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith("/public/users/")) return Promise.resolve(p);
    return Promise.resolve({});
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/users/tester/card"]}>
        <Routes>
          <Route path="/users/:id/card" element={<LicenseCardPage />} />
          {/* 戻された先。プロフィール本体は重いのでここでは目印だけ置く */}
          <Route path="/users/:id" element={<div>プロフィール本体</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  localStorage.clear();
});

describe("カードのデザイン画面 (#334)", () => {
  it("他人が直接開いたらプロフィールへ戻す（編集UIを見せない）", async () => {
    renderCardPage(profile({ isMe: false, id: "u-other", handle: "other" }));
    expect(await screen.findByText("プロフィール本体")).toBeTruthy();
    // 背景・配色を選ぶチップも、印刷・書き出しの操作も出さない
    expect(screen.queryByText("ロゼット")).toBeNull();
    expect(screen.queryByText("インディゴ")).toBeNull();
    expect(screen.queryByRole("button", { name: "印刷する" })).toBeNull();
  });

  it("他人が開いても手元の既定は書き換わらない", async () => {
    // 他人のカードで色を変えると自分の既定がすり替わり、次に自分のカードを
    // 開いた時点でその配色で自分のシェア用画像が上書きされていた (#334)
    localStorage.setItem("eventer:cardBg", "topo");
    localStorage.setItem("eventer:cardTheme", "teal");
    renderCardPage(profile({ isMe: false, id: "u-other", handle: "other" }));
    await screen.findByText("プロフィール本体");
    expect(localStorage.getItem("eventer:cardBg")).toBe("topo");
    expect(localStorage.getItem("eventer:cardTheme")).toBe("teal");
  });

  it("本人には編集・印刷・書き出しの操作を出す", async () => {
    renderCardPage(profile());
    expect(await screen.findByText("プロフィールカード")).toBeTruthy();
    expect(screen.getByText("ロゼット")).toBeTruthy();
    expect(screen.getByRole("button", { name: "印刷する" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "PNGをダウンロード" }),
    ).toBeTruthy();
  });

  it("保存済みの見た目で描く（手元の既定で上書きしない）", async () => {
    // 手元の既定はティール。保存済みはローズなので、保存済みが勝つ
    localStorage.setItem("eventer:cardBg", "topo");
    localStorage.setItem("eventer:cardTheme", "teal");
    renderCardPage(profile({ cardImageKey: "arcs-rose" }));
    await screen.findByText("プロフィールカード");
    const svg = screen.getByRole("img", {
      name: "テスター のプロフィールカード",
    });
    expect(svg.querySelector(`[fill="${ACCENT.rose}"]`)).toBeTruthy();
    expect(svg.querySelector(`[fill="${ACCENT.teal}"]`)).toBeNull();
  });

  it("一度も保存していなければ手元の既定で描く", async () => {
    localStorage.setItem("eventer:cardBg", "topo");
    localStorage.setItem("eventer:cardTheme", "teal");
    renderCardPage(profile({ cardImageKey: null }));
    await screen.findByText("プロフィールカード");
    const svg = screen.getByRole("img", {
      name: "テスター のプロフィールカード",
    });
    expect(svg.querySelector(`[fill="${ACCENT.teal}"]`)).toBeTruthy();
  });
});
