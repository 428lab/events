import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CommunityCohost } from "@eventer/shared";

/**
 * コミュニティ編集ページの共催 (#625)。
 *
 * 届いた依頼を承諾・辞退でき、共催中のものは確認してからやめられること、
 * 何も無ければその旨が出ることを確かめる。
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

const { CommunityCohostsSection } = await import("./CommunityCohostsSection.js");

function cohost(over: Partial<CommunityCohost> = {}): CommunityCohost {
  return {
    eventId: "e-1",
    eventTitle: "横断もくもく会",
    eventStartsAt: 0,
    eventStatus: "draft",
    eventVisibility: "public",
    hostCommunityName: "主催コミュ",
    status: "pending",
    createdAt: 1,
    respondedAt: null,
    ...over,
  };
}

function draw(qc = new QueryClient({
  defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
})) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CommunityCohostsSection communityId="c-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  delMock.mockReset();
});

describe("共催（コミュニティ編集） (#625)", () => {
  it("依頼が無ければその旨を出す", async () => {
    getMock.mockResolvedValue({ cohosts: [] });
    draw();
    expect(await screen.findByText("共催の依頼はありません。")).toBeTruthy();
  });

  it("依頼中はイベント名・主催・日時が読め、承諾できる", async () => {
    getMock.mockResolvedValue({ cohosts: [cohost()] });
    postMock.mockResolvedValue({ cohosts: [cohost({ status: "accepted", respondedAt: 2 })] });
    draw();
    expect(await screen.findByText("横断もくもく会")).toBeTruthy();
    expect(screen.getByText("依頼中")).toBeTruthy();
    expect(screen.getByText(/主催: 主催コミュ/)).toBeTruthy();
    expect(screen.getByText(/日程未定/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "承諾" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/communities/c-1/cohosts/e-1/accept"),
    );
    expect(await screen.findByText("共催中")).toBeTruthy();
    expect(screen.getByRole("button", { name: "共催をやめる" })).toBeTruthy();
  });

  it("依頼を辞退できる", async () => {
    getMock.mockResolvedValue({ cohosts: [cohost()] });
    delMock.mockResolvedValue({ cohosts: [] });
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "辞退" }));
    await waitFor(() => expect(delMock).toHaveBeenCalledWith("/communities/c-1/cohosts/e-1"));
  });

  it("共催中のものは確認してからやめる", async () => {
    getMock.mockResolvedValue({
      cohosts: [cohost({ status: "accepted", respondedAt: 2, eventStatus: "published" })],
    });
    delMock.mockResolvedValue({ cohosts: [] });
    draw();
    expect(await screen.findByText("共催中")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "承諾" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "共催をやめる" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("共催をやめますか？")).toBeTruthy();
    expect(delMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "共催をやめる" }));
    await waitFor(() => expect(delMock).toHaveBeenCalledWith("/communities/c-1/cohosts/e-1"));
  });

  it("閲覧できないイベント（題名・日時が null）は汎用の表示にし、承諾・辞退はそのまま使える", async () => {
    getMock.mockResolvedValue({
      cohosts: [cohost({ eventTitle: null, eventStartsAt: null, hostCommunityName: null })],
    });
    postMock.mockResolvedValue({ cohosts: [] });
    draw();
    expect(await screen.findByText("非公開のイベント")).toBeTruthy();
    expect(screen.queryByText(/日程未定/)).toBeNull();
    expect(screen.queryByText(/主催:/)).toBeNull();
    expect(screen.getByRole("button", { name: "辞退" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "承諾" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/communities/c-1/cohosts/e-1/accept"),
    );
  });

  it("共催中の伏せた行もやめられ、確認には汎用の名前が出る", async () => {
    getMock.mockResolvedValue({
      cohosts: [
        cohost({ eventTitle: null, eventStartsAt: null, hostCommunityName: null, status: "accepted", respondedAt: 2, eventStatus: "published", eventVisibility: "private" }),
      ],
    });
    delMock.mockResolvedValue({ cohosts: [] });
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "共催をやめる" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/「非公開のイベント」の共催をやめます/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "共催をやめる" }));
    await waitFor(() => expect(delMock).toHaveBeenCalledWith("/communities/c-1/cohosts/e-1"));
  });

  it("下書き・公開範囲をチップで添える（公開済み・公開は出さない）", async () => {
    getMock.mockResolvedValue({
      cohosts: [
        cohost({ eventId: "e-draft", eventTitle: "下書きの会", eventStatus: "draft", eventVisibility: "public" }),
        cohost({ eventId: "e-private", eventTitle: "招待の会", eventStatus: "published", eventVisibility: "private" }),
        cohost({ eventId: "e-unlisted", eventTitle: "URLの会", eventStatus: "published", eventVisibility: "unlisted" }),
        cohost({ eventId: "e-public", eventTitle: "公開の会", eventStatus: "published", eventVisibility: "public" }),
      ],
    });
    draw();
    expect(await screen.findByText("下書きの会")).toBeTruthy();
    expect(screen.getAllByText("下書き")).toHaveLength(1);
    expect(screen.getAllByText("招待限定")).toHaveLength(1);
    expect(screen.getAllByText("限定公開（URLを知る人）")).toHaveLength(1);
    // 公開・公開済みの行にはチップが無い
    const publicRow = screen.getByText("公開の会").parentElement!;
    expect(publicRow.querySelectorAll(".MuiChip-root")).toHaveLength(0);
  });

  it("承諾・辞退のあと、コミュニティページの一覧と一覧検索を取り直させる（この一覧そのものは取り直さない）", async () => {
    getMock.mockResolvedValue({ cohosts: [cohost()] });
    postMock.mockResolvedValue({ cohosts: [cohost({ status: "accepted", respondedAt: 2 })] });
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    draw(qc);
    fireEvent.click(await screen.findByRole("button", { name: "承諾" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const filters = spy.mock.calls.map((c) => c[0]!);
    expect(filters).toContainEqual({ queryKey: ["communityEventSearch"] });
    const predicate = filters.find((f) => f.predicate)!.predicate!;
    const q = (queryKey: unknown[]) => ({ queryKey }) as unknown as Parameters<typeof predicate>[0];
    expect(predicate(q(["community", "group", "viewer", "u-1"]))).toBe(true);
    expect(predicate(q(["community", "group", "viewer", undefined]))).toBe(true);
    expect(predicate(q(["community", "c-1", "cohosts"]))).toBe(false);
    expect(predicate(q(["community", "group", "members"]))).toBe(false);
  });
});
