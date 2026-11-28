import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

const { BigQrDialog, buildMeetQrUrl, parseMeetQrUrl } = await import("./BigQrDialog.js");

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

function MeetPageStub() {
  const { token = "" } = useParams();
  return <div data-testid="meet-page">{token}</div>;
}

/** 省略可の props (#726)。省略時は従来どおり */
type ExtraProps = Pick<Parameters<typeof BigQrDialog>[0], "initialMode" | "replaceOnMeet" | "ignoreToken">;

function dialogTree(open: boolean, onClose: () => void, qc: QueryClient, extra: ExtraProps = {}) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/before", "/me"]} initialIndex={1}>
        <HistoryProbe />
        <Routes>
          <Route path="/me" element={<BigQrDialog open={open} onClose={onClose} name="テスター" {...extra} />} />
          <Route path="/m/:token" element={<MeetPageStub />} />
          <Route path="/before" element={<div data-testid="before-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** 戻るを押せるようにする（push / replace を見分ける） */
function HistoryProbe() {
  const navigate = useNavigate();
  return <button type="button" data-testid="back" onClick={() => navigate(-1)} />;
}

function renderDialog(open = true, onClose: () => void = () => {}, extra: ExtraProps = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(dialogTree(open, onClose, qc, extra));
  return {
    ...view,
    rerenderOpen: (next: boolean) => view.rerender(dialogTree(next, onClose, qc, extra)),
  };
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

/**
 * 「QRを見せる / 読み取る」の切り替え (#704)。
 *
 * OSのカメラアプリ経由だと別ブラウザで開いてログインからやり直しになることがあるので、
 * 同じ画面で相手の出会いのQRを読めるようにする。固定しておくのは、既定は従来の「見せる」、
 * 読み取り中はトークンを取りに行かない、出会いのQRだけを入口に通す、カメラを止め忘れない、こと。
 * カメラと BarcodeDetector は偽物にする。
 */
describe("出会いのQR画面の読み取り (#704)", () => {
  const stopMock = vi.fn();
  const getUserMediaMock = vi.fn();
  const detectMock = vi.fn();
  /** 偽のカメラに映っている QR の中身 */
  let scanned: string | null = null;

  beforeEach(() => {
    scanned = null;
    stopMock.mockReset();
    detectMock.mockReset();
    detectMock.mockImplementation(async () => (scanned ? [{ rawValue: scanned }] : []));
    getUserMediaMock.mockReset();
    getUserMediaMock.mockResolvedValue({ getTracks: () => [{ stop: stopMock }] });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: getUserMediaMock },
    });
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      static getSupportedFormats = async () => ["qr_code"];
      detect = detectMock;
    };
    // jsdom の video は再生できず寸法も持たないので、映っている体にする
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
    getMock.mockResolvedValue(token("aaaa"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  const switchTo = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

  it("出会いのQRは自分のオリジンの /m/<token> だけ", () => {
    const origin = "https://example.test";
    expect(parseMeetQrUrl("https://example.test/m/mt1.u.1.ab", origin)).toBe("mt1.u.1.ab");
    expect(parseMeetQrUrl("https://other.test/m/mt1.u.1.ab", origin)).toBeNull();
    expect(parseMeetQrUrl("https://example.test/users/sanka", origin)).toBeNull();
    expect(parseMeetQrUrl("https://example.test/m/a/b", origin)).toBeNull();
    expect(parseMeetQrUrl("evt1.abc", origin)).toBeNull();
  });

  it("既定は「QRを見せる」で、カメラは起動しない", async () => {
    renderDialog();
    await waitFor(() =>
      expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toContain("aaaa"),
    );
    expect(screen.getByRole("button", { name: "QRを見せる" }).getAttribute("aria-pressed")).toBe("true");
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("「読み取る」に切り替えると背面カメラを起動し、QRとトークンの取得を止める", async () => {
    renderDialog();
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    switchTo("読み取る");

    await waitFor(() =>
      expect(getUserMediaMock).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false }),
    );
    expect(screen.queryByTestId("big-qr")).toBeNull();
    expect(screen.getByLabelText("QRを読み取るカメラの映像")).toBeTruthy();
    // 読み取り中は「読まれた」の合図も聞かず、取りに行かない
    expect(listeners.at(-1)?.source ?? null).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("出会いのQRを読んだら閉じて /m/<token> へ進む", async () => {
    const onClose = vi.fn();
    renderDialog(true, onClose);
    switchTo("読み取る");
    scanned = `${window.location.origin}/m/mt1.u-2.1700000000.cafe`;

    await waitFor(() => expect(screen.getByTestId("meet-page").textContent).toBe("mt1.u-2.1700000000.cafe"));
    expect(onClose).toHaveBeenCalledTimes(1);
    // 画面を離れたらカメラを止める
    expect(stopMock).toHaveBeenCalled();
  });

  it("別オリジン・別のパスのQRでは進まず、案内を出して読み続ける", async () => {
    const onClose = vi.fn();
    renderDialog(true, onClose);
    switchTo("読み取る");
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());

    scanned = "https://other.example/m/mt1.u-2.1700000000.cafe";
    await waitFor(() => expect(screen.getByText("出会いのQRではありません")).toBeTruthy());
    scanned = `${window.location.origin}/users/sanka`;
    await waitFor(() => expect(detectMock.mock.calls.length).toBeGreaterThan(3));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("meet-page")).toBeNull();
    // 読み取りは続いている（カメラ映像のまま）
    expect(screen.getByLabelText("QRを読み取るカメラの映像")).toBeTruthy();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("カメラが使えないときは案内と「QRを見せる」に戻るボタンを出す", async () => {
    getUserMediaMock.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    renderDialog();
    switchTo("読み取る");

    await waitFor(() => expect(screen.getByText(/カメラを使えませんでした/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "QRを見せるに戻る" }));
    await waitFor(() =>
      expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toContain("aaaa"),
    );
  });

  it("閉じて開き直すと「QRを見せる」から始まる", async () => {
    const view = renderDialog();
    switchTo("読み取る");
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());

    view.rerenderOpen(false);
    await waitFor(() => expect(stopMock).toHaveBeenCalled());
    view.rerenderOpen(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "QRを見せる" }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByTestId("big-qr")).toBeTruthy();
  });

  it("「QRを見せる」に戻したらカメラを止める", async () => {
    renderDialog();
    switchTo("読み取る");
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    // 映像を流し始めるまで待つ（デコードが回り出した＝ストリームを掴んでいる）
    await waitFor(() => expect(detectMock).toHaveBeenCalled());
    expect(stopMock).not.toHaveBeenCalled();

    switchTo("QRを見せる");
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("big-qr")).toBeTruthy();
  });
  it("既定では push で進む（戻るとダイアログを開いた画面へ戻る）", async () => {
    renderDialog();
    switchTo("読み取る");
    scanned = `${window.location.origin}/m/mt1.u-2.1700000000.cafe`;
    await waitFor(() => expect(screen.getByTestId("meet-page")).toBeTruthy());

    fireEvent.click(screen.getByTestId("back"));
    await waitFor(() => expect(screen.queryByTestId("meet-page")).toBeNull());
    expect(screen.getByRole("button", { name: "読み取る" })).toBeTruthy();
  });

  describe("結果画面から開く場合の props (#726)", () => {
    it("initialMode=\"scan\" で開くとすぐカメラを起動し、トークンは取りに行かない", async () => {
      renderDialog(true, () => {}, { initialMode: "scan" });
      await waitFor(() =>
        expect(getUserMediaMock).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false }),
      );
      expect(screen.getByRole("button", { name: "読み取る" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.queryByTestId("big-qr")).toBeNull();
      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      expect(getMock).not.toHaveBeenCalled();
    });

    it("initialMode=\"scan\" で閉じて開き直すと「読み取る」から始まる", async () => {
      const view = renderDialog(true, () => {}, { initialMode: "scan" });
      switchTo("QRを見せる");
      await waitFor(() => expect(screen.getByTestId("big-qr")).toBeTruthy());

      view.rerenderOpen(false);
      view.rerenderOpen(true);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "読み取る" }).getAttribute("aria-pressed")).toBe("true"),
      );
      expect(screen.queryByTestId("big-qr")).toBeNull();
    });

    it("initialMode=\"scan\" でも「QRを見せる」に切り替えるとカメラを止めてQRを出す", async () => {
      renderDialog(true, () => {}, { initialMode: "scan" });
      await waitFor(() => expect(detectMock).toHaveBeenCalled());
      expect(stopMock).not.toHaveBeenCalled();

      switchTo("QRを見せる");
      expect(stopMock).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(screen.getByTestId("big-qr").getAttribute("data-qr-url")).toContain("aaaa"),
      );
    });

    it("replaceOnMeet では履歴を積まずに進む", async () => {
      renderDialog(true, () => {}, { initialMode: "scan", replaceOnMeet: true });
      scanned = `${window.location.origin}/m/mt1.u-2.1700000000.cafe`;
      await waitFor(() => expect(screen.getByTestId("meet-page").textContent).toBe("mt1.u-2.1700000000.cafe"));

      // 開いた画面（/me）は置き換えられているので、戻るとその前へ
      fireEvent.click(screen.getByTestId("back"));
      await waitFor(() => expect(screen.getByTestId("before-page")).toBeTruthy());
      expect(screen.queryByRole("button", { name: "読み取る" })).toBeNull();
    });

    it("ignoreToken と同じQRでは進まず、案内も変えない", async () => {
      const onClose = vi.fn();
      renderDialog(true, onClose, { initialMode: "scan", ignoreToken: "mt1.u-2.1700000000.cafe" });
      await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
      const hint = screen.getByRole("status").textContent;

      scanned = `${window.location.origin}/m/mt1.u-2.1700000000.cafe`;
      await waitFor(() => expect(detectMock.mock.calls.length).toBeGreaterThan(3));
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByTestId("meet-page")).toBeNull();
      expect(screen.getByRole("status").textContent).toBe(hint);
      expect(screen.queryByText("出会いのQRではありません")).toBeNull();

      // 別の相手のQRなら進む
      scanned = `${window.location.origin}/m/mt1.u-3.1700000000.beef`;
      await waitFor(() => expect(screen.getByTestId("meet-page").textContent).toBe("mt1.u-3.1700000000.beef"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
