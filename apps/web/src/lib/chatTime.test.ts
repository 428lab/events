import { describe, expect, it } from "vitest";
import { formatChatTime } from "./chatTime.js";

/** メッセージ日時の表示。Nostr の created_at は**秒**（ミリ秒で渡すと未来になる） */
describe("formatChatTime", () => {
  it("秒を YYYY/MM/DD HH:mm:ss にする（各桁を0埋め）", () => {
    const t = new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000;
    expect(formatChatTime(t)).toBe("2026/01/02 03:04:05");
  });

  it("2桁の月日・時刻はそのまま出す", () => {
    const t = new Date(2026, 11, 31, 23, 59, 59).getTime() / 1000;
    expect(formatChatTime(t)).toBe("2026/12/31 23:59:59");
  });
});
