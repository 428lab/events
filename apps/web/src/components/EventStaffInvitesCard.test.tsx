import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { StaffInvite } from "@eventer/shared";

/**
 * 運営を招く側の画面 (#339)。
 *
 * 「誰が誰を招いたか」と「返事待ちかどうか」が読めること、返事待ちのものだけ
 * 取り消せること、断られた理由がその場で読めることを確かめる。
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

const { EventStaffInvitesCard } = await import("./EventStaffInvitesCard.js");
const { ApiError } = await import("../api/client.js");

function user(id: string, username: string, globalName: string) {
  return {
    id,
    discordId: `d-${id}`,
    username,
    globalName,
    avatarUrl: null,
    createdAt: 0,
  };
}

function invite(over: Partial<StaffInvite> = {}): StaffInvite {
  return {
    id: "inv-1",
    eventId: "e-1",
    status: "pending",
    createdAt: 1,
    respondedAt: null,
    user: user("u-guest", "guest", "ゲスト"),
    invitedBy: user("u-owner", "kojira", "こじら"),
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
        <EventStaffInvitesCard eventId="e-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  delMock.mockReset();
});

describe("運営を招く (#339)", () => {
  it("誰が誰を招いたかと返事待ちであることが読める", async () => {
    getMock.mockResolvedValue({ invites: [invite()] });
    draw();
    expect(await screen.findByText("@guest")).toBeTruthy();
    expect(screen.getByText("招待: こじら")).toBeTruthy();
    expect(screen.getByText("返事待ち")).toBeTruthy();
    expect(screen.getByText("取り消し")).toBeTruthy();
  });

  it("承諾済みは取り消せない（運営から外すのはロール変更の仕事）", async () => {
    getMock.mockResolvedValue({
      invites: [invite({ status: "accepted", respondedAt: 2 })],
    });
    draw();
    expect(await screen.findByText("承諾")).toBeTruthy();
    expect(screen.queryByText("取り消し")).toBeNull();
  });

  it("ユーザー名で招待を送る", async () => {
    getMock.mockResolvedValue({ invites: [] });
    postMock.mockResolvedValue({ invites: [invite()] });
    draw();
    expect(await screen.findByText("招待はまだありません。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ユーザー名で招待"), {
      target: { value: " guest " },
    });
    fireEvent.click(screen.getByText("招待"));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/events/e-1/staff-invites", {
        handle: "guest",
      }),
    );
    expect(await screen.findByText("@guest")).toBeTruthy();
  });

  it("送れなかった理由がその場で読める", async () => {
    getMock.mockResolvedValue({ invites: [] });
    postMock.mockRejectedValue(new ApiError(404, { error: "user_not_found" }));
    draw();
    fireEvent.change(await screen.findByLabelText("ユーザー名で招待"), {
      target: { value: "nobody" },
    });
    fireEvent.click(screen.getByText("招待"));
    expect(
      await screen.findByText(/そのユーザー名の人が見つかりませんでした/),
    ).toBeTruthy();
  });

  it("返事待ちの招待を取り消せる", async () => {
    getMock.mockResolvedValue({ invites: [invite()] });
    delMock.mockResolvedValue({ invites: [] });
    draw();
    fireEvent.click(await screen.findByText("取り消し"));
    await waitFor(() =>
      expect(delMock).toHaveBeenCalledWith("/events/e-1/staff-invites/inv-1"),
    );
    expect(await screen.findByText("招待はまだありません。")).toBeTruthy();
  });
});
