import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safeRedirect.js";

/**
 * ログイン後の戻り先の検証 (#330)。
 * QR経由の入口 `/m/<token>` がこの経路を通るので、外部サイトへの
 * 踏み台にならないことを固定しておく。
 */

describe("ログイン後の戻り先", () => {
  it("同一オリジンのパスは通す", () => {
    expect(safeRedirectPath("/m/mt1.abc")).toBe("/m/mt1.abc");
    expect(safeRedirectPath("/events/1?tab=x#y")).toBe("/events/1?tab=x#y");
  });

  it("プロトコル相対URLで外部へ飛ばせない", () => {
    // 先頭が "/" でも外部オリジンに解決される書き方
    expect(safeRedirectPath("//evil.example")).toBeNull();
    expect(safeRedirectPath("//evil.example/path")).toBeNull();
    expect(safeRedirectPath("/\\evil.example")).toBeNull();
    expect(safeRedirectPath("/\\/evil.example")).toBeNull();
  });

  it("絶対URLや空はすべて弾く", () => {
    expect(safeRedirectPath("https://evil.example/x")).toBeNull();
    expect(safeRedirectPath("javascript:alert(1)")).toBeNull();
    expect(safeRedirectPath("m/token")).toBeNull();
    expect(safeRedirectPath("")).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
  });
});
