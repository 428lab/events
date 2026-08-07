import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { EventMemberWithUser } from "@eventer/shared";

/**
 * ロール変更メニューの破壊的操作の確認 (#281)。
 *
 * 一般参加者に戻す操作は「参加の取消」なので、押した瞬間に申込が消える。
 * 無言で消さないこと（確認を挟むこと）と、キャンセルしたら本当に何も
 * 起きないことを、実際に描画して確かめる。他のロールへの変更は破壊的では
 * ないので確認を挟まない（頻度が高く、毎回聞かれると邪魔になる）。
 */

// vi.mock はファイル先頭へ巻き上げられるので、参照する変数も一緒に巻き上げる
const { patchMock } = vi.hoisted(() => ({ patchMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, patch: (...args: unknown[]) => patchMock(...args) },
  };
});

const { MemberRow } = await import("./EventDetailPage.js");
const { ApiError } = await import("../api/client.js");

const MEMBER: EventMemberWithUser = {
  id: "m-1",
  eventId: "e-1",
  userId: "u-1",
  role: "staff",
  slotId: null,
  status: "confirmed",
  attended: false,
  attendedAt: null,
  createdAt: 1_700_000_000_000,
  user: {
    id: "u-1",
    discordId: "d-1",
    username: "sutaffu",
    globalName: "運営の人",
    avatarUrl: null,
    createdAt: 1_700_000_000_000,
  },
};

function draw(
  member: EventMemberWithUser = MEMBER,
  attendanceCheck = false,
) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MemberRow
          eventId="e-1"
          member={member}
          isStaff
          attendanceCheck={attendanceCheck}
          isMe={false}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** ロール変更メニューを開いて、指定したロールを選ぶ */
function pickRole(label: string): void {
  fireEvent.click(screen.getByTitle("ロールを変更"));
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) }));
}

describe("ロール変更メニューの確認 (#281)", () => {
  beforeEach(() => {
    patchMock.mockReset();
    patchMock.mockResolvedValue({ member: null, promotedUserId: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("一般参加者に戻すときは確認を出し、キャンセルすると何も起きない", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    draw();

    pickRole("参加者");

    expect(confirm).toHaveBeenCalledTimes(1);
    // 何が起きるか（枠と申込の取消・戻せない削除・再申込が必要）が文言に出ていること
    expect(confirm.mock.calls[0][0]).toMatch(/参加枠と申込を取り消し/);
    expect(confirm.mock.calls[0][0]).toMatch(/事前アンケートの回答も削除/);
    expect(confirm.mock.calls[0][0]).toMatch(/改めて申し込む/);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("確認でOKしたときだけ変更が送られる（対になる確認）", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    draw();

    pickRole("参加者");

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith("/events/e-1/members/u-1/role", {
      role: "participant",
    });
  });

  it("他のロールへの変更では確認を挟まない", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    draw({ ...MEMBER, role: "participant" });

    pickRole("審査員");

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith("/events/e-1/members/u-1/role", {
      role: "judge",
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("最後のスタッフを降ろせなかった理由が画面に出る", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    patchMock.mockRejectedValue(new ApiError(409, { error: "last_staff" }));
    draw();

    pickRole("参加者");

    // 「押しても何も起きない」に見せない。理由と次にやることまで出す
    expect(
      await screen.findByText(
        /最後のスタッフです。先に別の人をスタッフにしてください。/,
      ),
    ).toBeInTheDocument();
  });
});

/**
 * 出席チェックは参加確定の人だけ (#286)。
 *
 * サーバーが落選・申込中・キャンセル待ちを拒否するようになったので、画面側でも
 * 押せないようにする。ただし押せないだけだと「反応しない」に見えるので、
 * 理由（今の参加状態と、先に確定にすること）が読めることまで確かめる。
 */
describe("出席チェックの対象 (#286)", () => {
  beforeEach(() => {
    patchMock.mockReset();
    patchMock.mockResolvedValue({ member: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const attendCheckbox = () => screen.getByRole("checkbox");

  it("参加確定の人はチェックできる", async () => {
    draw({ ...MEMBER, status: "confirmed" }, true);

    const box = attendCheckbox();
    expect(box).not.toBeDisabled();
    fireEvent.click(box);

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith(
      "/events/e-1/members/u-1/attendance",
      { attended: true },
    );
  });

  it.each([
    ["lost", "落選"],
    ["applied", "抽選申込中"],
    ["waitlist", "キャンセル待ち"],
  ])("%s は押せず、理由が読める", (status, label) => {
    draw({ ...MEMBER, status }, true);

    const box = attendCheckbox();
    expect(box).toBeDisabled();
    // 無言で押せないのではなく、今の状態と次にやることが分かること
    const reason = box.getAttribute("aria-label") ?? "";
    expect(reason).toMatch(new RegExp(label));
    expect(reason).toMatch(/「申込者の管理」で先に参加を確定にしてください/);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("押せないときは、キーボードだけでも理由にたどり着ける", () => {
    draw({ ...MEMBER, status: "lost" }, true);

    // 無効なチェックボックスはフォーカスを受け取らないので、包む要素を
    // フォーカス可能にしておかないとツールチップを開く手段が無くなる
    const wrapper = attendCheckbox().closest('span[tabindex="0"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("aria-label")).toMatch(
      /「申込者の管理」で先に参加を確定にしてください/,
    );
  });

  it("押せる行にはフォーカスの寄り道を作らない", () => {
    draw({ ...MEMBER, status: "confirmed" }, true);
    expect(attendCheckbox().closest('span[tabindex="0"]')).toBeNull();
  });

  it("確定でなくても既に出席が付いていれば解除できる", async () => {
    draw({ ...MEMBER, status: "lost", attended: true }, true);

    const box = attendCheckbox();
    expect(box).not.toBeDisabled();
    fireEvent.click(box);

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith(
      "/events/e-1/members/u-1/attendance",
      { attended: false },
    );
  });

  it("サーバーに断られた理由が画面に出る（一覧を開いたまま状態が変わった場合）", async () => {
    patchMock.mockRejectedValue(new ApiError(409, { error: "not_confirmed" }));
    draw({ ...MEMBER, status: "confirmed" }, true);

    fireEvent.click(attendCheckbox());

    expect(
      await screen.findByText(
        /参加が確定している人だけ出席にできます。参加枠の「申込者の管理」で先に参加を確定にしてください。/,
      ),
    ).toBeInTheDocument();
  });
});
