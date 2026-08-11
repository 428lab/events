import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { StaffInvite } from "@eventer/shared";

/**
 * 運営を招く側の画面 (#339)。
 *
 * 「誰が誰を招いたか」と「返事待ちかどうか」が読めること、返事待ち・断られた行を
 * 片付けられて承諾済みは片付けられないこと、断られた理由がその場で読めること、
 * 相手を候補から選べることを確かめる。
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

/** 招待一覧・参加者一覧・フォロー中を、呼ばれたパスで振り分けて返す */
function serve(opts: {
  invites?: StaffInvite[];
  members?: Array<{ id: string; role: string; user: ReturnType<typeof user> }>;
  following?: Array<ReturnType<typeof user>>;
}) {
  getMock.mockImplementation((path: string) => {
    if (path.endsWith("/staff-invites")) {
      return Promise.resolve({ invites: opts.invites ?? [] });
    }
    if (path.endsWith("/members")) {
      return Promise.resolve({ members: opts.members ?? [] });
    }
    return Promise.resolve({ following: opts.following ?? [] });
  });
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
    serve({ invites: [invite()] });
    draw();
    expect(await screen.findByText("@guest")).toBeTruthy();
    expect(screen.getByText("招待: こじら")).toBeTruthy();
    expect(screen.getByText("返事待ち")).toBeTruthy();
    expect(screen.getByText("取り消し")).toBeTruthy();
  });

  it("承諾済みは片付けられない（運営から外すのはロール変更の仕事）", async () => {
    serve({ invites: [invite({ status: "accepted", respondedAt: 2 })] });
    draw();
    expect(await screen.findByText("承諾")).toBeTruthy();
    expect(screen.queryByText("取り消し")).toBeNull();
    expect(screen.queryByText("一覧から消す")).toBeNull();
  });

  it("断られた行は一覧から消せる", async () => {
    serve({ invites: [invite({ status: "declined", respondedAt: 2 })] });
    delMock.mockResolvedValue({ invites: [] });
    draw();
    fireEvent.click(await screen.findByText("一覧から消す"));
    await waitFor(() =>
      expect(delMock).toHaveBeenCalledWith("/events/e-1/staff-invites/inv-1"),
    );
    expect(await screen.findByText("招待はまだありません。")).toBeTruthy();
  });

  it("ユーザー名で招待を送る", async () => {
    serve({});
    postMock.mockResolvedValue({ invites: [invite()] });
    draw();
    expect(await screen.findByText("招待はまだありません。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("名前かユーザー名で招待"), {
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

  it("参加者やフォロー中から選べる（すでに運営・招待済みは候補に出さない）", async () => {
    serve({
      invites: [invite({ id: "inv-2", user: user("u-sent", "sent", "招待済み") })],
      members: [
        { id: "m-1", role: "participant", user: user("u-p", "sanka", "参加者さん") },
        { id: "m-2", role: "staff", user: user("u-s", "unei", "運営さん") },
        { id: "m-3", role: "participant", user: user("u-sent", "sent", "招待済み") },
      ],
      following: [user("u-f", "follow", "フォロー中の人")],
    });
    draw();
    const input = await screen.findByLabelText("名前かユーザー名で招待");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const list = await screen.findByRole("listbox");
    expect(within(list).getByText("参加者さん")).toBeTruthy();
    expect(within(list).getByText("フォロー中の人")).toBeTruthy();
    // すでに運営／招待済みは選んでもエラーになるだけなので出さない
    expect(within(list).queryByText("運営さん")).toBeNull();
    expect(within(list).queryByText("招待済み")).toBeNull();
  });

  it("送れなかった理由がその場で読める", async () => {
    serve({});
    postMock.mockRejectedValue(new ApiError(404, { error: "user_not_found" }));
    draw();
    fireEvent.change(await screen.findByLabelText("名前かユーザー名で招待"), {
      target: { value: "nobody" },
    });
    fireEvent.click(screen.getByText("招待"));
    expect(
      await screen.findByText(/そのユーザー名の人が見つかりませんでした/),
    ).toBeTruthy();
  });

  it("1件を取り消している間も、他の行の操作は無効にならない", async () => {
    serve({
      invites: [
        invite(),
        invite({ id: "inv-2", user: user("u-2", "guest2", "ゲスト2") }),
      ],
    });
    // 応答を返さないまま保留にして「取り消し中」の状態を保つ
    delMock.mockImplementation(() => new Promise(() => {}));
    draw();
    const chips = await screen.findAllByText("取り消し");
    expect(chips).toHaveLength(2);
    fireEvent.click(chips[0]!);
    await waitFor(() => expect(delMock).toHaveBeenCalledTimes(1));
    // 2件目を押せば、そちらの取り消しも走る
    fireEvent.click(screen.getAllByText("取り消し")[1]!);
    await waitFor(() => expect(delMock).toHaveBeenCalledTimes(2));
    expect(delMock).toHaveBeenLastCalledWith("/events/e-1/staff-invites/inv-2");
  });
});
