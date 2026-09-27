import { describe, expect, it } from "vitest";
import { liveChatAuthorized, liveChatRows, safeChatAvatar } from "./liveChat.js";

const member = { pubkey: "author", userId: "u1", username: "member", name: "投稿者", avatarUrl: "/api/users/u1/avatar?v=123", role: null };
const payload = { members: [member], channelId: "channel", chatEnabled: true, hiddenNoteIds: [] as string[], relays: ["wss://example.org"] };
const post = { id: "msg", pubkey: "author", content: "こんにちは", created_at: 1000, kind: 42, tags: [] as string[][], sig: "" };

describe("live event comments security", () => {
  it("requires fresh live state and membership and removes every row on OFF, failure or staleness", () => {
    expect(liveChatAuthorized({ chatSource: "event" }, 1000, false, 5000, payload, true)).toBe(true);
    for (const bad of [
      [{ chatSource: "off" }, 1000, false, 5000, payload, true],
      [{ chatSource: "event" }, 1000, true, 5000, payload, true],
      [{ chatSource: "event" }, 1000, false, 6001, payload, true],
      [{ chatSource: "event" }, 1000, false, 5000, payload, false],
      [{ chatSource: "event" }, 1000, false, 5000, undefined, true],
    ] as const) expect(liveChatAuthorized(bad[0], bad[1], bad[2], bad[3], bad[4], bad[5])).toBe(false);
  });
  it("maps only allowed relay posts to authorized member identity and strips blocked/hidden", () => {
    expect(liveChatRows([post], payload, 1_000_000, 3)[0]).toMatchObject({ name: "投稿者", avatar: member.avatarUrl, source: "event", plainText: "こんにちは" });
    expect(liveChatRows([post], { ...payload, members: [] }, 1_000_000, 3)).toEqual([]);
    expect(liveChatRows([post], { ...payload, hiddenNoteIds: ["msg"] }, 1_000_000, 3)).toEqual([]);
  });
  it("rejects foreign, impersonated or malformed avatar paths", () => {
    expect(safeChatAvatar(member)).toBe(member.avatarUrl);
    for (const avatarUrl of ["https://evil.test/a", "//evil.test/a", "/api/users/other/avatar?v=123", "/api/users/u1/avatar?v=bad", "/api/users/u1/avatar?v=123#fragment"]) expect(safeChatAvatar({ ...member, avatarUrl })).toBeNull();
  });
});
