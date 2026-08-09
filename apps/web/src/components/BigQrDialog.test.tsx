import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 大きなQR表示 (#324 → #330)。
 *
 * 飛び先は公開プロフィールではなく、使い切りトークンを載せた読み取り確定用の入口。
 * 固定しておくのは、古い・空のQRを読ませないこと（トークンが取れるまで描かない、
 * 期限切れは描かない）と、**読まれるまでは同じQRを出し続ける**こと。
 * 読み取っている最中に切り替わると失敗し続けるため。
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
const { MEET_TOKEN_POLL_MS } = await import("../api/eventMeetHooks.js");

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
      expiresAt: Date.now() + 600_000,
      consumed: false,
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
      consumed: false,
    });
    renderDialog();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toBe("");
    expect(screen.queryByRole("img", { name: /テスター/ })).toBeNull();
    // 「準備中」に落として、見せている側にも取り直し中だと分かるようにする
    expect(screen.getByText(/QRを準備しています/)).toBeTruthy();
  });

  it("表示中のトークンを添えて見張り、読まれたら描き替える", async () => {
    // 定期的に切り替えると、読み取っている最中に変わって失敗し続けるうえ、
    // 行列の2人目以降が「使用済み」で弾かれる (#330)。
    // 見張りの間隔は実時間で待たず、タイマーを進めて確かめる
    vi.useFakeTimers();
    try {
      const first = {
        token: "mt1.u-1.1700000000.aaaa",
        expiresAt: Date.now() + 600_000,
        consumed: false,
      };
      getMock.mockResolvedValue(first);
      renderDialog();
      // 最初の取得を流す（fake timer 中は waitFor が進まないので自分で進める）
      await vi.advanceTimersByTimeAsync(50);
      expect(
        screen.getByTestId("big-qr").getAttribute("data-qr-url"),
      ).toContain("aaaa");

      // 2回目以降は表示中のトークンを添えて問い合わせる
      await vi.advanceTimersByTimeAsync(MEET_TOKEN_POLL_MS + 100);
      expect(getMock).toHaveBeenLastCalledWith(
        `/meet/token?current=${encodeURIComponent(first.token)}`,
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );

      // 読まれたら次のぶんに描き替え、次の人に向け直す合図を出す
      getMock.mockResolvedValue({
        token: "mt1.u-1.1700000000.bbbb",
        expiresAt: Date.now() + 600_000,
        consumed: true,
      });
      await vi.advanceTimersByTimeAsync(MEET_TOKEN_POLL_MS + 100);
      expect(
        screen.getByTestId("big-qr").getAttribute("data-qr-url"),
      ).toContain("bbbb");
      expect(screen.getByText(/読み取られました/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("閉じている間はトークンを取りに行かない", () => {
    getMock.mockResolvedValue({ token: "mt1.x.1.y", expiresAt: 0, consumed: false });
    renderDialog(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("スリープ防止に対応していない環境でもエラーにならない", () => {
    // jsdom には navigator.wakeLock が無い。黙って無視されること
    expect("wakeLock" in navigator).toBe(false);
    getMock.mockResolvedValue({ token: "mt1.x.1.y", expiresAt: 0, consumed: false });
    expect(() => renderDialog()).not.toThrow();
  });
});
