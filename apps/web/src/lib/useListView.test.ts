import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readListView, useListView } from "./useListView.js";

/** 一覧の見せ方の保持 (#488)。既定は従来のリスト表示で、選んだ人だけ密度を上げる */
describe("useListView", () => {
  beforeEach(() => localStorage.clear());

  it("何も保存されていなければ list（従来表示）", () => {
    expect(readListView()).toBe("list");
    const { result } = renderHook(() => useListView());
    expect(result.current[0]).toBe("list");
  });

  it("選んだ値を保存し、読み直しても同じ", () => {
    const { result } = renderHook(() => useListView());
    act(() => result.current[1]("compact"));
    expect(result.current[0]).toBe("compact");
    expect(localStorage.getItem("eventer:listView")).toBe("compact");
    expect(readListView()).toBe("compact");
  });

  it("旧キー（2列=\"2\"）を選んでいた人はグリッドのまま引き継ぐ", () => {
    localStorage.setItem("eventer:listColumns", "2");
    expect(readListView()).toBe("grid");
  });

  it("旧キーが \"1\" なら list（従来と同じ）", () => {
    localStorage.setItem("eventer:listColumns", "1");
    expect(readListView()).toBe("list");
  });

  it("新キーがあれば旧キーより優先", () => {
    localStorage.setItem("eventer:listColumns", "2");
    localStorage.setItem("eventer:listView", "compact");
    expect(readListView()).toBe("compact");
  });

  it("壊れた値は list に落とす（画面が空にならない）", () => {
    localStorage.setItem("eventer:listView", "wide");
    expect(readListView()).toBe("list");
  });

  it("同じページ内の別インスタンスに同期する", () => {
    const a = renderHook(() => useListView());
    const b = renderHook(() => useListView());
    act(() => a.result.current[1]("grid"));
    expect(b.result.current[0]).toBe("grid");
  });
});
