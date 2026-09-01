import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LinkifiedText } from "./LinkifiedText.js";

/** URL のリンク化 (#444 フォローアップ)。分割は shared の splitByUrls の契約
 * （詳細はサーバー側 chat-text.test.ts が固定）で、ここでは React 描画の
 * 属性（新タブ・noopener）と「危険スキームを素通しさせない」ことを固定する */
describe("LinkifiedText", () => {
  it("URL 混在の文を分割し、URL だけがリンクになる", () => {
    render(
      <LinkifiedText text={"詳細は https://example.com/a を見て、続きは http://example.jp!"} />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/a",
      "http://example.jp",
    ]);
    expect(screen.getByText(/詳細は/)).toBeInTheDocument();
    expect(screen.getByText(/を見て、続きは/)).toBeInTheDocument();
  });

  it("リンクは新しいタブで開き、noopener noreferrer が付く", () => {
    render(<LinkifiedText text={"https://example.com"} />);
    const a = screen.getByRole("link");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("javascript: などの危険スキームはリンク化されずテキストのまま", () => {
    render(<LinkifiedText text={"push javascript:alert(1) and ftp://x.example"} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText(/push javascript:alert\(1\) and ftp:\/\/x\.example/),
    ).toBeInTheDocument();
  });
});
