import { describe, it, expect } from "vitest";
import type { EventMemberWithUser, User } from "@eventer/shared";
import { findMyMembership, isMyMembership } from "./eventMembership.js";

/**
 * 「この申込は自分のものか」の判定 (#466)。
 *
 * 以前は `m.userId` と `m.user.id` の2通りの綴りが画面のあちこちにあった。
 * どちらでも同じ答えになるのはサーバーがそう結合しているからで、型の保証では
 * ない。ここでは **membership 自身の `userId` を見ていること** を、2つの値を
 * わざと食い違わせて確かめる。`user.id` に戻したらこのテストが落ちる。
 */

function member(over: Partial<EventMemberWithUser> = {}): EventMemberWithUser {
  return {
    id: "m-1",
    eventId: "e-1",
    userId: "u-1",
    role: "participant",
    slotId: null,
    status: "confirmed",
    attended: false,
    attendedAt: null,
    createdAt: 1_700_000_000_000,
    user: { id: "u-1", username: "watashi" },
    ...over,
  } as EventMemberWithUser;
}

const ME = { id: "u-1", username: "watashi" } as User;

describe("自分の申込かの判定", () => {
  it("membership の userId が自分なら自分のもの", () => {
    expect(isMyMembership(member(), ME)).toBe(true);
  });

  it("別人の申込は自分のものではない", () => {
    expect(isMyMembership(member({ userId: "u-2" }), ME)).toBe(false);
  });

  it("未ログインでは誰の申込も自分のものにならない", () => {
    expect(isMyMembership(member(), null)).toBe(false);
    expect(isMyMembership(member(), undefined)).toBe(false);
  });

  it("見るのは membership の userId で、結合されてきた user.id ではない", () => {
    // 結合が崩れた（ありえないはずの）形。userId が正で、user は表示用の付随物
    const joinedToSomeoneElse = member({
      userId: "u-1",
      user: { id: "u-2", username: "hokanohito" } as User,
    });
    expect(isMyMembership(joinedToSomeoneElse, ME)).toBe(true);

    const mineByJoinOnly = member({
      userId: "u-2",
      user: { id: "u-1", username: "watashi" } as User,
    });
    expect(isMyMembership(mineByJoinOnly, ME)).toBe(false);
  });
});

describe("一覧から自分の申込を探す", () => {
  it("自分の行を返す", () => {
    const mine = member({ id: "m-2", userId: "u-1" });
    const found = findMyMembership(
      [member({ id: "m-1", userId: "u-9" }), mine],
      ME,
    );
    expect(found?.id).toBe("m-2");
  });

  it("読込前は undefined（参加していないと区別しない呼び出し側の都合に合わせる）", () => {
    expect(findMyMembership(undefined, ME)).toBeUndefined();
  });

  it("未ログインなら undefined", () => {
    expect(findMyMembership([member()], null)).toBeUndefined();
  });
});
