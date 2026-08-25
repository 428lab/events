import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * 投稿ダイアログのトリム段 (#425)。
 * - 60秒超（変換経路）: トリム UI が必須で開き、確定した範囲が変換に渡る
 * - 60秒以内（変換経路）: トリムは畳んだ任意項目。既定は全範囲 = trim なしで変換
 * WebCodecs は jsdom に無いので probe/encode/poster をモックする。
 */

const { probeMock, capabilityMock, conversionMock } = vi.hoisted(() => ({
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
}));

vi.mock("../lib/video/probe.js", () => ({
  probeVideoFile: probeMock,
  detectVideoCapability: capabilityMock,
}));
vi.mock("../lib/video/encode.js", () => ({
  createVideoConversion: conversionMock,
}));
vi.mock("../lib/video/poster.js", () => ({
  extractVideoPoster: vi.fn(async () => null),
}));

const { VideoUploadDialog } = await import("./VideoUploadDialog.js");

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

/** アップロードを完走させない XHR の偽物（uploading 段で止める） */
class IdleXHR {
  upload: { onprogress: unknown } = { onprogress: null };
  withCredentials = false;
  onload: unknown;
  onerror: unknown;
  onabort: unknown;
  open() {}
  send() {}
  abort() {}
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <VideoUploadDialog
        eventId="ev-1"
        file={new File([new Uint8Array(8)], "v.mov", { type: "video/quicktime" })}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  conversionMock.mockClear();
  vi.stubGlobal("XMLHttpRequest", IdleXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("トリム段 (#425)", () => {
  it("60秒超: トリム UI が必須で開き、確定した既定範囲（先頭60秒）が変換に渡る", async () => {
    probeMock.mockResolvedValue(probedOf(90_000));
    renderDialog();

    // 必須で開く（案内文とトリム枠が出る。任意用のトグルは出ない）
    await waitFor(() => {
      expect(screen.getByTestId("trim-frame")).toBeInTheDocument();
    });
    expect(screen.getByText(/動画が60秒を超えています/)).toBeInTheDocument();
    expect(screen.queryByText("範囲を選ぶ（トリム）")).toBeNull();
    // 開始・終了・長さの秒数表示
    expect(screen.getByText(/開始 0:00 ／ 終了 1:00 ／ 長さ 1:00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "この範囲で投稿" }));
    await waitFor(() => expect(conversionMock).toHaveBeenCalledTimes(1));
    const opts = conversionMock.mock.calls[0]![2] as { trim?: unknown };
    expect(opts.trim).toEqual({ startMs: 0, endMs: 60_000 });
  });

  it("60秒以内: トリムは畳んだ任意項目。既定（全範囲）なら trim なしで変換", async () => {
    probeMock.mockResolvedValue(probedOf(30_000));
    renderDialog();

    // 任意のトグルだけが出る（必須の案内文は出ない・枠は畳まれている）
    const toggle = await screen.findByText("範囲を選ぶ（トリム）");
    expect(screen.queryByText(/動画が60秒を超えています/)).toBeNull();
    expect(screen.getByTestId("trim-frame")).not.toBeVisible();

    // 開くと枠が見える（開いても既定は全範囲のまま）
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId("trim-frame")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "この範囲で投稿" }));
    await waitFor(() => expect(conversionMock).toHaveBeenCalledTimes(1));
    const opts = conversionMock.mock.calls[0]![2] as { trim?: unknown };
    expect(opts.trim).toBeNull();
  });
});
