import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { MyEventSummary } from "@eventer/shared";

/**
 * プロフィールのタブ (#407)。
 *
 * 旧4分類 (#315, ParticipationHistory) をタブに再配置した。時間の軸（予定/過去）と
 * 役割の軸（主催）は独立で、主催イベントは時期に応じて時間のタブにも重ねて出る
 * (#416)。既定は参加予定で、選択中のタブは `?tab=` で URL に載る。
 * 下書きタブは本人だけ (#319, #348)。
 * ここでは既定タブ・出し分け・URL との同期・年表切替の共有を確かめる。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

const { ProfileTabs } = await import("./ProfileTabs.js");

const ME = "u-me";
const NOW = new Date("2026-08-09T12:00:00+09:00").getTime();

function ev(over: Partial<MyEventSummary> = {}): MyEventSummary {
  return {
    id: "e-1",
    title: "テストイベント",
    subtitle: "",
    description: "",
    status: "published",
    scheduling: false,
    startsAt: new Date("2024-05-03T13:00:00+09:00").getTime(),
    endsAt: new Date("2024-05-03T18:00:00+09:00").getTime(),
    venueType: "offline",
    venueOffline: "山形",
    venueOnline: null,
    attendanceCheck: false,
    participantCount: 5,
    attendedCount: 0,
    capacityTotal: null,
    createdBy: "u-owner",
    imageUpdatedAt: null,
    myRole: "participant",
    attended: false,
    ...over,
  } as MyEventSummary;
}

const EVENTS = [
  ev({ id: "h-future", title: "主催する回", myRole: "staff", createdBy: ME,
    startsAt: new Date("2026-12-01T10:00:00+09:00").getTime(),
    endsAt: new Date("2026-12-01T18:00:00+09:00").getTime() }),
  ev({ id: "h-past", title: "主催した回", myRole: "staff", createdBy: ME }),
  ev({ id: "j-future", title: "参加予定の回",
    startsAt: new Date("2026-11-01T10:00:00+09:00").getTime(),
    endsAt: new Date("2026-11-01T18:00:00+09:00").getTime() }),
  ev({ id: "j-past", title: "参加した回" }),
];

const DRAFT = ev({
  id: "d-1",
  title: "下書きの回",
  status: "draft",
  myRole: "staff",
  createdBy: ME,
  startsAt: new Date("2026-12-20T10:00:00+09:00").getTime(),
  endsAt: new Date("2026-12-20T18:00:00+09:00").getTime(),
});

/** タブ切替が URL に載ることを見るための覗き穴 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.search}</div>;
}

function renderTabs(
  events: MyEventSummary[] = EVENTS,
  opts: { isMe?: boolean; url?: string } = {},
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[opts.url ?? "/users/tester"]}>
        <ProfileTabs
          events={events}
          userId={ME}
          speakerEventIds={[]}
          isMe={opts.isMe ?? true}
          handle="tester"
          now={NOW}
        />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tab = (name: string | RegExp) => screen.getByRole("tab", { name });

/** 写真APIのページングつき空レスポンス (#407) */
const emptyPhotosPage = {
  photos: [],
  total: 0,
  page: 1,
  limit: 24,
  hasMore: false,
  facets: { events: [], communities: [] },
};

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue(emptyPhotosPage);
  localStorage.clear();
});

describe("プロフィールのタブ (#407)", () => {
  it("既定は参加予定タブで、タブ見出しに件数が付く", () => {
    renderTabs();
    expect(tab("参加予定（2）").getAttribute("aria-selected")).toBe("true");
    expect(tab("参加した過去イベント（2）")).toBeTruthy();
    expect(tab("主催したイベント（2）")).toBeTruthy();
    // メディアは開くまで取得しないので件数を添えない
    expect(tab("投稿したメディア")).toBeTruthy();
    // 中身はこれからの回だけ（主催の予定も含む #416）。過去の回は出ない
    expect(screen.getAllByText("参加予定の回").length).toBeGreaterThan(0);
    expect(screen.getAllByText("主催する回").length).toBeGreaterThan(0);
    expect(screen.queryByText("参加した回")).toBeNull();
    expect(screen.queryByText("主催した回")).toBeNull();
  });

  it("タブを切り替えると URL の ?tab= が置き換わり、既定に戻すと消える", () => {
    renderTabs();
    fireEvent.click(tab("参加した過去イベント（2）"));
    expect(screen.getAllByText("参加した回").length).toBeGreaterThan(0);
    expect(screen.getByTestId("loc").textContent).toBe("?tab=past");

    fireEvent.click(tab("参加予定（2）"));
    expect(screen.getByTestId("loc").textContent).toBe("");
  });

  it("主催タブは予定と過去の2セクション。参加系のタブには混ざらない", () => {
    renderTabs();
    fireEvent.click(tab("主催したイベント（2）"));
    expect(screen.getByText("主催・運営するイベント（1）")).toBeTruthy();
    expect(screen.getByText("主催・運営したイベント（1）")).toBeTruthy();
    expect(screen.queryByText("参加予定の回")).toBeNull();
    expect(screen.queryByText("参加した回")).toBeNull();
  });

  it("?tab= 付きの URL で開くとそのタブが選ばれる", () => {
    renderTabs(EVENTS, { url: "/users/tester?tab=hosted" });
    expect(tab("主催したイベント（2）").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getAllByText("主催する回").length).toBeGreaterThan(0);
  });

  it("不正な ?tab= は既定タブに落とす", () => {
    renderTabs(EVENTS, { url: "/users/tester?tab=nonsense" });
    expect(tab("参加予定（2）").getAttribute("aria-selected")).toBe("true");
  });

  it("一覧⇄年表の切替はタブをまたいで共有される", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "年表" }));
    expect(screen.getByText("参加履歴の年表")).toBeTruthy();
    expect(screen.queryByText("参加予定のイベント（1）")).toBeNull();

    // 別のタブへ移っても年表のまま。母集団はそのタブのもの（主催の過去も含む #416）
    fireEvent.click(tab("参加した過去イベント（2）"));
    expect(screen.getByText("参加履歴の年表")).toBeTruthy();
    expect(screen.getByText("表示中 2 件 ・ 出会いの記録 0 件")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "一覧" }));
    expect(screen.getByText("参加したイベント（1）")).toBeTruthy();
  });

  it("年表に区分・時期の絞り込みは無い（タブがその軸を持つ）", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "年表" }));
    expect(screen.queryByText("区分")).toBeNull();
    expect(screen.queryByText("時期")).toBeNull();
    // 旧フィルタチップは「すべて 4」の形だった（合算タブの「すべて（4）」とは別物）
    expect(screen.queryByText(/^すべて \d/)).toBeNull();
  });
});

describe("時間タブに主催イベントも出す (#416)", () => {
  it("過去の主催イベントが「過去」と「主催」の両方に出る", () => {
    renderTabs();
    fireEvent.click(tab("参加した過去イベント（2）"));
    expect(screen.getByText("主催・運営したイベント（1）")).toBeTruthy();
    expect(screen.getAllByText("主催した回").length).toBeGreaterThan(0);
    expect(screen.getAllByText("参加した回").length).toBeGreaterThan(0);
    // 主催タブにも従来どおり出る
    fireEvent.click(tab("主催したイベント（2）"));
    expect(screen.getAllByText("主催した回").length).toBeGreaterThan(0);
  });

  it("未来の主催イベントが「参加予定」と「主催」の両方に出る", () => {
    renderTabs();
    // 既定タブ（参加予定）に主催予定のセクションが加わる
    expect(tab("参加予定（2）").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("主催・運営するイベント（1）")).toBeTruthy();
    expect(screen.getAllByText("主催する回").length).toBeGreaterThan(0);
    expect(screen.getAllByText("参加予定の回").length).toBeGreaterThan(0);
    fireEvent.click(tab("主催したイベント（2）"));
    expect(screen.getAllByText("主催する回").length).toBeGreaterThan(0);
  });

  it("下書きは時期のタブに混ざらない（従来どおり下書きタブのみ）", () => {
    // DRAFT は未来の主催イベントだが、参加予定タブには出ない
    renderTabs([...EVENTS, DRAFT]);
    expect(tab("参加予定（2）").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("下書きの回")).toBeNull();
  });

  it("年表の母集団も追随する（過去タブは主催＋参加の2件）", () => {
    renderTabs();
    fireEvent.click(tab("参加した過去イベント（2）"));
    fireEvent.click(screen.getByRole("button", { name: "年表" }));
    expect(screen.getByText("表示中 2 件 ・ 出会いの記録 0 件")).toBeTruthy();
  });

  it("「すべて」タブは従来どおり重複しない", () => {
    renderTabs();
    fireEvent.click(tab("すべて（4）"));
    expect(screen.getByText("主催・運営したイベント（1）")).toBeTruthy();
    expect(screen.getByText("参加したイベント（1）")).toBeTruthy();
  });
});

describe("「すべて」タブ (#407)", () => {
  it("先頭に出るが、既定タブは「参加予定」のまま", () => {
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0].textContent).toBe("すべて（4）");
    expect(tab("参加予定（2）").getAttribute("aria-selected")).toBe("true");
    expect(tab("すべて（4）").getAttribute("aria-selected")).toBe("false");
  });

  it("中身はイベント系タブの合算で、旧4分類＋下書きのまとまりで出る", () => {
    renderTabs([...EVENTS, DRAFT]);
    fireEvent.click(tab("すべて（5）"));
    expect(screen.getByText("下書きのイベント（1）")).toBeTruthy();
    expect(screen.getByText("主催・運営するイベント（1）")).toBeTruthy();
    expect(screen.getByText("参加予定のイベント（1）")).toBeTruthy();
    expect(screen.getByText("主催・運営したイベント（1）")).toBeTruthy();
    expect(screen.getByText("参加したイベント（1）")).toBeTruthy();
  });

  it("他人のページの合算は公開分のみ（下書きのまとまりも出ない）", () => {
    renderTabs([...EVENTS, DRAFT], { isMe: false });
    fireEvent.click(tab("すべて（4）"));
    expect(screen.queryByText(/下書きのイベント/)).toBeNull();
    expect(screen.queryByText("下書きの回")).toBeNull();
    expect(screen.getByText("参加したイベント（1）")).toBeTruthy();
  });

  it("同じイベントが二重に来ても1回しか数えない・出さない", () => {
    renderTabs([...EVENTS, { ...EVENTS[3] }]);
    fireEvent.click(tab("すべて（4）"));
    expect(screen.getByText("参加したイベント（1）")).toBeTruthy();
  });

  it("?tab=all で URL に載り、開き直しでも選ばれる", () => {
    renderTabs();
    fireEvent.click(tab("すべて（4）"));
    expect(screen.getByTestId("loc").textContent).toBe("?tab=all");

    renderTabs(EVENTS, { url: "/users/tester2?tab=all" });
    expect(
      screen
        .getAllByRole("tab", { name: "すべて（4）" })
        .some((el) => el.getAttribute("aria-selected") === "true"),
    ).toBe(true);
  });

  it("一覧⇄年表の切替が効く（母集団は合算）", () => {
    renderTabs();
    fireEvent.click(tab("すべて（4）"));
    fireEvent.click(screen.getByRole("button", { name: "年表" }));
    expect(screen.getByText("参加履歴の年表")).toBeTruthy();
    expect(screen.getByText("表示中 4 件 ・ 出会いの記録 0 件")).toBeTruthy();
  });
});

describe("下書きタブ (#319, #348)", () => {
  it("本人かつ下書きがあるときだけタブが出て、注記を添える", () => {
    renderTabs([...EVENTS, DRAFT]);
    fireEvent.click(tab("下書き（1）"));
    expect(screen.getByText("下書きのイベント（1）")).toBeTruthy();
    expect(
      screen.getByText("まだ公開していません。あなたと運営だけが見られます。"),
    ).toBeTruthy();
    // カードにも印が付く
    expect(screen.getAllByText("下書き").length).toBeGreaterThan(0);
  });

  it("下書きは他のタブに混ざらない（主催予定でも主催タブに出ない）", () => {
    renderTabs([...EVENTS, DRAFT]);
    expect(tab("主催したイベント（2）")).toBeTruthy();
    fireEvent.click(tab("主催したイベント（2）"));
    expect(screen.queryByText("下書きの回")).toBeNull();
  });

  it("下書きが1件も無ければタブごと出さない", () => {
    renderTabs(EVENTS);
    expect(screen.queryByRole("tab", { name: /下書き/ })).toBeNull();
  });

  it("他人のページには下書きタブを出さない", () => {
    renderTabs([...EVENTS, DRAFT], { isMe: false });
    expect(screen.queryByRole("tab", { name: /下書き/ })).toBeNull();
  });

  it("他人のページで ?tab=drafts を開いても既定タブに落とす", () => {
    renderTabs(EVENTS, { isMe: false, url: "/users/tester?tab=drafts" });
    expect(tab("参加予定（2）").getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByText("参加予定の回").length).toBeGreaterThan(0);
  });
});

describe("メディアタブ", () => {
  it("タブを開くまで写真を取りに行かず、開くとギャラリーが出る", async () => {
    renderTabs();
    // ほかの部品（コミュニティ等）の取得は関知しない。写真だけを見る
    expect(getMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/public/users/tester/photos"),
    );

    getMock.mockResolvedValue({
      ...emptyPhotosPage,
      photos: [
        {
          id: "ph-1",
          eventId: "j-past",
          eventTitle: "参加した回",
          commentCount: 2,
          createdAt: NOW - 86400_000,
        },
      ],
      total: 1,
      facets: {
        events: [{ id: "j-past", title: "参加した回", count: 1 }],
        communities: [],
      },
    });
    fireEvent.click(tab("投稿したメディア"));
    expect(getMock).toHaveBeenCalledWith("/public/users/tester/photos?page=1");
    expect(await screen.findByText("投稿した写真（1）")).toBeTruthy();
    expect(
      document.querySelector('img[src="/api/events/j-past/photos/ph-1/image"]'),
    ).toBeTruthy();
  });

  it("写真が無ければ空メッセージを出す", async () => {
    renderTabs();
    fireEvent.click(tab("投稿したメディア"));
    expect(
      await screen.findByText("投稿したメディアはまだありません。"),
    ).toBeTruthy();
  });

  it("1ページに収まらなければページ番号が出て、送りは page パラメータで取りに行く", async () => {
    const photo = (i: number) => ({
      id: `ph-${i}`,
      eventId: "j-past",
      eventTitle: "参加した回",
      commentCount: 0,
      createdAt: NOW - i * 1000,
    });
    getMock.mockResolvedValue({
      ...emptyPhotosPage,
      photos: Array.from({ length: 24 }, (_v, i) => photo(i)),
      total: 30,
      hasMore: true,
      facets: {
        events: [{ id: "j-past", title: "参加した回", count: 30 }],
        communities: [],
      },
    });
    renderTabs();
    fireEvent.click(tab("投稿したメディア"));
    expect(await screen.findByText("投稿した写真（30）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        "/public/users/tester/photos?page=2",
      ),
    );
  });

  it("コメントありのみのトグルは commented=1 で取りに行き、1ページ目へ戻る", async () => {
    getMock.mockResolvedValue({
      ...emptyPhotosPage,
      photos: [
        {
          id: "ph-1",
          eventId: "j-past",
          eventTitle: "参加した回",
          commentCount: 2,
          createdAt: NOW,
        },
      ],
      total: 1,
      facets: {
        events: [{ id: "j-past", title: "参加した回", count: 1 }],
        communities: [],
      },
    });
    renderTabs();
    fireEvent.click(tab("投稿したメディア"));
    await screen.findByText("投稿した写真（1）");

    fireEvent.click(screen.getByText("コメントありのみ"));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        "/public/users/tester/photos?commented=1&page=1",
      ),
    );
  });
});

describe("空のタブ", () => {
  it("一覧が丸ごと空なら、本人には従来の空メッセージを出す", () => {
    renderTabs([]);
    expect(screen.getByText("参加中のイベントはありません。")).toBeTruthy();
  });

  it("一覧が丸ごと空なら、他人には公開実績なしの文言を出す", () => {
    renderTabs([], { isMe: false });
    expect(
      screen.getByText("公開イベントの実績はまだありません。"),
    ).toBeTruthy();
  });

  it("そのタブだけ空のときはタブ別の文言を出す", () => {
    renderTabs([ev({ id: "j-past", title: "参加した回" })]);
    expect(
      screen.getByText("参加予定のイベントはまだありません。"),
    ).toBeTruthy();
    fireEvent.click(tab("主催したイベント（0）"));
    expect(
      screen.getByText("主催・運営したイベントはまだありません。"),
    ).toBeTruthy();
  });
});
