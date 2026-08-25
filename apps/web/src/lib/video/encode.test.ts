import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 変換に渡る範囲の検証 (#425)。WebCodecs は jsdom に無いので mediabunny を
 * モックし、「トリム範囲が秒に換算されて Conversion.init に渡ること」
 * （= 入力段のトリムなので映像と音声が同じ範囲で切れること）だけを固定する。
 */

const { initMock } = vi.hoisted(() => ({
  initMock: vi.fn(async (_opts: unknown) => ({
    isValid: true,
    discardedTracks: [],
    onProgress: undefined,
    execute: async () => {},
    cancel: async () => {},
  })),
}));

vi.mock("mediabunny", () => ({
  BufferTarget: class {
    buffer: ArrayBuffer | null = new ArrayBuffer(8);
  },
  Output: class {
    constructor(public options: unknown) {}
  },
  WebMOutputFormat: class {},
  Mp4OutputFormat: class {},
  Quality: class {
    constructor(public options: unknown) {}
  },
  Conversion: { init: initMock },
}));

const { createVideoConversion } = await import("./encode.js");
type ProbedVideo = import("./probe.js").ProbedVideo;

const probed = {
  input: {},
  probe: {
    container: "mov",
    fileBytes: 1024,
    durationMs: 90_000,
    hasVideoTrack: true,
    width: 1920,
    height: 1080,
    videoCodec: "avc",
    audioCodec: "aac",
    canDecodeVideo: true,
    canDecodeAudio: true,
  },
  approxFps: 30,
} as unknown as ProbedVideo;

const plan = {
  kind: "encode",
  container: "webm",
  videoCodec: "vp9",
  audio: "opus",
  confirmDropAudio: false,
} as const;

beforeEach(() => {
  initMock.mockClear();
});

describe("createVideoConversion × トリム (#425)", () => {
  it("trim はミリ秒→秒に換算して Conversion に渡す", async () => {
    await createVideoConversion(probed, plan, {
      trim: { startMs: 5_000, endMs: 65_000 },
    });
    expect(initMock).toHaveBeenCalledTimes(1);
    const opts = initMock.mock.calls[0]![0] as { trim?: { start: number; end: number } };
    expect(opts.trim).toEqual({ start: 5, end: 65 });
  });

  it("trim なしなら Conversion に trim を渡さない（無変換コピーを妨げない）", async () => {
    await createVideoConversion(probed, plan, {});
    const opts = initMock.mock.calls[0]![0] as { trim?: unknown };
    expect("trim" in opts).toBe(false);
  });
});
