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

  it("ブラウザが「裏」扱いを報告していても見張りを止めない", async () => {
    // 本番のスマホで「読まれても画面が変わらず、QRも切り替わらない」の原因 (#420)。
    // 画面ロック・アプリ切替・ホーム画面追加・アプリ内ブラウザでは、表示中でも
    // visibilityState が hidden のまま残る／visibilitychange が飛ばないことがある。
    // ポーリングの実行を可視状態に依存させると、その間は3秒タイマーが空振りし続け、
    // 復帰の refetchOnWindowFocus も同じ visibilitychange 頼みなので一緒に死ぬ。
    // ダイアログを出している間は、可視状態の報告と無関係に見張り続けること
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      const first = {
        token: "mt1.u-1.1700000000.aaaa",
        expiresAt: Date.now() + 600_000,
        consumed: false,
      };
      getMock.mockResolvedValue(first);
      renderDialog();
      await vi.advanceTimersByTimeAsync(50);
      expect(
        screen.getByTestId("big-qr").getAttribute("data-qr-url"),
      ).toContain("aaaa");

      // hidden のままでも3秒ごとの見張りが動くこと
      await vi.advanceTimersByTimeAsync(MEET_TOKEN_POLL_MS + 100);
      expect(getMock).toHaveBeenLastCalledWith(
        `/meet/token?current=${encodeURIComponent(first.token)}`,
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );

      // 読まれたら hidden のままでも描き替わること
      getMock.mockResolvedValue({
        token: "mt1.u-1.1700000000.bbbb",
        expiresAt: Date.now() + 600_000,
        consumed: true,
      });
      await vi.advanceTimersByTimeAsync(MEET_TOKEN_POLL_MS + 100);
      expect(
        screen.getByTestId("big-qr").getAttribute("data-qr-url"),
      ).toContain("bbbb");
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
      vi.useRealTimers();
    }
  });

  it("「読み取られました」は次のpoll応答が早く来ても出っぱなしにならない", async () => {
    // 表示を消すタイマーがトークン監視の effect に同居していると、次の応答
    // （新しいデータオブジェクト）が2.5秒以内に届いたとき cleanup がタイマーを
    // 消してしまい、合図が出っぱなしになりうる (#420)。タイマーは合図の状態に
    // 結びつけ、応答の到着とは独立に必ず消えることを保証する
    vi.useFakeTimers();
    try {
      const first = {
        token: "mt1.u-1.1700000000.aaaa",
        expiresAt: Date.now() + 600_000,
        consumed: false,
      };
      getMock.mockResolvedValue(first);
      renderDialog();
      await vi.advanceTimersByTimeAsync(50);

      // 読まれた合図が「遅れて」届く（会場の回線で応答に2.9秒かかった想定）。
      // 次の tick の応答が合図の 2.5 秒以内に重なる
      const second = {
        token: "mt1.u-1.1700000000.bbbb",
        expiresAt: Date.now() + 600_000,
        consumed: true,
      };
      getMock.mockImplementationOnce(
        () => new Promise((r) => setTimeout(() => r(second), 2_900)),
      );
      // 以降の poll はすぐ返る（bbbb のまま・未読）
      getMock.mockResolvedValue({ ...second, consumed: false });

      // tick(3s) → 応答は 5.9s に到着、合図は 8.4s まで。次の tick(6s) の
      // 応答は 6s すぎに届く
      await vi.advanceTimersByTimeAsync(6_200);
      expect(screen.getByText(/読み取られました/)).toBeTruthy();

      // 合図の 2.5 秒が過ぎたら消えること（出っぱなしにならない）
      await vi.advanceTimersByTimeAsync(3_000);
      expect(screen.queryByText(/読み取られました/)).toBeNull();
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
