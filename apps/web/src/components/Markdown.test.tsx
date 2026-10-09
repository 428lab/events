import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.js";

/**
 * 1回の改行を表示でも改行にする (#611)。
 *
 * CommonMark ではソフト改行がスペースになり、説明文を改行して書いても
 * 1行に繋がって見えていた。remark-breaks で `<br>` にする。
 * 空行での段落分け・リスト・コードブロック・表の描画は変えない。
 */
function renderMd(md: string) {
  return render(<Markdown>{md}</Markdown>).container;
}

describe("Markdown の改行 (#611)", () => {
  it("1回の改行は <br> になる", () => {
    const c = renderMd("1行目\n2行目");
    const ps = c.querySelectorAll("p");
    expect(ps).toHaveLength(1);
    expect(ps[0].querySelectorAll("br")).toHaveLength(1);
    expect(ps[0].textContent).toBe("1行目\n2行目");
  });

  it("空行では従来どおり段落が分かれる", () => {
    const c = renderMd("段落1\n\n段落2");
    const ps = c.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[0].textContent).toBe("段落1");
    expect(ps[1].textContent).toBe("段落2");
    expect(c.querySelectorAll("br")).toHaveLength(0);
  });

  it("リストの描画は変わらない", () => {
    const c = renderMd("- a\n- b\n- c");
    const items = c.querySelectorAll("ul > li");
    expect(items).toHaveLength(3);
    expect(Array.from(items, (li) => li.textContent)).toEqual(["a", "b", "c"]);
    expect(c.querySelectorAll("br")).toHaveLength(0);
  });

  it("コードブロック内の改行は <br> にならずそのまま残る", () => {
    const c = renderMd("```\nline1\nline2\n```");
    const code = c.querySelector("pre > code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("line1\nline2\n");
    expect(c.querySelectorAll("br")).toHaveLength(0);
  });

  it("表の描画は変わらない", () => {
    const c = renderMd("| A | B |\n| - | - |\n| 1 | 2 |");
    const table = c.querySelector("table");
    expect(table).not.toBeNull();
    expect(
      Array.from(table!.querySelectorAll("th"), (th) => th.textContent),
    ).toEqual(["A", "B"]);
    expect(
      Array.from(table!.querySelectorAll("td"), (td) => td.textContent),
    ).toEqual(["1", "2"]);
    expect(c.querySelectorAll("br")).toHaveLength(0);
  });
});
