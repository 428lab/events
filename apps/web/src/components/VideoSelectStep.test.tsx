import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Dialog } from "@mui/material";

/**
 * 第1段階（範囲選択 #427）の1本ぶん。エンコードはせず、確定した素材を
 * onResult で返すことを確かめる。WebCodecs は jsdom に無いので probe をモック。
 */

const { probeMock, capabilityMock } = vi.hoisted(() => ({
  probeMock: vi.fn(),
  capabilityMock: vi.fn(),
}));

vi.mock("../lib/video/probe.js", () => ({
  probeVideoFile: probeMock,
  detectVideoCapability: capabilityMock,
}));

const { VideoSelectStep } = await import("./VideoSelectStep.js");

const FULL = {
  hasVideoEncoder: true,
  canEncodeVp9: true,
  canEncodeVp8: true,
  canEncodeH264: true,
  canEncodeOpus: true,
};
const NONE = {
  hasVideoEncoder: false,
  canEncodeVp9: false,
  canEncodeVp8: false,
  canEncodeH264: false,
  canEncodeOpus: false,
};

function probedOf(durationMs: number, container = "mov", decodable = true) {
  return {
    input: {},
    probe: {
      container,
      fileBytes: 1024,
      durationMs,
      hasVideoTrack: true,
      width: 640,
      height: 360,
      videoCodec: "avc",
      audioCodec: "aac",
      canDecodeVideo: decodable,
      canDecodeAudio: decodable,
    },
    approxFps: 30,
  };
}

function renderStep(queue: { index: number; total: number } | null = null) {
  const onResult = vi.fn();
  render(
    <Dialog open>
      <VideoSelectStep
        file={new File([new Uint8Array(8)], "v.mov", { type: "video/quicktime" })}
        queue={queue}
        onResult={onResult}
      />
    </Dialog>,
  );
  return onResult;
}

beforeEach(() => {
  capabilityMock.mockResolvedValue(FULL);
});

describe("VideoSelectStep (#427)", () => {
  it("60秒超: トリム必須で開き、決定すると範囲つきの素材を返す（エンコードはしない）", async () => {
    probeMock.mockResolvedValue(probedOf(90_000));
    const onResult = renderStep({ index: 1, total: 2 });
    await waitFor(() =>
      expect(screen.getByTestId("trim-frame")).toBeInTheDocument(),
    );
    expect(screen.getByText(/動画が60秒を超えています/)).toBeInTheDocument();
    expect(screen.getByText("動画 2 本中 1 本目")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "この範囲で決定" }));
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]![0];
    expect(r.kind).toBe("ready");
    expect(r.trim).toEqual({ startMs: 0, endMs: 60_000 });
    expect(r.plan).toMatchObject({ kind: "encode", container: "webm" });
    // 解析済みの素材（demux 済み Input）を第2段階が再利用する
    expect(r.probed.probe.durationMs).toBe(90_000);
  });

  it("60秒以内: トリム UI を出さず自動確定（全範囲 = trim なし）", async () => {
    // 「短い動画も任意でトリム」は落とした（元要望は60秒超のみ。
    // キューの全本で決定タップを要求する代償に見合わない）
    probeMock.mockResolvedValue(probedOf(30_000));
    const onResult = renderStep();
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("trim-frame")).toBeNull();
    const r = onResult.mock.calls[0]![0];
    expect(r).toMatchObject({ kind: "ready", trim: null });
    expect(r.plan).toMatchObject({ kind: "encode" });
  });

  it("60秒以内でも音声を落とす経路は確認を出す（黙って無音にしない）", async () => {
    const base = probedOf(30_000);
    probeMock.mockResolvedValue({
      ...base,
      probe: { ...base.probe, audioCodec: "unknown", canDecodeAudio: false },
    });
    const onResult = renderStep();
    await waitFor(() =>
      expect(screen.getByText(/音声なしで投稿しますか/)).toBeInTheDocument(),
    );
    expect(onResult).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "音声なしで投稿" }));
    expect(onResult.mock.calls[0]![0]).toMatchObject({
      kind: "ready",
      trim: null,
      plan: { kind: "encode", audio: "none" },
    });
  });

  it("素通し経路: 選ぶものが無いので UI を出さずにそのまま確定する", async () => {
    probeMock.mockResolvedValue(probedOf(30_000, "mp4", false));
    capabilityMock.mockResolvedValue(NONE);
    const onResult = renderStep();
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0]![0]).toMatchObject({
      kind: "ready",
      trim: null,
      plan: { kind: "passthrough", mime: "video/mp4" },
    });
  });

  it("受けられない入力: エラーを見せ、閉じると理由つきの failed を返す", async () => {
    // WebCodecs なし × 60秒超の MP4 → トリムで救えない too-long
    probeMock.mockResolvedValue(probedOf(90_000, "mp4", false));
    capabilityMock.mockResolvedValue(NONE);
    const onResult = renderStep();
    await waitFor(() =>
      expect(screen.getByText(/60秒以内にしてください/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onResult.mock.calls[0]![0]).toMatchObject({ kind: "failed" });
  });

  it("複数本のとき: 「この動画をやめる」と「すべてキャンセル」を返し分ける", async () => {
    probeMock.mockResolvedValue(probedOf(90_000));
    const onResult = renderStep({ index: 1, total: 2 });
    await waitFor(() =>
      expect(screen.getByTestId("trim-frame")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "この動画をやめる" }));
    expect(onResult.mock.calls[0]![0]).toEqual({ kind: "skip" });
  });

  it("ボタン行は折り返し可能（スマホ幅で3つ全部が見えるように）", async () => {
    // jsdom では 375px 幅のレイアウトを再現できないため、崩れの原因だった
    // 「MUI 既定の nowrap」を上書きしていること（flex-wrap: wrap）を確かめる
    probeMock.mockResolvedValue(probedOf(90_000));
    renderStep({ index: 1, total: 2 });
    await waitFor(() =>
      expect(screen.getByTestId("trim-frame")).toBeInTheDocument(),
    );
    // 3ボタンが同じ行に居る
    expect(screen.getByRole("button", { name: "この範囲で決定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "すべてキャンセル" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この動画をやめる" })).toBeInTheDocument();
    const actions = document.querySelector(".MuiDialogActions-root");
    expect(actions).toHaveStyle({ flexWrap: "wrap" });
  });

  it("長さが取れない入力（duration 0）は壊れたトリム UI を出さずエラーにする", async () => {
    // 実機の iOS で複数選択の2本目のメタデータが読めず全長0になると、
    // 幅0の枠・空のプレビューという壊れたトリム段が出ていた症状への防御
    probeMock.mockResolvedValue(probedOf(0));
    const onResult = renderStep();
    await waitFor(() =>
      expect(screen.getByText(/このブラウザでは動画を変換できません/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("trim-frame")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onResult.mock.calls[0]![0]).toMatchObject({ kind: "failed" });
  });

  it("すべてキャンセル", async () => {
    probeMock.mockResolvedValue(probedOf(90_000));
    const onResult = renderStep({ index: 2, total: 3 });
    await waitFor(() =>
      expect(screen.getByTestId("trim-frame")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "すべてキャンセル" }));
    expect(onResult.mock.calls[0]![0]).toEqual({ kind: "cancelAll" });
  });
});
