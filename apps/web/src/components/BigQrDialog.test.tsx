import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EVENT_SIGNAL_KIND, type EventSignalSource } from "@eventer/shared";

/**
 * 大きなQR表示 (#324 → #330)。
 *
 * 飛び先は公開プロフィールではなく、使い切りトークンを載せた読み取り確定用の入口。
 * 固定しておくのは、古い・空のQRを読ませないこと（トークンが取れるまで描かない、
 * 期限切れは描かない）と、**読まれるまでは同じQRを出し続ける**こと。
 * 読み取っている最中に切り替わると失敗し続けるため。
 *
 * 定期の見張りはしない（D-POLL-MIN 第5段階 5b-4）。取り直すのは「読まれた」の合図
 * （topic `meet-token`）と、表示の上限（displayUntil）の1回だけ。合図の受け口は偽物にして、
 * どの source を jitter なしで聞くかと、合図で取り直すことを確かめる。
 */

const { getMock, listeners } = vi.hoisted(() => ({
  getMock: vi.fn(),
  listeners: [] as Array<{ source: EventSignalSource | null | undefined; onSignal: () => unknown; jitterMs?: number }>,
}));
vi.mock("../lib/signalHub.js", () => ({
  useEventSignal: (source: EventSignalSource | null | undefined, onSignal: () => unknown, options: { jitterMs?: number } = {}) => {
    listeners.push({ source, onSignal, jitterMs: options.jitterMs });
    return { synced: Boolean(source) };
  },
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

const { BigQrDialog, buildMeetQrUrl } = await import("./BigQrDialog.js");

const signal: EventSignalSource = { kind: EVENT_SIGNAL_KIND, pubkey: "5e".repeat(32), topic: "meet-token-topic", rev: 1, relays: ["wss://relay.example"] };
const token = (nonce: string, consumed = false, displayUntil = Date.now() + 90_000) => ({
  token: `mt1.u-1.1700000000.${nonce}`,
  expiresAt: Date.now() + 600_000,
  consumed,
  displayUntil,
  signal,
});
/** いま聞いている「読まれた」の合図を1回届ける */
async function fireSignal() {
  const live = listeners.filter((l) => l.source).at(-1);
  expect(live).toBeTruthy();
  await act(async () => {
    await live!.onSignal();
  });
}

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
  listeners.length = 0;
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

  it("定期には取りに行かず、「読まれた」の合図で表示中のトークンを添えて取り直し、描き替える", async () => {
    // 定期的に切り替えると、読み取っている最中に変わって失敗し続けるうえ、
    // 行列の2人目以降が「使用済み」で弾かれる (#330)。見張りの周期も持たない
    vi.useFakeTimers();
    try {
      const first = token("aaaa");
      getMock.mockResolvedValue(first);
      renderDialog();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toContain("aaaa");
      // 応答の source を待たせずに（jitter なし）聞く
      expect(listeners.filter((l) => l.source).at(-1)).toMatchObject({ source: signal, jitterMs: undefined });

      // 上限より手前では、どれだけ経っても取りに行かない
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(getMock).toHaveBeenCalledTimes(1);

      // 読まれたら合図が来る。表示中のトークンを添えて問い合わせ、次のぶんに描き替える
      getMock.mockResolvedValue(token("bbbb", true));
      await fireSignal();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(getMock).toHaveBeenLastCalledWith(
        `/meet/token?current=${encodeURIComponent(first.token)}`,
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );
      expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toContain("bbbb");
      expect(screen.getByText(/読み取られました/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("表示の上限（displayUntil）で1回だけ取り直す", async () => {
    // 出しっぱなしのQRを撮った写真が効く窓を頭打ちにする上限。周期ではなく、その時刻に1回
    vi.useFakeTimers();
    try {
      const first = token("aaaa", false, Date.now() + 90_000);
      getMock.mockResolvedValue(first);
      renderDialog();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(getMock).toHaveBeenCalledTimes(1);

      getMock.mockResolvedValue(token("bbbb", false, Date.now() + 180_000));
      await act(async () => { await vi.advanceTimersByTimeAsync(90_000 + 1_000); });
      expect(getMock).toHaveBeenCalledTimes(2);
      expect(getMock).toHaveBeenLastCalledWith(
        `/meet/token?current=${encodeURIComponent(first.token)}`,
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );
      expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toContain("bbbb");
      // 読まれて替わったのではないので「読み取られました」は出さない
      expect(screen.queryByText(/読み取られました/)).toBeNull();

      // 次の上限までは、もう取りに行かない
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(getMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ブラウザが「裏」扱いを報告していても合図を聞き続ける", async () => {
    // 本番のスマホで「読まれても画面が変わらず、QRも切り替わらない」の原因 (#420)。
    // 画面ロック・アプリ切替・ホーム画面追加・アプリ内ブラウザでは、表示中でも
    // visibilityState が hidden のまま残る／visibilitychange が飛ばないことがある。
    // 合図はリレーの WebSocket で届くので、可視状態の報告と無関係に聞き続けること
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      const first = token("aaaa");
      getMock.mockResolvedValue(first);
      renderDialog();
      await waitFor(() => expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toContain("aaaa"));

      getMock.mockResolvedValue(token("bbbb", true));
      await fireSignal();
      await waitFor(() => expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toContain("bbbb"));
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });

  it("「読み取られました」は次の応答が早く来ても出っぱなしにならない", async () => {
    // 表示を消すタイマーがトークン監視の effect に同居していると、次の応答
    // （新しいデータオブジェクト）が2.5秒以内に届いたとき cleanup がタイマーを
    // 消してしまい、合図が出っぱなしになりうる (#420)。タイマーは合図の状態に
    // 結びつけ、応答の到着とは独立に必ず消えることを保証する
    vi.useFakeTimers();
    try {
      getMock.mockResolvedValue(token("aaaa"));
      renderDialog();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });

      // 読まれた → 次のぶん（consumed）。続けてすぐ次の応答（同じ bbbb・未読）が届く
      const second = token("bbbb", true);
      getMock.mockResolvedValue(second);
      await fireSignal();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByText(/読み取られました/)).toBeTruthy();
      getMock.mockResolvedValue({ ...second, consumed: false });
      await fireSignal();
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(screen.getByText(/読み取られました/)).toBeTruthy();

      // 合図の 2.5 秒が過ぎたら消えること（出っぱなしにならない）
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
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
