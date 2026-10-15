import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Community, EventCohost } from "@eventer/shared";

/**
 * 運営ページの共催コミュニティ (#625)。
 *
 * 一覧から選んで追加できること（自分が管理するコミュニティが先頭で「すぐ共催」、
 * 主催・追加済みは出ない、名前で絞り込める、URL を貼っても選べる）、状態（承認待ち/共催中）が
 * 読めること、確認してから外すこと、断られた理由がその場で読めること、上限で追加できなく
 * なることを確かめる。
 */

const { getMock, postMock, delMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
      del: (...args: unknown[]) => delMock(...args),
    },
  };
});

const { EventCohostsCard } = await import("./EventCohostsCard.js");
const { ApiError } = await import("../api/client.js");

function cohost(over: Partial<EventCohost> = {}): EventCohost {
  return {
    communityId: "c-1",
    slug: "alpha",
    name: "アルファ会",
    iconUrl: null,
    status: "pending",
    createdAt: 1,
    respondedAt: null,
    ...over,
  };
}

function community(id: string, slug: string, name: string): Community {
  return {
    id,
    slug,
    name,
    description: "",
    iconUrl: null,
    bannerUrl: null,
    links: [],
    ownerId: "u-x",
    createdAt: 1,
    memberCount: 1,
    eventCount: 0,
  };
}

const HOST = community("c-host", "host", "主催会");
const MINE = community("c-mine", "mine", "自分の会");
const MINE_ADDED = community("c-1", "alpha", "アルファ会");
const OTHER = community("c-other", "other", "よその会");
const OTHER2 = community("c-other2", "gamma", "ガンマ会");

function serve(
  cohosts: EventCohost[],
  opts: { mine?: Community[]; all?: Community[] } = {},
) {
  const mine = opts.mine ?? [MINE, MINE_ADDED, HOST];
  const all = opts.all ?? [HOST, MINE, MINE_ADDED, OTHER, OTHER2];
  getMock.mockImplementation(async (path: string) => {
    if (path === "/communities/mine") return { communities: mine };
    if (path === "/public/communities") return { communities: all };
    return { cohosts };
  });
}

function draw(qc = new QueryClient({
  defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
})) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventCohostsCard eventId="e-1" hostCommunityId="c-host" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const field = () => screen.getByRole("combobox", { name: "共催コミュニティを追加" });

/** 検索欄を開いて候補の名前を上から順に返す */
async function openCandidates(): Promise<string[]> {
  fireEvent.mouseDown(field());
  const list = await screen.findByRole("listbox");
  return within(list)
    .getAllByTestId("cohost-candidate-name")
    .map((el) => el.textContent ?? "");
}

function typeAndEnter(text: string) {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  delMock.mockReset();
});

describe("共催コミュニティ（運営ページ） (#625)", () => {
  it("権限が付かないことの補足と、承認待ち・共催中の状態が読める", async () => {
    serve([
      cohost({ communityId: "c-2", slug: "beta", name: "ベータ会", status: "accepted", respondedAt: 2 }),
      cohost(),
    ]);
    draw();
    expect(
      screen.getByText(
        "共催コミュニティには運営の権限は付きません。運営に入ってほしい人は運営スタッフ招待で招いてください。",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("ベータ会")).toBeTruthy();
    expect(screen.getByText("共催中")).toBeTruthy();
    expect(screen.getByText("承認待ち")).toBeTruthy();
  });

  it("自分が管理するコミュニティが先に「すぐ共催」で並び、主催と追加済みは出ない", async () => {
    serve([cohost()]);
    draw();
    await screen.findByText("アルファ会");
    await waitFor(async () => expect(await openCandidates()).toEqual(["自分の会", "よその会", "ガンマ会"]));
    const list = screen.getByRole("listbox");
    expect(within(list).getByText("自分が管理しているコミュニティ")).toBeTruthy();
    expect(within(list).getByText("ほかのコミュニティ")).toBeTruthy();
    const [own, other] = within(list).getAllByTestId("cohost-candidate");
    expect(within(own!).getByText("すぐ共催")).toBeTruthy();
    expect(within(own!).getByText("/c/mine")).toBeTruthy();
    expect(within(other!).getByText("承認待ちで依頼")).toBeTruthy();
    expect(within(list).queryByText("主催会")).toBeNull();
    expect(
      screen.getByText(
        "自分が管理しているコミュニティは、承認なしですぐ共催になります。一覧に無いコミュニティは、URL か slug を入れて Enter で依頼できます。",
      ),
    ).toBeTruthy();
  });

  it("名前で絞り込める", async () => {
    serve([]);
    draw();
    await screen.findByText("共催コミュニティはありません。");
    await waitFor(async () => expect(await openCandidates()).toHaveLength(4));
    fireEvent.change(field(), { target: { value: "ガンマ" } });
    await waitFor(() =>
      expect(screen.getAllByTestId("cohost-candidate").map((li) => li.textContent)).toEqual([
        expect.stringContaining("ガンマ会"),
      ]),
    );
  });

  it("自分のコミュニティを選ぶとすぐ追加され、「追加しました」と出る", async () => {
    serve([]);
    postMock.mockResolvedValue({
      status: "accepted",
      cohosts: [cohost({ communityId: "c-mine", slug: "mine", name: "自分の会", status: "accepted", respondedAt: 2 })],
    });
    draw();
    await screen.findByText("共催コミュニティはありません。");
    await waitFor(async () => expect(await openCandidates()).toContain("自分の会"));
    fireEvent.click(screen.getAllByTestId("cohost-candidate")[0]!);
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/events/e-1/cohosts", { slug: "mine" }));
    expect(await screen.findByText("自分の会 を共催に追加しました。")).toBeTruthy();
    expect(screen.getByText("共催中")).toBeTruthy();
  });

  it("ほかのコミュニティを選ぶと依頼になり、「承認されると共催になります」と出る", async () => {
    serve([]);
    postMock.mockResolvedValue({
      status: "pending",
      cohosts: [cohost({ communityId: "c-other", slug: "other", name: "よその会" })],
    });
    draw();
    await screen.findByText("共催コミュニティはありません。");
    await waitFor(async () => expect(await openCandidates()).toContain("よその会"));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("よその会"));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/events/e-1/cohosts", { slug: "other" }));
    expect(
      await screen.findByText("よその会 に共催を依頼しました。承認されると共催になります。"),
    ).toBeTruthy();
  });

  it("URL を貼って Enter すると、一覧にあればそのコミュニティを選ぶ", async () => {
    serve([]);
    postMock.mockResolvedValue({ status: "pending", cohosts: [cohost({ communityId: "c-other2", slug: "gamma", name: "ガンマ会" })] });
    draw();
    await screen.findByText("共催コミュニティはありません。");
    await waitFor(async () => expect(await openCandidates()).toHaveLength(4));
    typeAndEnter(" https://example.com/c/gamma/ ");
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/events/e-1/cohosts", { slug: "gamma" }));
    expect(await screen.findByText("ガンマ会 に共催を依頼しました。承認されると共催になります。")).toBeTruthy();
    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("一覧に無い URL か slug は、そのまま依頼として送る", async () => {
    serve([]);
    postMock.mockResolvedValue({ status: "pending", cohosts: [cohost({ communityId: "c-z", slug: "zeta", name: "ゼータ会" })] });
    draw();
    await screen.findByText("共催コミュニティはありません。");
    await waitFor(async () => expect(await openCandidates()).toHaveLength(4));
    typeAndEnter("https://example.com/c/zeta");
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/events/e-1/cohosts", { slug: "https://example.com/c/zeta" }),
    );
  });

  it.each([
    ["community_not_found", 404, "そのコミュニティは見つかりませんでした。URL か slug を確かめてください。"],
    ["host_community", 400, "主催のコミュニティは共催にできません。"],
    ["already_cohost", 409, "そのコミュニティには依頼済みか、すでに共催中です。"],
    ["cohost_limit", 400, "共催コミュニティは 5 件までです。"],
  ])("断られた理由（%s）がその場で読める", async (code, status, message) => {
    serve([]);
    postMock.mockRejectedValue(new ApiError(status, { error: code }));
    draw();
    await screen.findByText("共催コミュニティはありません。");
    await waitFor(async () => expect(await openCandidates()).toHaveLength(4));
    typeAndEnter("no-such-community");
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("上限（5 件）に達したら追加を止めて理由を出す", async () => {
    serve(
      Array.from({ length: 5 }, (_, i) =>
        cohost({ communityId: `c-${i}`, slug: `s-${i}`, name: `会${i}` }),
      ),
    );
    draw();
    expect(
      await screen.findByText("共催コミュニティは 5 件までです。追加するには、どれかを外してください。"),
    ).toBeTruthy();
    expect(field()).toBeDisabled();
  });

  it("外すときは確認してから消す。キャンセルすれば何もしない", async () => {
    serve([cohost({ status: "accepted", respondedAt: 2 })]);
    delMock.mockResolvedValue({ cohosts: [] });
    draw();
    fireEvent.click(await screen.findByText("外す"));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("共催から外しますか？")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(delMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("外す"));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(delMock).toHaveBeenCalledWith("/events/e-1/cohosts/c-1"));
    expect(await screen.findByText("共催コミュニティはありません。")).toBeTruthy();
  });

  it("外したあと、詳細と共催先のコミュニティページの一覧・一覧検索を取り直させる", async () => {
    serve([cohost({ status: "accepted", respondedAt: 2 })]);
    delMock.mockResolvedValue({ cohosts: [] });
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    draw(qc);
    fireEvent.click(await screen.findByText("外す"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    const filters = spy.mock.calls.map((c) => c[0]!);
    expect(filters).toContainEqual({ queryKey: ["event", "e-1", "viewer"] });
    expect(filters).toContainEqual({ queryKey: ["communityEventSearch"] });
    const predicate = filters.find((f) => f.predicate)!.predicate!;
    const q = (queryKey: unknown[]) => ({ queryKey }) as unknown as Parameters<typeof predicate>[0];
    expect(predicate(q(["community", "alpha", "viewer", "u-1"]))).toBe(true);
    expect(predicate(q(["community", "alpha", "members"]))).toBe(false);
  });
});
