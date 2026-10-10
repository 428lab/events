import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrConnectSession } from "../lib/nostrConnect.js";
import type { LoginEventSigner } from "../lib/nostr.js";

/**
 * 署名アプリでつなぐシート (D-NOSTR-SIGNER)。
 * リレーとのやりとり（waitForConnect / requestSignEvent）だけ差し替え、
 * URI の組み立てと「覚えておく接続」は本物を使う。
 */
const waitForConnect = vi.fn();
const requestSignEvent = vi.fn();
vi.mock("../lib/nostrConnect.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/nostrConnect.js")>();
  return {
    ...real,
    waitForConnect: (...a: unknown[]) => waitForConnect(...a),
    requestSignEvent: (...a: unknown[]) => requestSignEvent(...a),
  };
});

const { NostrConnectSheet } = await import("./NostrConnectSheet.js");
const { NostrConnectError, loadSavedSession, saveSession } = await import(
  "../lib/nostrConnect.js"
);

const SESSION: NostrConnectSession = {
  clientSecretKey: "11".repeat(32),
  remotePubkey: "ab".repeat(32),
  relays: ["wss://x.kojira.io", "wss://r.kojira.io"],
};
const SIGNED = { id: "e", pubkey: "ab".repeat(32), kind: 22242 };

/** 呼ばれた AbortSignal で止まる、終わらない待ち */
function pendingUntilAbort(opts: { signal?: AbortSignal }) {
  return new Promise((_, reject) => {
    opts.signal?.addEventListener("abort", () =>
      reject(new NostrConnectError("aborted")),
    );
  });
}

function renderSheet() {
  const props = {
    title: "署名アプリでログイン",
    submit: vi.fn(async (sign: LoginEventSigner) => {
      await sign({ kind: 22242, created_at: 0, tags: [], content: "" });
    }),
    onDone: vi.fn(),
    onFailed: vi.fn(),
    onClose: vi.fn(),
  };
  render(<NostrConnectSheet {...props} />);
  return props;
}

function setCoarse(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: coarse }),
  });
}

beforeEach(() => {
  localStorage.clear();
  waitForConnect.mockReset();
  requestSignEvent.mockReset();
  setCoarse(true);
});

describe("NostrConnectSheet", () => {
  it("スマホでは「Amber で開く」が nostrconnect:// のリンクになり、承認後に署名して終わる", async () => {
    let accept: (s: NostrConnectSession) => void = () => {};
    waitForConnect.mockImplementation(
      () => new Promise<NostrConnectSession>((r) => (accept = r)),
    );
    requestSignEvent.mockResolvedValue(SIGNED);
    const props = renderSheet();

    const open = await screen.findByRole("link", { name: "Amber で開く" });
    expect(open.getAttribute("href")).toMatch(/^nostrconnect:\/\//);
    expect(screen.getByRole("img", { name: "署名アプリでつなぐための QR コード" })).toBeInTheDocument();
    expect(screen.getByText("署名アプリで承認したら、このページに戻ってください。")).toBeInTheDocument();

    await act(async () => accept(SESSION));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(requestSignEvent).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ kind: 22242 }),
      expect.anything(),
    );
    // 次のログインのために接続を覚える
    expect(loadSavedSession()).toEqual(SESSION);
  });

  it("PC では QR を主に出し、読み取りの説明を出す", async () => {
    setCoarse(false);
    waitForConnect.mockImplementation((_req, opts) => pendingUntilAbort(opts));
    renderSheet();
    expect(
      await screen.findByText("スマホの署名アプリ（Amber など）でこの QR を読み取ってください。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "署名アプリでつなぐための QR コード" })).toBeInTheDocument();
  });

  it("キャンセルで閉じる", async () => {
    waitForConnect.mockImplementation((_req, opts) => pendingUntilAbort(opts));
    const props = renderSheet();
    await screen.findByRole("link", { name: "Amber で開く" });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("閉じる（アンマウント）と待ちが止まる", async () => {
    let signal: AbortSignal | undefined;
    waitForConnect.mockImplementation((_req, opts) => {
      signal = opts.signal;
      return pendingUntilAbort(opts);
    });
    const { unmount } = render(
      <NostrConnectSheet
        title="t"
        submit={vi.fn()}
        onDone={vi.fn()}
        onFailed={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("link", { name: "Amber で開く" });
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("時間切れの表示と、「もう一度」で URI を作り直す", async () => {
    waitForConnect.mockRejectedValueOnce(new NostrConnectError("timeout"));
    renderSheet();
    expect(
      await screen.findByText("署名アプリからの応答がありませんでした。もう一度お試しください。"),
    ).toBeInTheDocument();
    const firstUri = waitForConnect.mock.calls[0][0].uri as string;

    waitForConnect.mockImplementation((_req, opts) => pendingUntilAbort(opts));
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    const open = await screen.findByRole("link", { name: "Amber で開く" });
    expect(open.getAttribute("href")).not.toBe(firstUri);
    expect(waitForConnect.mock.calls[1][0].uri).not.toBe(firstUri);
  });

  it("署名アプリが断ったら、その旨を出す", async () => {
    waitForConnect.mockResolvedValue(SESSION);
    requestSignEvent.mockRejectedValue(new NostrConnectError("rejected"));
    const props = renderSheet();
    expect(await screen.findByText("署名アプリで署名が断られました。")).toBeInTheDocument();
    expect(props.onDone).not.toHaveBeenCalled();
    expect(loadSavedSession()).toBeNull();
  });

  it("サーバーで弾かれたなど、署名アプリ以外の失敗は呼び出し元に返す", async () => {
    waitForConnect.mockResolvedValue(SESSION);
    requestSignEvent.mockResolvedValue(SIGNED);
    const props = {
      title: "t",
      submit: vi.fn(async (sign: LoginEventSigner) => {
        await sign({ kind: 22242, created_at: 0, tags: [], content: "" });
        throw new Error("server");
      }),
      onDone: vi.fn(),
      onFailed: vi.fn(),
      onClose: vi.fn(),
    };
    render(<NostrConnectSheet {...props} />);
    await waitFor(() => expect(props.onFailed).toHaveBeenCalled());
    expect(props.onDone).not.toHaveBeenCalled();
  });

  describe("前回の接続を覚えているとき", () => {
    it("つなぎ直さずに、覚えた署名アプリへ直接署名を頼む", async () => {
      saveSession(SESSION);
      let approve: (v: unknown) => void = () => {};
      requestSignEvent.mockImplementation(() => new Promise((r) => (approve = r)));
      const props = renderSheet();

      expect(
        await screen.findByText("前回つないだ署名アプリで署名を待っています…"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Amber などの署名アプリで承認してください（通知から開けます）。"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Amber で開く" })).toBeNull();
      expect(waitForConnect).not.toHaveBeenCalled();

      await act(async () => approve(SIGNED));
      await waitFor(() => expect(props.onDone).toHaveBeenCalled());
      expect(requestSignEvent.mock.calls[0][0]).toEqual(SESSION);
      expect(loadSavedSession()).toEqual(SESSION);
    });

    it("応答が無ければ、覚えた接続を消して nostrconnect:// でつなぎ直す画面にする", async () => {
      saveSession(SESSION);
      requestSignEvent.mockRejectedValueOnce(new NostrConnectError("timeout"));
      waitForConnect.mockImplementation((_req, opts) => pendingUntilAbort(opts));
      renderSheet();

      const open = await screen.findByRole("link", { name: "Amber で開く" });
      expect(open.getAttribute("href")).toMatch(/^nostrconnect:\/\//);
      expect(loadSavedSession()).toBeNull();
      expect(waitForConnect).toHaveBeenCalledTimes(1);
    });

    it("「別の署名アプリでつなぐ」で覚えた接続を消して、つなぎ直す", async () => {
      saveSession(SESSION);
      let signal: AbortSignal | undefined;
      requestSignEvent.mockImplementation((_s, _t, opts) => {
        signal = opts.signal;
        return pendingUntilAbort(opts);
      });
      waitForConnect.mockImplementation((_req, opts) => pendingUntilAbort(opts));
      renderSheet();

      fireEvent.click(await screen.findByRole("button", { name: "別の署名アプリでつなぐ" }));
      expect(await screen.findByRole("link", { name: "Amber で開く" })).toBeInTheDocument();
      expect(signal?.aborted).toBe(true);
      expect(loadSavedSession()).toBeNull();
    });
  });
});
