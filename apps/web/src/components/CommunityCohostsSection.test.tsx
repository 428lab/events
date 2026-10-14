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

function draw() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
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
});
