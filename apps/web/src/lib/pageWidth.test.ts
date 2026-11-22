import { expect, it } from "vitest";
import { containerMaxWidth, pageWidth } from "./pageWidth.js";

/** PC で横幅を使う（2026-11-22）。一覧・表は広く、フォーム・設定・規約は読める幅のまま */
it("lists use the wide container, forms and long text keep the readable width, editors stay full width", () => {
  for (const path of ["/", "/events/e1", "/events/e1/manage", "/events/e1/lottery", "/users/kojira", "/c/yotsuya", "/decks", "/d/abc"]) {
    expect(containerMaxWidth(pageWidth(path)), path).toBe("xl");
  }
  for (const path of ["/account", "/events/new", "/events/e1/edit", "/terms", "/inquiries/i1", "/events/e1/inquiries/i1", "/c/yotsuya/edit"]) {
    expect(containerMaxWidth(pageWidth(path)), path).toBe("md");
  }
  expect(containerMaxWidth(pageWidth("/decks/d1/edit"))).toBe(false);
  expect(containerMaxWidth(pageWidth("/live-sets/l1/edit"))).toBe(false);
});
