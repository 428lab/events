import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentTitle } from "./useDocumentTitle.js";

describe("useDocumentTitle (#676)", () => {
  beforeEach(() => {
    document.title = "events lab";
  });

  it("名前があれば「名前 ・ events lab」にする", () => {
    renderHook(() => useDocumentTitle("テストイベント"));
    expect(document.title).toBe("テストイベント ・ events lab");
  });

  it("名前が変われば追従し、無くなれば元に戻す", () => {
    const { rerender } = renderHook(
      ({ name }: { name: string | null | undefined }) => useDocumentTitle(name),
      { initialProps: { name: undefined as string | null | undefined } },
    );
    expect(document.title).toBe("events lab");
    rerender({ name: "最初" });
    expect(document.title).toBe("最初 ・ events lab");
    rerender({ name: "次" });
    expect(document.title).toBe("次 ・ events lab");
    rerender({ name: null });
    expect(document.title).toBe("events lab");
  });

  it("アンマウントでマウント時のタイトルに戻す", () => {
    const { unmount } = renderHook(() => useDocumentTitle("消えるイベント"));
    expect(document.title).toBe("消えるイベント ・ events lab");
    unmount();
    expect(document.title).toBe("events lab");
  });
});
