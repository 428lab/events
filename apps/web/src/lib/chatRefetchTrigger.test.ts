import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_REFETCH_THROTTLE_MS,
  createChatRefetchTrigger,
  newerKeyVersion,
} from "./chatRefetchTrigger.js";

/** D-POLL-MIN: チャットの許可リスト・鍵一式は定期の取り直しをやめ、
 * 知らない pubkey・新しい鍵世代の発言をきっかけに取り直す（部屋ごとに間引く） */

afterEach(() => vi.useRealTimers());

describe("createChatRefetchTrigger", () => {
  it("初めてのきっかけはすぐ取り直し、同じきっかけでは二度と取り直さない", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const trigger = createChatRefetchTrigger(refetch);
    trigger.request("pubkey:a");
    expect(refetch).toHaveBeenCalledTimes(1);
    trigger.request("pubkey:a");
    vi.advanceTimersByTime(CHAT_REFETCH_THROTTLE_MS * 2);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("間隔内に来た別のきっかけは、間隔の終わりにまとめて1回だけ取り直す", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const trigger = createChatRefetchTrigger(refetch);
    trigger.request("pubkey:a");
    for (let i = 0; i < 50; i++) trigger.request(`pubkey:spam-${i}`);
    expect(refetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHAT_REFETCH_THROTTLE_MS - 1);
    expect(refetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("dispose したら保留中の取り直しはしない", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const trigger = createChatRefetchTrigger(refetch);
    trigger.request("pubkey:a");
    trigger.request("pubkey:b");
    trigger.dispose();
    vi.advanceTimersByTime(CHAT_REFETCH_THROTTLE_MS * 2);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("newerKeyVersion", () => {
  it("手元のどの鍵より新しい世代だけを返す（古い世代・タグなし・壊れた値は null）", () => {
    expect(newerKeyVersion([["v", "3"]], [1, 2])).toBe(3);
    expect(newerKeyVersion([["v", "2"]], [1, 2])).toBeNull();
    expect(newerKeyVersion([["v", "1"]], [1, 2])).toBeNull();
    expect(newerKeyVersion([["p", "x"]], [1])).toBeNull();
    expect(newerKeyVersion([["v", "abc"]], [1])).toBeNull();
    expect(newerKeyVersion([["v", "1"]], [])).toBe(1);
  });
});
