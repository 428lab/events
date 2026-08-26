import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * 2本目以降の選択ステップの再初期化 (#427 実機フィードバックの退行防止)。
 *
 * 実機で「2本目の選択ステップでプレビューもトリムのバーも出ない」症状が出た。
 * 調査の結果、React 層の状態リーク（ステップ間の使い回し）は無く
 * （このテストが固定するとおり、key 再マウントで毎本初期化される）、
 * 症状は「2本目のメタデータが読めず全長0になった」入力で、幅0の枠と
 * 空のプレビューが描画されることによるもの。全長0は VideoSelectStep が
 * エラーに倒すようにした（VideoSelectStep.test.tsx 側で固定）。
 * ここでは 60秒超が2本目以降に来ても、フレッシュな object URL の
 * プレビューと正しい幅のバーが出ることを固定する。
 */

const { probeMock, capabilityMock, conversionMock } = vi.hoisted(() => ({
  probeMock: vi.fn(),
  capabilityMock: vi.fn(async () => ({
    hasVideoEncoder: true, canEncodeVp9: true, canEncodeVp8: true,
    canEncodeH264: true, canEncodeOpus: true,
  })),
  conversionMock: vi.fn(async (..._a: unknown[]) => ({
    invalidReason: null, discardedTracks: [],
    execute: async () => ({ blob: new Blob(["x"], { type: "video/webm" }), mime: "video/webm" as const, width: 640, height: 360 }),
    cancel: async () => {},
  })),
}));
vi.mock("../lib/video/probe.js", () => ({
  probeVideoFile: probeMock,
  detectVideoCapability: capabilityMock,
}));
vi.mock("../lib/video/encode.js", () => ({ createVideoConversion: conversionMock }));
vi.mock("../lib/video/poster.js", () => ({ extractVideoPoster: vi.fn(async () => null) }));

const { VideoUploadFlow } = await import("./VideoUploadFlow.js");

function probedOf(durationMs: number) {
  return {
    input: {},
    probe: {
      container: "mov", fileBytes: 1024, durationMs, hasVideoTrack: true,
      width: 640, height: 360, videoCodec: "avc", audioCodec: "aac",
      canDecodeVideo: true, canDecodeAudio: true,
    },
    approxFps: 30,
  };
}

class IdleXHR {
  upload: { onprogress: unknown } = { onprogress: null };
  withCredentials = false;
  onload: unknown; onerror: unknown; onabort: unknown;
  open() {} send() {} abort() {}
}

let urlSeq = 0;
const revoked: string[] = [];

beforeEach(() => {
  urlSeq = 0;
  revoked.length = 0;
  vi.stubGlobal("XMLHttpRequest", IdleXHR);
  // jsdom には無いので object URL を偽装（生成と revoke を記録）
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:mock-${++urlSeq}`),
    revokeObjectURL: vi.fn((u: string) => revoked.push(u)),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  // URL スタブは消さない（RTL の自動 cleanup がこの後に走り、
  // アンマウント時の revokeObjectURL がまだ要るため）
});

const video = (name: string) => new File([new Uint8Array(8)], name, { type: "video/mp4" });

describe("2本目以降の選択ステップ初期化", () => {
  it("60秒超が2本目に来てもプレビューとトリムのバーが出る", async () => {
    // 1本目 90s → 2本目 90s
    probeMock
      .mockResolvedValueOnce(probedOf(90_000))
      .mockResolvedValueOnce(probedOf(91_000));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <VideoUploadFlow eventId="ev" files={[video("a.mp4"), video("b.mp4")]} onClose={() => {}} />
      </QueryClientProvider>,
    );
    // 1本目: プレビューとバー
    await waitFor(() => expect(screen.getByTestId("trim-frame")).toBeInTheDocument());
    const v1 = document.querySelector("video");
    expect(v1).not.toBeNull();
    const url1 = v1!.getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "この範囲で決定" }));

    // 2本目: バーとプレビューが出るか（実機で出なかった箇所）
    await waitFor(() => expect(screen.getByText("動画 2 本中 2 本目")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("trim-frame")).toBeInTheDocument());
    // 全長 91s に対する枠 60s = 幅 65.9…% のはず（0% なら初期化漏れ）
    const frame = screen.getByTestId("trim-frame");
    expect(frame.style.width).not.toBe("0%");
    const v2 = document.querySelector("video");
    expect(v2).not.toBeNull();
    const url2 = v2!.getAttribute("src");
    expect(url2).not.toBe(url1);       // 前の動画の URL を使い回していない
    expect(revoked).not.toContain(url2); // revoke 済み URL でない
  });
});
