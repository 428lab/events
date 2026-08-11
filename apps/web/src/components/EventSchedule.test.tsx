import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleItem } from "@eventer/shared";

/**
 * 「誰かが編集中」を**編集画面を開く前に**見せる (#340)。
 *
 * 上書きを実際に止めているのは保存時の版の突き合わせだが、それは弾かれて
 * 初めて分かる。分担の声かけができるように、編集を始める前の画面でも
 * 編集ボタンの隣に出す。ここが出ないと、2人が同時に編集を始めてから
 * 片方が弾かれる、という無駄が毎回起きる。
 */

const { getMock, putMock, postMock, delMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
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
      put: (...args: unknown[]) => putMock(...args),
      post: (...args: unknown[]) => postMock(...args),
      del: (...args: unknown[]) => delMock(...args),
    },
  };
});

const { EventSchedule } = await import("./EventSchedule.js");

const ME = { id: "u-1", username: "me", globalName: "わたし", avatarUrl: null };

const ITEM: ScheduleItem = {
  id: "it-1",
  eventId: "e-1",
  title: "オープニング",
  description: "",
  durationMin: 10,
  startsAt: null,
  speaker: null,
  speakerUserId: null,
  speakerName: "",
  materialUrl: "",
  materialOgImage: "",
  sortOrder: 0,
  placement: "all",
  trackIds: [],
};

/** 編集中ステータスの返り値。誰も編集していない状態が既定 */
let editingState: {
  editor: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    startedAt: number;
    expiresAt: number;
  } | null;
  version: number;
} = { editor: null, version: 3 };

function editor(userId: string, name: string) {
  return {
    editor: {
      userId,
      name,
      avatarUrl: null,
      startedAt: Date.now(),
      expiresAt: Date.now() + 120_000,
    },
    version: 3,
  };
}

function draw(isStaff: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventSchedule eventId="e-1" eventStartsAt={null} isStaff={isStaff} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  editingState = { editor: null, version: 3 };
  getMock.mockReset();
  putMock.mockReset();
  postMock.mockReset();
  delMock.mockReset();
  getMock.mockImplementation(async (path: string) => {
    if (path === "/auth/me") return { user: ME, isAdmin: false };
    if (path === "/events/e-1/timetable") {
      return { items: [ITEM], tracks: [], version: 3 };
    }
    if (path === "/events/e-1/timetable/editing") return editingState;
    if (path === "/events/e-1/members") return { members: [] };
    throw new Error(`unexpected path: ${path}`);
  });
  postMock.mockResolvedValue({ editor: null, version: 3 });
  delMock.mockResolvedValue({ editor: null, version: 3 });
});

describe("タイムテーブルの「編集中」表示 (#340)", () => {
  it("ほかの運営が編集中なら、編集ボタンの隣に名前つきで出る", async () => {
    editingState = editor("u-2", "アリス");
    draw(true);

    expect(await screen.findByText("アリスさんが編集中")).toBeTruthy();
  });

  it("表示名が取れない相手は名前を出さない", async () => {
    editingState = editor("u-2", "");
    draw(true);

    expect(await screen.findByText("ほかの運営メンバーが編集中")).toBeTruthy();
  });

  it("自分が編集中のときは出さない（閉じた直後は期限切れまで残るため）", async () => {
    editingState = editor(ME.id, "わたし");
    draw(true);

    // タイムテーブル自体は描かれている＝取得は終わっている
    expect(await screen.findByText("オープニング")).toBeTruthy();
    expect(screen.queryByText(/編集中$/)).toBeNull();
  });

  it("編集できない人には取りに行かない（返らない情報を叩き続けない）", async () => {
    editingState = editor("u-2", "アリス");
    draw(false);

    expect(await screen.findByText("オープニング")).toBeTruthy();
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/events/e-1/timetable"),
    );
    expect(getMock).not.toHaveBeenCalledWith("/events/e-1/timetable/editing");
    expect(screen.queryByText("アリスさんが編集中")).toBeNull();
  });
});

/**
 * 保存したあとに手元が持っている版 (#340)。
 *
 * 保存の返りを手元に置かないと、閉じてすぐ編集し直した人は**進む前の版**を
 * 掴む。誰とも衝突していないのに 409 で弾かれ、保存ボタンも押せなくなって
 * 行き止まりになる（1人で編集していても起きる）。
 */
describe("保存したあとの版 (#340)", () => {
  /** 編集画面を開いて保存する。送られた本文を返す */
  async function editAndSave(): Promise<{ version: number }> {
    fireEvent.click(
      screen.getByRole("button", { name: "タイムテーブルを編集" }),
    );
    const before = putMock.mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(putMock.mock.calls.length).toBe(before + 1),
    );
    return putMock.mock.calls.at(-1)![1] as { version: number };
  }

  it("保存して閉じ、すぐ編集し直しても、進んだあとの版で保存できる", async () => {
    putMock.mockResolvedValue({ items: [ITEM], tracks: [], version: 4 });
    draw(true);
    expect(await screen.findByText("オープニング")).toBeTruthy();

    expect((await editAndSave()).version).toBe(3);
    // 保存し終えると編集画面は閉じる
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "保存" })).toBeNull(),
    );

    // 取り直しを待たずに開き直しても、送るのは進んだあとの版
    expect((await editAndSave()).version).toBe(4);
  });
});
