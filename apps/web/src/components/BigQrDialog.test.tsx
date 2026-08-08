import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BigQrDialog, buildProfileQrUrl } from "./BigQrDialog.js";

/**
 * 大きなQR表示 (#324)。飛び先は公開プロフィールで、流入元は ?ref=qr
 * （プロフィールカード内のQR=card と区別する。サーバー側の許可リストにも登録済み）
 */

describe("大きなQR表示 (#324)", () => {
  it("飛び先は公開プロフィールで流入元は qr", () => {
    expect(buildProfileQrUrl("tester", "https://example.test")).toBe(
      "https://example.test/users/tester?ref=qr",
    );
  });

  it("ハンドルはURLとして安全にエスケープする", () => {
    expect(buildProfileQrUrl("a b/c", "https://example.test")).toBe(
      "https://example.test/users/a%20b%2Fc?ref=qr",
    );
  });

  it("QRと名前を出し、QRの中身は公開プロフィールURLになる", () => {
    render(
      <BigQrDialog
        open
        onClose={() => {}}
        handle="tester"
        name="テスター"
        avatarUrl={null}
      />,
    );
    expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toBe(
      `${window.location.origin}/users/tester?ref=qr`,
    );
    // 誰のQRか分かるように名前を添える
    expect(screen.getByText("テスター")).toBeTruthy();
    expect(screen.getByRole("img", { name: /テスター/ })).toBeTruthy();
  });

  it("スリープ防止に対応していない環境でもエラーにならない", () => {
    // jsdom には navigator.wakeLock が無い。黙って無視されること
    expect("wakeLock" in navigator).toBe(false);
    expect(() =>
      render(
        <BigQrDialog
          open
          onClose={() => {}}
          handle="tester"
          name="テスター"
        />,
      ),
    ).not.toThrow();
  });
});
