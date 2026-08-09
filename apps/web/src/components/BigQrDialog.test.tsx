import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 大きなQR表示 (#324 → #330)。
 *
 * 飛び先は公開プロフィールではなく、使い捨てトークンを載せた
 * 読み取り確定用の入口。トークンが取れるまでQRを描かないこと
 * （古い・空のQRを読ませない）を固定しておく。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

const { BigQrDialog, buildMeetQrUrl } = await import("./BigQrDialog.js");

function renderDialog(open = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <BigQrDialog open={open} onClose={() => {}} name="テスター" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
});

describe("大きなQR表示 (#330)", () => {
  it("飛び先は読み取り確定用の入口で、トークンはURLとして安全にエスケープする", () => {
    expect(buildMeetQrUrl("mt1.u.1.ab", "https://example.test")).toBe(
      "https://example.test/m/mt1.u.1.ab",
    );
    expect(buildMeetQrUrl("a b/c", "https://example.test")).toBe(
      "https://example.test/m/a%20b%2Fc",
    );
  });

  it("取得したトークンの入口URLをQRにする", async () => {
    getMock.mockResolvedValue({
      token: "mt1.u-1.1700000000.deadbeef",
      expiresAt: Date.now() + 120_000,
    });
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toBe(
        `${window.location.origin}/m/mt1.u-1.1700000000.deadbeef`,
      ),
    );
    // 待ち続けないよう上限つきで取りに行く
    expect(getMock).toHaveBeenCalledWith(
      "/meet/token",
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    // 誰のQRか分かるように名前を添える
    expect(screen.getByText("テスター")).toBeTruthy();
    expect(screen.getByRole("img", { name: /テスター/ })).toBeTruthy();
  });

  it("トークンが取れるまでQRを描かない", () => {
    getMock.mockReturnValue(new Promise(() => {}));
    renderDialog();
    expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toBe("");
    expect(screen.queryByRole("img", { name: /テスター/ })).toBeNull();
  });

  it("期限切れのトークンはQRにしない", async () => {
    // 一度閉じて開き直した直後や、電波が切れて取り直せていない間に
    // 古いQRを出し続けると、読み取った側だけが「期限切れ」を見て、
    // 見せている側は気づけない (#330)
    getMock.mockResolvedValue({
      token: "mt1.u-1.1700000000.deadbeef",
      expiresAt: Date.now() - 1,
    });
    renderDialog();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toBe("");
    expect(screen.queryByRole("img", { name: /テスター/ })).toBeNull();
    // 「準備中」に落として、見せている側にも取り直し中だと分かるようにする
    expect(screen.getByText(/QRを準備しています/)).toBeTruthy();
  });

  it("閉じている間はトークンを取りに行かない", () => {
    getMock.mockResolvedValue({ token: "mt1.x.1.y", expiresAt: 0 });
    renderDialog(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("スリープ防止に対応していない環境でもエラーにならない", () => {
    // jsdom には navigator.wakeLock が無い。黙って無視されること
    expect("wakeLock" in navigator).toBe(false);
    getMock.mockResolvedValue({ token: "mt1.x.1.y", expiresAt: 0 });
    expect(() => renderDialog()).not.toThrow();
  });
});
