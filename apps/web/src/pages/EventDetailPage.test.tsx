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

/** 出席チェックは出さない設定で描画するので、この stub は使われない */
const setAttendance = { mutate: vi.fn(), isPending: false };

function draw(member: EventMemberWithUser = MEMBER) {
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
          attendanceCheck={false}
          isMe={false}
          setAttendance={
            setAttendance as unknown as Parameters<
              typeof MemberRow
            >[0]["setAttendance"]
          }
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
    // 何が起きるか（枠と申込の取消・再申込が必要）が文言に出ていること
    expect(confirm.mock.calls[0][0]).toMatch(/参加枠と申込を取り消し/);
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
