import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EventCohost } from "@eventer/shared";

/**
 * 運営ページの共催コミュニティ (#625)。
 *
 * 依頼を送れること、状態（承認待ち/共催中）が読めること、確認してから外すこと、
 * 断られた理由がその場で読めること、上限で追加できなくなることを確かめる。
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

function serve(cohosts: EventCohost[]) {
  getMock.mockResolvedValue({ cohosts });
}

function draw() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventCohostsCard eventId="e-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const field = () => screen.getByLabelText("コミュニティの URL か slug");
const sendButton = () => screen.getByRole("button", { name: "共催を依頼" });

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

  it("URL か slug で依頼を送る", async () => {
    serve([]);
    postMock.mockResolvedValue({ cohosts: [cohost()] });
    draw();
    expect(await screen.findByText("共催コミュニティはありません。")).toBeTruthy();
    fireEvent.change(field(), { target: { value: " https://example.com/c/alpha " } });
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/events/e-1/cohosts", {
        slug: "https://example.com/c/alpha",
      }),
    );
    expect(await screen.findByText("アルファ会")).toBeTruthy();
    expect((field() as HTMLInputElement).value).toBe("");
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
    fireEvent.change(field(), { target: { value: "alpha" } });
    fireEvent.click(sendButton());
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
    expect(sendButton()).toBeDisabled();
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
});
