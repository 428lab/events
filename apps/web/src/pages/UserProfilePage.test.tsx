import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MyEventSummary, UserProfile } from "@eventer/shared";

/**
 * 公開プロフィールがマイページを兼ねる (#319)。
 *
 * 本人にしか意味がない導線（設定・フォロー中の一覧）を他人のページに
 * 出さないこと、本人のページでは公開イベントだけでなく自分用の一覧
 * （下書き・申込中を含む）が出ることを確かめる。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

const { UserProfilePage } = await import("./UserProfilePage.js");

const ev = (over: Partial<MyEventSummary>): MyEventSummary =>
  ({
    id: "e",
    title: "t",
    subtitle: "",
    description: "",
    status: "published",
    scheduling: false,
    startsAt: Date.now() - 10 * 86400_000,
    endsAt: Date.now() - 10 * 86400_000 + 3600_000,
    venueType: "offline",
    venueOffline: "山形",
    venueOnline: null,
    attendanceCheck: false,
    participantCount: 3,
    attendedCount: 0,
    capacityTotal: null,
    createdBy: "u-me",
    imageUpdatedAt: null,
    myRole: "participant",
    attended: false,
    ...over,
  }) as MyEventSummary;

const PUBLIC_EVENT = ev({ id: "pub", title: "公開イベント" });
const DRAFT_EVENT = ev({ id: "draft", title: "下書きイベント", status: "draft" });

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "u-me",
    handle: "tester",
    name: "テスター",
    avatarUrl: null,
    createdAt: 1_700_000_000_000,
    events: [PUBLIC_EVENT],
    communities: [],
    awards: [],
    speakerEventIds: [],
    meetCounts: { pub: 4 },
    meetTotal: 9,
    eventPhotos: [],
    participation: {
      attended: 1,
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
    followerCount: 2,
    followingCount: 5,
    isFollowing: false,
    isMe: true,
    cardImageUpdatedAt: null,
    cardImageKey: null,
    ...over,
  } as UserProfile;
}

function renderProfile(p: UserProfile) {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith("/public/users/") && path.endsWith("/photos")) {
      return Promise.resolve({ photos: [] });
    }
    if (path.startsWith("/public/users/")) return Promise.resolve(p);
    if (path === "/me/events") {
      return Promise.resolve({ ongoing: [], past: [PUBLIC_EVENT, DRAFT_EVENT] });
    }
    if (path === "/auth/me") return Promise.resolve({ id: "u-me" });
    if (path === "/meet/token") {
      return Promise.resolve({
        token: "mt1.u-me.1700000000.abcdef",
        expiresAt: Date.now() + 120_000,
      });
    }
    return Promise.resolve({});
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/users/tester"]}>
        <Routes>
          <Route path="/users/:id" element={<UserProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const href = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => {
  getMock.mockReset();
  localStorage.clear();
});

describe("公開プロフィール（マイページ統合 #319）", () => {
  it("本人のページには設定とフォロー中の導線が出る", async () => {
    renderProfile(profile());
    await screen.findByText("テスター");
    expect(href("設定")).toBe("/account");
    expect(href("フォロー中 5")).toBe("/following");
    // カードのデザイン画面へも飛べる（マイページからは飛べなかった）
    expect(href("デザインを変える")).toBe("/users/tester/card");
  });

  it("他人のページには設定を出さず、フォロー中はただの数字にする", async () => {
    renderProfile(profile({ isMe: false, id: "u-other", handle: "other" }));
    await screen.findByText("テスター");
    expect(screen.queryByRole("link", { name: "設定" })).toBeNull();
    expect(screen.queryByRole("link", { name: /フォロー中/ })).toBeNull();
    expect(screen.getByText(/フォロー中 5/)).toBeTruthy();
  });

  it("本人のページにだけQRを見せる導線を出す (#324)", async () => {
    renderProfile(profile());
    await screen.findByText("テスター");
    const button = screen.getByRole("button", { name: "QRを見せる" });
    button.click();
    // 飛び先は公開プロフィールではなく、使い捨てトークンの入口 (#330)
    await waitFor(() =>
      expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toBe(
        `${window.location.origin}/m/mt1.u-me.1700000000.abcdef`,
      ),
    );
  });

  it("他人のページにはQRを見せる導線を出さない (#324)", async () => {
    renderProfile(profile({ isMe: false, id: "u-other", handle: "other" }));
    await screen.findByText("テスター");
    expect(screen.queryByRole("button", { name: "QRを見せる" })).toBeNull();
    expect(screen.queryByTestId("big-qr")).toBeNull();
  });

  it("本人のページの一覧には下書きも出る（マイページ相当）", async () => {
    renderProfile(profile());
    // 画像の無いイベントはカードのサムネにもタイトルを敷くので複数出る
    expect((await screen.findAllByText("下書きイベント")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("公開イベント").length).toBeGreaterThan(0);
  });

  it("他人のページには公開イベントだけを出す", async () => {
    renderProfile(profile({ isMe: false, id: "u-other", handle: "other" }));
    expect((await screen.findAllByText("公開イベント")).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.queryAllByText("下書きイベント").length).toBe(0),
    );
  });

  it("通算の出会い数は表示中の合計ではなくサーバーの実人数を出す", async () => {
    renderProfile(profile());
    await screen.findByText("テスター");
    expect(screen.getByText("通算")).toBeTruthy();
    // meetCounts の合計は 4（延べ）だが、通算は独立に数えた実人数 9
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("出会った人")).toBeTruthy();
  });

  it("通算のイベント数は直下の一覧と同じ母集団を数える", async () => {
    renderProfile(profile());
    await screen.findAllByText("下書きイベント");
    // 本人のページは下書きを含む2件。公開ぶんだけの1件にはしない
    const totals = screen.getByText("イベント").previousSibling;
    expect(totals?.textContent).toBe("2");
  });
});

/** カード上端のバーは配色テーマの主アクセント色。誰の配色で描かれたかの手掛かりに使う */
const ACCENT = { indigo: "#4F46E5", teal: "#0D9488", rose: "#DB2777" };

/** バッジ持ち・コミュニティ所属のプロフィール（落とした項目の重複を見るため） */
const decorated = (over: Partial<UserProfile> = {}) =>
  profile({
    gamification: {
      xp: 40,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      badges: [
        {
          key: "first-contact",
          name: "はじめての出会い",
          description: "はじめて人と出会った",
          icon: "meet",
          tier: 1,
        },
      ],
    },
    communities: [
      {
        id: "c1",
        slug: "nostr",
        name: "Nostr",
        iconUrl: null,
        role: "member",
        myEventCount: 1,
      },
    ],
    ...over,
  } as Partial<UserProfile>);

/**
 * プロフィールに載せるカード (#334)。
 *
 * カードは名刺のように見せて渡すもので、QRの飛び先がこのプロフィール。
 * 誰が見ても**持ち主が決めた意匠**で出ること、他人には編集・印刷・書き出しの
 * 導線を出さないこと、カードに載っている情報を下で繰り返さないことを固定する。
 */
describe("プロフィール上のプロフィールカード (#334)", () => {
  /** 見る人の手元の既定を「ティール／等高線」にしておく */
  const setViewerDefaults = () => {
    localStorage.setItem("eventer:cardBg", "topo");
    localStorage.setItem("eventer:cardTheme", "teal");
  };

  const cardSvg = () =>
    screen.getByRole("img", { name: "テスター のプロフィールカード" });

  it("他人のカードも持ち主が選んだ配色で描く（見る人の配色では描かない）", async () => {
    setViewerDefaults();
    renderProfile(
      profile({
        isMe: false,
        id: "u-other",
        handle: "other",
        cardImageKey: "arcs-rose",
      }),
    );
    await screen.findByText("テスター さんのプロフィールカード");
    const svg = cardSvg();
    expect(svg.querySelector(`[fill="${ACCENT.rose}"]`)).toBeTruthy();
    expect(svg.querySelector(`[fill="${ACCENT.teal}"]`)).toBeNull();
    expect(svg.querySelector(`[fill="${ACCENT.indigo}"]`)).toBeNull();
  });

  it("他人のカードを見ても手元の既定は書き換わらない", async () => {
    setViewerDefaults();
    renderProfile(
      profile({
        isMe: false,
        id: "u-other",
        handle: "other",
        cardImageKey: "arcs-rose",
      }),
    );
    await screen.findByText("テスター さんのプロフィールカード");
    expect(localStorage.getItem("eventer:cardBg")).toBe("topo");
    expect(localStorage.getItem("eventer:cardTheme")).toBe("teal");
  });

  it("持ち主が一度も決めていないときだけ、見る人の既定を借りる", async () => {
    setViewerDefaults();
    renderProfile(
      profile({ isMe: false, id: "u-other", handle: "other", cardImageKey: null }),
    );
    await screen.findByText("テスター さんのプロフィールカード");
    expect(cardSvg().querySelector(`[fill="${ACCENT.teal}"]`)).toBeTruthy();
  });

  it("他人には編集・印刷・書き出しの導線を出さない", async () => {
    renderProfile(profile({ isMe: false, id: "u-other", handle: "other" }));
    await screen.findByText("テスター さんのプロフィールカード");
    expect(screen.queryByRole("link", { name: /デザイン/ })).toBeNull();
    expect(screen.queryAllByRole("link", { name: /カード/ })).toHaveLength(0);
    for (const label of [/印刷/, /ダウンロード/, /書き出/]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // 印刷サイズの案内は本人向けの説明なので他人には出さない
    expect(screen.queryByText(/91×55mm/)).toBeNull();
  });

  it("本人にはデザイン画面への導線と、印刷・書き出しの在りかを伝える", async () => {
    renderProfile(profile());
    await screen.findByText(/あなたのプロフィールカード/);
    expect(href("デザインを変える")).toBe("/users/tester/card");
    expect(screen.getByText(/91×55mm/)).toBeTruthy();
  });

  it("カードに載っている情報は下で繰り返さない", async () => {
    renderProfile(decorated());
    await screen.findByText(/あなたのプロフィールカード/);
    // バッジ・所属コミュニティの一覧、レベルの進捗は見出しから落とした
    expect(screen.queryByText(/バッジ（/)).toBeNull();
    expect(screen.queryByText("所属コミュニティ")).toBeNull();
    expect(screen.queryByText(/次のレベルまで/)).toBeNull();
    // レベルと名前が出るのはカードの中の1か所だけ
    expect(screen.getAllByText("Lv.1")).toHaveLength(1);
    expect(screen.getAllByText("テスター")).toHaveLength(1);
    // カードに無いものは残す
    expect(screen.getByText("通算")).toBeTruthy();
    expect(screen.getByText("参加実績")).toBeTruthy();
  });
});
