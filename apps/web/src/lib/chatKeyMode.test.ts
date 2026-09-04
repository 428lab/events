import { afterEach, describe, expect, it, vi } from "vitest";
import { loadKeyMode, saveKeyMode } from "./chatKeyMode.js";

/**
 * 前回選んだ発言手段の記憶 (#332)。
 *
 * 守るのは3つ:
 * - イベントごとに別々に覚える（隣のイベントの選択に引きずられない）
 * - 知らない値・未設定は「まだ選んでいない」（既定の一時鍵に落ちる）
 * - localStorage を触れない環境でも参加そのものは壊れない
 */

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("loadKeyMode / saveKeyMode", () => {
  it("イベントごとに覚える", () => {
    saveKeyMode("e-1", "nip07");
    saveKeyMode("e-2", "ephemeral");
    expect(loadKeyMode("e-1")).toBe("nip07");
    expect(loadKeyMode("e-2")).toBe("ephemeral");
    expect(loadKeyMode("e-3")).toBeNull();
  });

  it("知らない値は「まだ選んでいない」扱いにする", () => {
    localStorage.setItem("eventer:chatKeyMode:e-1", "nsec1...");
    expect(loadKeyMode("e-1")).toBeNull();
  });

  it("読めない環境（例外を投げる）でも落ちず null を返す", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadKeyMode("e-1")).toBeNull();
  });

  it("書けない環境でも投げない（覚えないだけ）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveKeyMode("e-1", "nip07")).not.toThrow();
  });

  it("鍵そのものは書かない（保存する値は選択肢の名前だけ）", () => {
    saveKeyMode("e-1", "nip07");
    const stored = localStorage.getItem("eventer:chatKeyMode:e-1");
    expect(stored).toBe("nip07");
  });
});
