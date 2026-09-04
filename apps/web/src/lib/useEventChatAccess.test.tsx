import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, EventMemberWithUser } from "@eventer/shared";
import { useEventChatAccess } from "./useEventChatAccess.js";

/**
 * チャット/Q&A を開ける条件 (#215)。
 *
 * **この式の写しはもう他にない** (#335)。以前は `EventChat.tsx` が同じ判定を
 * 持っていて、呼び出し側の判定と二重になっていた。片方だけ直すと画面ごとに
 * 挙動がずれるので、いまはここが唯一の門になっている。だから各項を個別に
 * 確かめる: 1つ落としたらどれかのテストが落ちること。
 */

const ME = { id: "u-1", username: "me", name: "わたし" };

const EVENT = {
  id: "e-1",
  title: "テストイベント",
  status: "published",
  chatEnabled: true,
  scheduling: false,
  startsAt: 1_700_000_000_000,
  endsAt: 1_700_003_600_000,
} as unknown as Event;

const CONFIRMED = [
  { userId: "u-1", status: "confirmed" },
] as unknown as EventMemberWithUser[];

let members: EventMemberWithUser[] | undefined = CONFIRMED;
let myRole: string | null = null;
let event: Event = EVENT;

vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: ME }),
  useEvent: () => ({
    data: { event, myRole },
    isLoading: false,
    isError: false,
  }),
  useEventMembers: () => ({ data: members }),
}));

function access() {
  return renderHook(() => useEventChatAccess("e-1")).result.current;
}

beforeEach(() => {
  members = CONFIRMED;
  myRole = null;
  event = EVENT;
});

describe("chatAvailable の各項 (#215 / #335)", () => {
  it("参加確定・公開・日程確定・チャット有効なら開ける", () => {
    expect(access().chatAvailable).toBe(true);
  });

  it("日程が未確定（調整中）なら開けない", () => {
    event = { ...EVENT, scheduling: true } as Event;
    expect(access().chatAvailable).toBe(false);
  });

  it("開始日時が入っていなければ開けない", () => {
    event = { ...EVENT, startsAt: 0 } as Event;
    expect(access().chatAvailable).toBe(false);
  });

  it("チャットを無効にしたイベントでは開けない", () => {
    event = { ...EVENT, chatEnabled: false } as Event;
    expect(access().chatAvailable).toBe(false);
  });

  it("下書きのイベントでは開けない", () => {
    event = { ...EVENT, status: "draft" } as Event;
    expect(access().chatAvailable).toBe(false);
  });

  it("申込が確定していない人は開けない", () => {
    members = [
      { userId: "u-1", status: "pending" },
    ] as unknown as EventMemberWithUser[];
    expect(access().chatAvailable).toBe(false);
    expect(access().canChat).toBe(false);
  });

  it("申込は無いが役割がある人（スタッフ等）は開ける", () => {
    members = [];
    myRole = "staff";
    expect(access().canChat).toBe(true);
    expect(access().chatAvailable).toBe(true);
  });
});
