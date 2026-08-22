import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventTrack, ScheduleItem } from "@eventer/shared";

/**
 * タイムテーブルの見出し行に並ぶ2つのもの。
 *
 * - 「誰かが編集中」を**編集画面を開く前に**見せる (#340)。
 *   上書きを実際に止めているのは保存時の版の突き合わせだが、それは弾かれて
 *   初めて分かる。分担の声かけができるように、編集を始める前の画面でも
 *   編集ボタンの隣に出す。ここが出ないと、2人が同時に編集を始めてから
 *   片方が弾かれる、という無駄が毎回起きる。
 * - タイムテーブル画面への導線 (#338)。
 *   トラックが1本以下のイベントでは格子にする意味がないので出さない。
 *   ここが出っぱなしだと、トラックを使っていないイベントでも参加者が
 *   中身の無い画面へ飛ばされる。
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
  // 参加者にも見せるコマ。裏方 (#383) は visibility を staff にした行だけ
  visibility: "public",
  trackIds: [],
};

const track = (
  id: string,
  name: string,
  sortOrder: number,
  visibility: EventTrack["visibility"] = "public",
): EventTrack => ({
  id,
  name,
  sortOrder,
  visibility,
});

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

/** そのイベントのトラック。既定はトラックを使っていないイベント */
let tracks: EventTrack[] = [];

/** サーバーから返るコマ。裏方 (#383) は staff にしか入っていない状態で届く */
let items: ScheduleItem[] = [ITEM];

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
  tracks = [];
  items = [ITEM];
  getMock.mockReset();
  putMock.mockReset();
  postMock.mockReset();
  delMock.mockReset();
  getMock.mockImplementation(async (path: string) => {
    if (path === "/auth/me") return { user: ME, isAdmin: false };
    if (path === "/events/e-1/timetable") {
      return { items, tracks, version: 3 };
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

describe("タイムテーブル画面への導線 (#338)", () => {
  it("トラックが2本以上あるときだけ出す", async () => {
    tracks = [track("tr-a", "A", 0), track("tr-b", "B", 1)];
    draw(false);

    const link = await screen.findByRole("link", { name: /トラック別に見る/ });
    expect(link).toHaveAttribute("href", "/events/e-1/timetable");
  });

  it("トラックが1本のときは出さない", async () => {
    tracks = [track("tr-a", "A", 0)];
    draw(false);

    await screen.findByText("オープニング");
    expect(
      screen.queryByRole("link", { name: /トラック別に見る/ }),
    ).not.toBeInTheDocument();
  });

  it("トラックを使っていないイベントでは出さない", async () => {
    draw(false);

    await screen.findByText("オープニング");
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /トラック別に見る/ }),
      ).not.toBeInTheDocument(),
    );
  });

  /**
   * 導線 (#338) と編集中の表示 (#340) は同じ見出し行に並ぶ。
   * 片方を足すときにもう片方を落としやすいので、同時に出ることを見張る。
   */
  it("運営が見ていて他の人が編集中でも、導線と編集中の表示が両方出る", async () => {
    tracks = [track("tr-a", "A", 0), track("tr-b", "B", 1)];
    editingState = editor("u-2", "アリス");
    draw(true);

    expect(await screen.findByText("アリスさんが編集中")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /トラック別に見る/ }),
    ).toHaveAttribute("href", "/events/e-1/timetable");
    expect(
      screen.getByRole("button", { name: "タイムテーブルを編集" }),
    ).toBeTruthy();
  });
});

/**
 * 裏方の段取り (#383)。
 *
 * サーバーは staff にしか裏方を返さないので、届いている時点で見てよい人が
 * 見ている。**画面側では絞らない**（絞ると「参加者に見せない」の判断が
 * 2か所になる）。代わりに、参加者には出ない行だと分かる印を必ず付ける。
 */
describe("裏方の行 (#383)", () => {
  it("運営だけの段取りには、参加者には出ないと分かる印が付く", async () => {
    items = [ITEM, { ...ITEM, id: "it-2", title: "設営", visibility: "staff" }];
    draw(true);

    expect(await screen.findByText("設営")).toBeTruthy();
    expect(screen.getByText("運営のみ（参加者には出ません）")).toBeTruthy();
  });

  it("表のコマには印を付けない", async () => {
    draw(false);

    expect(await screen.findByText("オープニング")).toBeTruthy();
    expect(screen.queryByText("運営のみ（参加者には出ません）")).toBeNull();
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
    await waitFor(() => expect(putMock.mock.calls.length).toBe(before + 1));
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
