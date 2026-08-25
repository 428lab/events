import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * 動画投稿の2段階フロー (#427)。
 * - 第1段階: 全本の範囲選択が**先に**終わる（それまでエンコードしない）
 * - 第2段階: 1本ずつ順にエンコード→アップロード
 * - キャンセル系: この本をやめて次へ / すべてキャンセル
 * - 50枠切れで残りを中止し、まとめが出る
 * WebCodecs は jsdom に無いので probe/encode/poster をモックする。
 */

const { probeMock, capabilityMock, conversionMock, posterMock } = vi.hoisted(
  () => ({
    probeMock: vi.fn(),
    capabilityMock: vi.fn(async () => ({
      hasVideoEncoder: true,
      canEncodeVp9: true,
      canEncodeVp8: true,
      canEncodeH264: true,
      canEncodeOpus: true,
    })),
    conversionMock: vi.fn(async (..._args: unknown[]) => ({
      invalidReason: null,
      discardedTracks: [],
      execute: async () => ({
        blob: new Blob(["x"], { type: "video/webm" }),
        mime: "video/webm" as const,
        width: 640,
        height: 360,
      }),
      cancel: async () => {},
    })),
    posterMock: vi.fn(async () => null),
  }),
);

vi.mock("../lib/video/probe.js", () => ({
  probeVideoFile: probeMock,
  detectVideoCapability: capabilityMock,
}));
vi.mock("../lib/video/encode.js", () => ({
  createVideoConversion: conversionMock,
}));
vi.mock("../lib/video/poster.js", () => ({
  extractVideoPoster: posterMock,
}));

const { VideoUploadFlow } = await import("./VideoUploadFlow.js");

function probedOf(durationMs: number) {
  return {
    input: {},
    probe: {
      container: "mov",
      fileBytes: 1024,
      durationMs,
      hasVideoTrack: true,
      width: 640,
      height: 360,
      videoCodec: "avc",
      audioCodec: "aac",
      canDecodeVideo: true,
      canDecodeAudio: true,
    },
    approxFps: 30,
  };
}

/** アップロードの偽物。既定は非同期で 201 成功。
 * nextResponses で本ごとの応答を差し替えられる */
class FakeXHR {
  static instances: FakeXHR[] = [];
  static nextResponses: Array<{ status: number; body: string }> = [];
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  withCredentials = false;
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  open() {}
  send() {
    FakeXHR.instances.push(this);
    const res = FakeXHR.nextResponses.shift() ?? { status: 201, body: "{}" };
    setTimeout(() => {
      if (this.aborted) return;
      this.status = res.status;
      this.responseText = res.body;
      this.onload?.();
    }, 0);
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const video = (name: string) =>
  new File([new Uint8Array(8)], name, { type: "video/mp4" });

function renderFlow(files: File[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <VideoUploadFlow eventId="ev-1" files={files} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

/** 選択段の「この範囲で決定」を1回押す */
async function confirmSelect() {
  const btn = await screen.findByRole("button", { name: "この範囲で決定" });
  fireEvent.click(btn);
}

beforeEach(() => {
  probeMock.mockReset();
  probeMock.mockImplementation(async () => probedOf(30_000));
  conversionMock.mockClear();
  posterMock.mockClear();
  FakeXHR.instances = [];
  FakeXHR.nextResponses = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("2段階フロー (#427)", () => {
  it("2本: 範囲選択が全部先に終わってから、1本ずつ変換→アップロードされる", async () => {
    const onClose = renderFlow([video("a.mp4"), video("b.mp4")]);

    // 1本目の選択。「動画 2 本中 1 本目」
    expect(await screen.findByText("動画 2 本中 1 本目")).toBeInTheDocument();
    await confirmSelect();
    // まだエンコードは始まらない（選択が全部先）
    expect(conversionMock).not.toHaveBeenCalled();

    // 2本目の選択
    expect(await screen.findByText("動画 2 本中 2 本目")).toBeInTheDocument();
    await confirmSelect();

    // 第2段階: 2本とも順に処理され、全成功なら黙って閉じる
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(conversionMock).toHaveBeenCalledTimes(2);
    expect(FakeXHR.instances.length).toBe(2);
    // 1本目の解析結果（demux 済み probed）がそのまま変換に渡っている
    expect(probeMock).toHaveBeenCalledTimes(2);
  });

  it("1本目の選択をやめても2本目に進み、2本目だけ処理される", async () => {
    const onClose = renderFlow([video("a.mp4"), video("b.mp4")]);
    await screen.findByText("動画 2 本中 1 本目");
    fireEvent.click(
      await screen.findByRole("button", { name: "この動画をやめる" }),
    );
    expect(await screen.findByText("動画 2 本中 2 本目")).toBeInTheDocument();
    await confirmSelect();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(conversionMock).toHaveBeenCalledTimes(1);
    expect(FakeXHR.instances.length).toBe(1);
  });

  it("選択段の「すべてキャンセル」で何も処理せず閉じる", async () => {
    const onClose = renderFlow([video("a.mp4"), video("b.mp4")]);
    await screen.findByText("動画 2 本中 1 本目");
    fireEvent.click(
      await screen.findByRole("button", { name: "すべてキャンセル" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(conversionMock).not.toHaveBeenCalled();
    expect(FakeXHR.instances.length).toBe(0);
  });

  it("50枠切れ: 1本目で photo_limit が出たら残りを中止し、まとめが出る", async () => {
    FakeXHR.nextResponses = [
      { status: 409, body: JSON.stringify({ error: "photo_limit" }) },
    ];
    const onClose = renderFlow([video("a.mp4"), video("b.mp4")]);
    await confirmSelect();
    await confirmSelect();

    // まとめ: 成功0・失敗1（50枠）。2本目は変換すらされない
    await waitFor(() =>
      expect(screen.getByText(/0 本を投稿しました（1 本は失敗）/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/50/)).toBeInTheDocument();
    expect(conversionMock).toHaveBeenCalledTimes(1);
    expect(FakeXHR.instances.length).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("処理段の「すべてキャンセル」でアップロードを中断して閉じる", async () => {
    // 応答を返さない XHR にして処理段で止める
    class IdleXHR extends FakeXHR {
      override send() {
        FakeXHR.instances.push(this);
        // 応答しない（アップロード中のまま）
      }
    }
    vi.stubGlobal("XMLHttpRequest", IdleXHR);
    const onClose = renderFlow([video("a.mp4"), video("b.mp4")]);
    await confirmSelect();
    await confirmSelect();
    await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
    fireEvent.click(
      await screen.findByRole("button", { name: "すべてキャンセル" }),
    );
    expect(FakeXHR.instances[0]!.aborted).toBe(true);
    // 全部キャンセル（失敗ではない）なのでまとめ無しで閉じる
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(FakeXHR.instances.length).toBe(1);
  });
});
