import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * 動画投稿ダイアログのキャンセル (#408 レビュー指摘)。
 * アップロード中にキャンセルすると XHR が中断され、投稿が成立しないこと。
 * （閉じるだけだと裏で送信が完走し、キャンセルしたはずの動画が一覧に出る）
 *
 * WebCodecs は jsdom に無いので、probe/poster をモックして
 * 「変換なしの素通し経路」でアップロード段まで進める。
 */

vi.mock("../lib/video/probe.js", () => ({
  // WebCodecs なし環境 × MP4 入力（上限内）→ decideVideoPlan（本物）が素通しを選ぶ
  probeVideoFile: vi.fn(async () => ({
    input: {},
    probe: {
      container: "mp4",
      fileBytes: 1024,
      durationMs: 30_000,
      hasVideoTrack: true,
      width: 640,
      height: 360,
      videoCodec: "avc",
      audioCodec: "aac",
      canDecodeVideo: false,
      canDecodeAudio: false,
    },
    approxFps: 30,
  })),
  detectVideoCapability: vi.fn(async () => ({
    hasVideoEncoder: false,
    canEncodeVp9: false,
    canEncodeVp8: false,
    canEncodeH264: false,
    canEncodeOpus: false,
  })),
}));
vi.mock("../lib/video/encode.js", () => ({
  createVideoConversion: vi.fn(async () => {
    throw new Error("素通し経路では呼ばれないはず");
  }),
}));
vi.mock("../lib/video/poster.js", () => ({
  extractVideoPoster: vi.fn(async () => null),
}));

const { VideoUploadDialog } = await import("./VideoUploadDialog.js");

/** 送信を完走させない XHR の偽物。abort の呼ばれ方だけを見る */
class FakeXHR {
  static last: FakeXHR | null = null;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  withCredentials = false;
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  sent = false;
  aborted = false;
  open() {}
  send() {
    this.sent = true;
    FakeXHR.last = this;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

beforeEach(() => {
  FakeXHR.last = null;
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VideoUploadDialog のキャンセル", () => {
  it("アップロード中のキャンセルで XHR が中断され、投稿が成立しない", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <VideoUploadDialog
          eventId="ev-1"
          file={new File([new Uint8Array(1024)], "v.mp4", { type: "video/mp4" })}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );

    // 素通し経路なので変換もトリム (#425) も挟まずアップロード段に入る
    // （素通しでは切り出せないため、トリム UI はこの経路には出さない）
    await waitFor(() => {
      expect(screen.getByText(/アップロード中/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("trim-frame")).toBeNull();
    expect(FakeXHR.last?.sent).toBe(true);
    expect(FakeXHR.last?.aborted).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(FakeXHR.last?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalled();
    // 中断されたので成功時の一覧更新（invalidateQueries）は走らない
    await Promise.resolve();
    await Promise.resolve();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
