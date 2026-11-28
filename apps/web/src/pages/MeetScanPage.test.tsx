import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { MeetScanResult } from "@eventer/shared";

/**
 * QRを読み取った先の画面 (#330)。
 *
 * 開いた時点で記録が走ること、**失敗の理由が潰れないこと**、誤読み取りを
 * 取り消せること、未ログインならログインへ送られることを固定する。
 * 会場では電波が不安定なので、通信断を「読み取れないQR」と案内すると
 * 正常なQRを何度も出し直させることになる。
 */

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
    },
  };
});

const { ApiError, NetworkError } = await import("../api/client.js");
const { MeetScanPage, failureOf } = await import("./MeetScanPage.js");

const RESULT: MeetScanResult = {
  target: {
    id: "u-target",
    username: "aite",
    name: "相手さん",
    avatarUrl: null,
  },
  events: [
    {
      eventId: "e-1",
      title: "秋の集まり",
      meetCreated: true,
      attendedMe: true,
      attendedTarget: false,
    },
  ],
  undoToken: "mu1.payload.sig",
};

function renderPage(loggedIn = true) {
  getMock.mockImplementation((path: string) =>
    path === "/auth/me"
      ? Promise.resolve(
          loggedIn ? { user: { id: "u-me", username: "me" } } : { user: null },
        )
      : Promise.resolve({}),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/m/mt1.u-target.1700000000.abcdef"]}>
        <Routes>
          <Route path="/m/:token" element={<MeetScanPage />} />
          <Route path="/login" element={<div>ログイン画面</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe("読み取り直後の画面 (#330)", () => {
  it("開いた時点でトークンを送り、記録できたことを相手の名前つきで出す", async () => {
    postMock.mockResolvedValue(RESULT);
    renderPage();

    await screen.findByText(/秋の集まり/);
    expect(postMock).toHaveBeenCalledWith(
      "/meet/scan",
      { token: "mt1.u-target.1700000000.abcdef" },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    // 自動送信は1回だけ（読み取りが二重に走らないこと）
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("相手さん")).toBeTruthy();
    // 誰の受付が済んだのかまで分かる（自分の受付が済んだと伝わらないと
    // 受付に並び直す二度手間になる）
    expect(screen.getByText(/あなたの受付（出席）も一緒に済ませました/)).toBeTruthy();
    expect(screen.queryByText(/相手さん さんの受付/)).toBeNull();
  });

  it("取り消しはサーバーが返したトークンだけを送る", async () => {
    postMock.mockResolvedValue(RESULT);
    renderPage();
    await screen.findByText(/秋の集まり/);

    postMock.mockResolvedValue({ undone: 1, attendanceRevoked: true });
    screen.getByRole("button", { name: "取り消す" }).click();

    await waitFor(() =>
      expect(postMock).toHaveBeenLastCalledWith(
        "/meet/undo",
        { undoToken: "mu1.payload.sig" },
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      ),
    );
    await screen.findByText("記録を取り消しました");
  });

  it("失敗の理由ごとに違う案内を出す", async () => {
    for (const [error, expected] of [
      ["expired", /有効期限が切れました/],
      ["used", /すでに読み取り済み/],
      ["no_shared_event", /同じイベントに参加していない/],
      ["outside_window", /開催時間帯ではない/],
      ["not_confirmed_me", /あなたの参加がまだ確定していない/],
      ["not_confirmed_target", /相手の参加がまだ確定していない/],
    ] as const) {
      postMock.mockReset();
      postMock.mockRejectedValue(new ApiError(409, { error }));
      const { unmount } = renderPage();
      await screen.findByText(expected);
      unmount();
    }
  });

  it("通信断・セッション切れ・サーバー不調を「読み取れないQR」に潰さない", () => {
    // ここが潰れると、正常なQRを相手に何度も出し直させることになる
    expect(failureOf(new NetworkError(false))).toBe("network");
    expect(failureOf(new NetworkError(true))).toBe("network");
    expect(failureOf(new TypeError("boom"))).toBe("network");
    expect(failureOf(new ApiError(401, { error: "unauthorized" }))).toBe(
      "unauthorized",
    );
    expect(failureOf(new ApiError(500, null))).toBe("server");
    // 想定外の 4xx もQRのせいと決めつけない
    expect(failureOf(new ApiError(429, { error: "rate_limited" }))).toBe(
      "server",
    );
    expect(failureOf(new ApiError(410, { error: "expired" }))).toBe("expired");
  });

  it("失敗しても同じQRで再試行できる", async () => {
    postMock.mockRejectedValue(new NetworkError(true));
    renderPage();

    await screen.findByText(/通信できませんでした/);
    postMock.mockResolvedValue(RESULT);
    screen.getByRole("button", { name: /もう一度試す/ }).click();

    await screen.findByText(/秋の集まり/);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("未ログインならログイン画面へ送り、記録は走らせない", async () => {
    postMock.mockResolvedValue(RESULT);
    renderPage(false);
    await screen.findByText("ログイン画面");
    expect(postMock).not.toHaveBeenCalled();
  });
});

/**
 * 結果画面から続けて読み取る (#726)。
 *
 * 会場で何人も続けて読むとき、結果画面から1タップで読み取りに戻れること。
 * 固定しておくのは、出す・出さない状態、押すまでカメラを起動しないこと、
 * 次の人を読んだら新しい token で記録し直すこと（同じルートのまま token だけ
 * 変わっても作り直す）、履歴を積まないこと、直前に記録したQRの映り込みで
 * 「使用済み」にしないこと。カメラと BarcodeDetector は偽物にする。
 */
describe("結果画面から続けて読み取る (#726)", () => {
  const T1 = "mt1.u-target.1700000000.abcdef";
  const T2 = "mt1.u-next.1700000000.cafe01";
  const RESULT2: MeetScanResult = {
    target: { id: "u-next", username: "tsugi", name: "次の人", avatarUrl: null },
    events: [
      { eventId: "e-1", title: "冬の集まり", meetCreated: true, attendedMe: false, attendedTarget: false },
    ],
    undoToken: "mu1.next.sig",
  };

  const stopMock = vi.fn();
  const getUserMediaMock = vi.fn();
  const detectMock = vi.fn();
  /** 偽のカメラに映っている QR の中身 */
  let scanned: string | null = null;
  const meetUrl = (token: string) => `${window.location.origin}/m/${token}`;

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  /** いまの場所を出し、戻るを押せるようにする（履歴が積まれていないかを見る） */
  function HistoryProbe() {
    const location = useLocation();
    const navigate = useNavigate();
    return (
      <>
        <div data-testid="path">{location.pathname}</div>
        <button type="button" data-testid="back" onClick={() => navigate(-1)} />
      </>
    );
  }

  function renderFromProfile(loggedIn = true) {
    getMock.mockImplementation((path: string) =>
      path === "/auth/me"
        ? Promise.resolve(
            loggedIn ? { user: { id: "u-me", username: "me" } } : { user: null },
          )
        : Promise.resolve({}),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/users/me", `/m/${T1}`]} initialIndex={1}>
          <HistoryProbe />
          <Routes>
            <Route path="/m/:token" element={<MeetScanPage />} />
            <Route path="/users/:username" element={<div>プロフィール画面</div>} />
            <Route path="/login" element={<div>ログイン画面</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const scanNext = () => screen.queryByRole("button", { name: /続けて読み取る/ });
  const openScan = () => fireEvent.click(scanNext()!);
  const scanCalls = () => postMock.mock.calls.filter((c) => c[0] === "/meet/scan");

  it("記録できた結果に出て、主ボタンになる。「プロフィールを見る」「取り消す」も残る", async () => {
    postMock.mockResolvedValue(RESULT);
    renderFromProfile();
    await screen.findByText(/秋の集まり/);

    expect(scanNext()!.className).toContain("MuiButton-contained");
    const profile = screen.getByRole("link", { name: "プロフィールを見る" });
    expect(profile.className).toContain("MuiButton-outlined");
    expect(screen.getByRole("button", { name: "取り消す" })).toBeTruthy();
  });

  it("取り消したあとも出る", async () => {
    postMock.mockResolvedValue(RESULT);
    renderFromProfile();
    await screen.findByText(/秋の集まり/);
    postMock.mockResolvedValue({ undone: 1, attendanceRevoked: true });
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    await screen.findByText("記録を取り消しました");
    expect(scanNext()!.className).toContain("MuiButton-contained");
  });

  it("記録中は出さない", async () => {
    postMock.mockReturnValue(new Promise(() => {}));
    renderFromProfile();
    await screen.findByText("記録しています…");
    expect(scanNext()).toBeNull();
  });

  it("QRを出し直してもらう失敗では主ボタン、再試行できる失敗では副ボタンで出す", async () => {
    for (const error of ["expired", "used", "invalid"] as const) {
      postMock.mockReset();
      postMock.mockRejectedValue(new ApiError(409, { error }));
      const { unmount } = renderFromProfile();
      await waitFor(() => expect(scanNext()).toBeTruthy());
      expect(scanNext()!.className).toContain("MuiButton-contained");
      expect(
        screen.getByRole("button", { name: /もう一度試す/ }).className,
      ).toContain("MuiButton-outlined");
      unmount();
    }

    postMock.mockReset();
    postMock.mockRejectedValue(new NetworkError(true));
    renderFromProfile();
    await screen.findByText(/通信できませんでした/);
    expect(scanNext()!.className).toContain("MuiButton-outlined");
    expect(
      screen.getByRole("button", { name: /もう一度試す/ }).className,
    ).toContain("MuiButton-contained");
  });

  it("ログインが切れていたら出さない（読んでも 401 になる）", async () => {
    postMock.mockRejectedValue(new ApiError(401, { error: "unauthorized" }));
    renderFromProfile();
    await screen.findByText(/ログインの有効期限が切れました/);
    expect(screen.getByRole("link", { name: "ログインする" })).toBeTruthy();
    expect(scanNext()).toBeNull();
  });

  it("押すまでカメラを起動せず、押すと背面カメラの「読み取る」で開く", async () => {
    postMock.mockResolvedValue(RESULT);
    renderFromProfile();
    await screen.findByText(/秋の集まり/);
    expect(getUserMediaMock).not.toHaveBeenCalled();

    openScan();
    await waitFor(() =>
      expect(getUserMediaMock).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false }),
    );
    expect(screen.getByRole("button", { name: "読み取る" }).getAttribute("aria-pressed")).toBe("true");
    // 読み取り中は自分のトークンを取りに行かない
    expect(getMock).not.toHaveBeenCalledWith("/meet/token", expect.anything());
  });

  it("次の人のQRを読むと新しい token で記録し直し、結果を置き換える。履歴は積まない", async () => {
    postMock.mockResolvedValue(RESULT);
    renderFromProfile();
    await screen.findByText(/秋の集まり/);
    postMock.mockResolvedValue({ undone: 1, attendanceRevoked: true });
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    await screen.findByText("記録を取り消しました");

    postMock.mockResolvedValue(RESULT2);
    openScan();
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    scanned = meetUrl(T2);

    await screen.findByText(/冬の集まり/);
    expect(screen.getByTestId("path").textContent).toBe(`/m/${T2}`);
    expect(scanCalls()).toHaveLength(2);
    expect(scanCalls()[1][1]).toEqual({ token: T2 });
    // 前の人の結果・取り消し済み表示は残らない
    expect(screen.queryByText("相手さん")).toBeNull();
    expect(screen.queryByText("記録を取り消しました")).toBeNull();
    expect(screen.getByText("次の人")).toBeTruthy();
    // ダイアログは閉じ、カメラも止まっている
    expect(screen.queryByLabelText("QRを読み取るカメラの映像")).toBeNull();
    expect(stopMock).toHaveBeenCalled();

    // replace なので、戻ると前の /m/<token> を通らず元の画面へ
    fireEvent.click(screen.getByTestId("back"));
    await screen.findByText("プロフィール画面");
    expect(screen.getByTestId("path").textContent).toBe("/users/me");
  });

  it("記録できた直後に同じQRが映っても進まず、送り直さない", async () => {
    postMock.mockResolvedValue(RESULT);
    renderFromProfile();
    await screen.findByText(/秋の集まり/);

    openScan();
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    scanned = meetUrl(T1);
    await waitFor(() => expect(detectMock.mock.calls.length).toBeGreaterThan(3));

    expect(scanCalls()).toHaveLength(1);
    // 読み取りは続いていて、「出会いのQRではありません」も出さない
    expect(screen.getByLabelText("QRを読み取るカメラの映像")).toBeTruthy();
    expect(screen.queryByText("出会いのQRではありません")).toBeNull();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("読み取れなかった（invalid）あとは同じQRを読み直せる", async () => {
    postMock.mockRejectedValue(new ApiError(400, { error: "invalid" }));
    renderFromProfile();
    await screen.findByText(/このQRは読み取れませんでした/);

    postMock.mockReset();
    postMock.mockResolvedValue(RESULT);
    openScan();
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    scanned = meetUrl(T1);

    await screen.findByText(/秋の集まり/);
    expect(scanCalls()).toHaveLength(1);
    expect(scanCalls()[0][1]).toEqual({ token: T1 });
    expect(screen.queryByText(/このQRは読み取れませんでした/)).toBeNull();
  });

  it("閉じると結果画面に戻り、取り消しがそのまま使える", async () => {
    postMock.mockResolvedValue(RESULT);
    renderFromProfile();
    await screen.findByText(/秋の集まり/);

    openScan();
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByLabelText("QRを読み取るカメラの映像")).toBeNull());
    expect(stopMock).toHaveBeenCalled();
    expect(screen.getByTestId("path").textContent).toBe(`/m/${T1}`);

    postMock.mockResolvedValue({ undone: 1, attendanceRevoked: true });
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenLastCalledWith(
        "/meet/undo",
        { undoToken: "mu1.payload.sig" },
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      ),
    );
    await screen.findByText("記録を取り消しました");
  });

  it("未ログインはログインへ送り、ボタンもカメラも出さない", async () => {
    postMock.mockResolvedValue(RESULT);
    renderFromProfile(false);
    await screen.findByText("ログイン画面");
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(scanNext()).toBeNull();
    expect(getUserMediaMock).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });
});
