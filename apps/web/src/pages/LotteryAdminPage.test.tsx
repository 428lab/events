import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { EventMemberWithUser, ParticipationSlot } from "@eventer/shared";

/**
 * 申込者の管理画面 (#286)。
 *
 * キャンセル待ち (waitlist) は先着枠でしか発生しないのに、この画面は抽選枠しか
 * 出していなかった。当日キャンセルが出てもキャンセル待ちの人を確定にする経路が
 * どこにも無く、参加者一覧の出席チェックも「先に確定にしてください」と言うだけで
 * 詰んでいた。先着枠もここで扱えること・抽選専用の操作が先着枠に出ないことを、
 * 実際に描画して確かめる。
 */

const { getMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      patch: (...args: unknown[]) => patchMock(...args),
    },
  };
});

const { LotteryAdminPage } = await import("./LotteryAdminPage.js");

const slot = (over: Partial<ParticipationSlot> = {}): ParticipationSlot => ({
  id: "s-1",
  eventId: "e-1",
  name: "一般枠",
  capacity: 1,
  selectionType: "first_come",
  sortOrder: 0,
  drawAt: null,
  confirmedCount: 1,
  waitlistCount: 1,
  appliedCount: 0,
  ...over,
});

/** 表示名。画面に出る文言の確認に使うので username とは別の字にしておく */
const NAMES: Record<string, string> = { alice: "アリス", bob: "ボブ" };

const member = (
  id: string,
  status: string,
  over: Partial<EventMemberWithUser> = {},
): EventMemberWithUser => ({
  id: `m-${id}`,
  eventId: "e-1",
  userId: id,
  role: "participant",
  slotId: "s-1",
  status,
  attended: false,
  attendedAt: null,
  createdAt: 1_700_000_000_000,
  user: {
    id,
    discordId: `d-${id}`,
    username: id,
    globalName: NAMES[id] ?? id,
    avatarUrl: null,
    createdAt: 1_700_000_000_000,
  },
  ...over,
});

function draw(slots: ParticipationSlot[], members: EventMemberWithUser[]) {
  getMock.mockImplementation((path: string) => {
    if (path === "/auth/me")
      return Promise.resolve({ user: { id: "staff-1" }, isAdmin: false });
    if (path === "/events/e-1")
      return Promise.resolve({
        event: { id: "e-1", title: "テストイベント" },
        myRole: "staff",
        community: null,
      });
    if (path === "/events/e-1/slots") return Promise.resolve({ slots });
    if (path === "/events/e-1/members") return Promise.resolve({ members });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/events/e-1/lottery"]}>
        <Routes>
          <Route path="/events/:id/lottery" element={<LotteryAdminPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** その人の行を取り出す（名前はプロフィールへのリンク。その親が1行分の Stack） */
function rowOf(name: string) {
  return within(screen.getByText(name).closest("a")!.parentElement!);
}

describe("申込者の管理: 先着枠も扱える (#286)", () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    patchMock.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("先着枠しかないイベントでも申込者が並び、キャンセル待ちを確定にできる", async () => {
    draw(
      [slot()],
      [member("alice", "confirmed"), member("bob", "waitlist")],
    );

    expect(await screen.findByText("一般枠")).toBeInTheDocument();
    expect(screen.getByText("先着順")).toBeInTheDocument();
    expect(screen.getByText("アリス")).toBeInTheDocument();
    expect(screen.getByText("ボブ")).toBeInTheDocument();

    // 定員1・確定1なので、確定にすると定員を超える → 超えることを伝えてから通す
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      rowOf("ボブ").getByRole("button", { name: "参加確定" }),
    );

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith(
      "/events/e-1/slots/s-1/members/bob/status",
      { status: "confirmed" },
    );
    expect(confirmSpy.mock.calls[0][0]).toMatch(/定員を超えます/);
  });

  it("席が空いていれば確認なしで確定にできる", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    draw(
      [slot({ capacity: 2, confirmedCount: 1 })],
      [member("alice", "confirmed"), member("bob", "waitlist")],
    );

    expect(await screen.findByText("ボブ")).toBeInTheDocument();
    fireEvent.click(rowOf("ボブ").getByRole("button", { name: "参加確定" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("定員超過の確認でキャンセルすると何も送らない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    draw([slot()], [member("alice", "confirmed"), member("bob", "waitlist")]);

    expect(await screen.findByText("ボブ")).toBeInTheDocument();
    fireEvent.click(
      rowOf("ボブ").getByRole("button", { name: "参加確定" }),
    );

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("先着枠には抽選の操作を出さない（自動抽選・落選）", async () => {
    draw([slot()], [member("bob", "waitlist")]);

    expect(await screen.findByText("ボブ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /自動抽選/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "落選" })).toBeNull();
    // 席を空ける操作はキャンセル待ちに戻すこと
    expect(
      rowOf("ボブ").getByRole("button", { name: "キャンセル待ち" }),
    ).toBeInTheDocument();
  });

  it("抽選枠では従来どおり自動抽選と当落を出す", async () => {
    draw(
      [
        slot({
          selectionType: "lottery",
          capacity: 5,
          confirmedCount: 0,
          waitlistCount: 0,
          appliedCount: 1,
        }),
      ],
      [member("bob", "applied")],
    );

    expect(await screen.findByText("ボブ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /自動抽選/ })).toBeInTheDocument();
    const row = rowOf("ボブ");
    expect(row.getByRole("button", { name: "当選" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "落選" })).toBeInTheDocument();
  });

  it("定員を超えている枠は一覧で分かる", async () => {
    draw(
      [slot({ capacity: 1, confirmedCount: 2, waitlistCount: 0 })],
      [member("alice", "confirmed"), member("bob", "confirmed")],
    );

    expect(await screen.findByText("定員超過")).toBeInTheDocument();
  });

  it("参加枠が無ければその旨を出す", async () => {
    draw([], []);
    expect(await screen.findByText("参加枠がありません。")).toBeInTheDocument();
  });

  it("断られたら理由を画面に出す", async () => {
    const { ApiError } = await import("../api/client.js");
    patchMock.mockRejectedValue(new ApiError(409, { error: "not_participant" }));
    draw(
      [slot({ capacity: 5, confirmedCount: 0 })],
      [member("bob", "waitlist")],
    );

    expect(await screen.findByText("ボブ")).toBeInTheDocument();
    fireEvent.click(
      rowOf("ボブ").getByRole("button", { name: "参加確定" }),
    );

    expect(
      await screen.findByText(/ボブ さんの参加状態を変更できませんでした/),
    ).toBeInTheDocument();
  });
});
