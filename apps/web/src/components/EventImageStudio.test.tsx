import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * テンプレートで作った画像の「押し忘れ」対策。触ってからイベント画像にするまでは
 * 「まだイベント画像になっていません」と出し、親に dirty を知らせる。
 */

vi.mock("../lib/imageTemplates.js", async (orig) => ({
  ...(await orig<typeof import("../lib/imageTemplates.js")>()),
  loadFont: async () => undefined,
  drawEventImage: () => undefined,
}));

const { EventImageStudio } = await import("./EventImageStudio.js");
type Handle = import("./EventImageStudio.js").EventImageStudioHandle;

// jsdom の canvas は toBlob を持たないので、決まった Blob を返す
HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
  cb(new Blob(["x"], { type: "image/webp" }));
};

function draw(onGenerated = vi.fn(async (_blob: Blob) => undefined), onDirtyChange = vi.fn()) {
  const ref = createRef<Handle>();
  render(
    <EventImageStudio ref={ref} title="テスト" onGenerated={onGenerated} onDirtyChange={onDirtyChange} />,
  );
  return { ref, onGenerated, onDirtyChange };
}

const pending = () => screen.queryByText("作成中の画像（まだイベント画像になっていません）");

describe("EventImageStudio の押し忘れ対策", () => {
  it("開いただけでは dirty にならず、背景を変えると dirty になる", () => {
    const { onDirtyChange } = draw();
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "花火" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(pending()).toBeInTheDocument();
  });

  it("「この画像をイベント画像にする」で画像を渡し、dirty が消えて反映済みの表示になる", async () => {
    const { onGenerated, onDirtyChange } = draw();
    fireEvent.click(screen.getByRole("button", { name: "花火" }));
    fireEvent.click(screen.getByRole("button", { name: "この画像をイベント画像にする" }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
    expect(onGenerated.mock.calls[0]![0]).toBeInstanceOf(Blob);
    await screen.findByText("イベント画像を変えました");
    expect(screen.getByText("作成中の画像（イベント画像にしました）")).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("反映したあとにまた触ると、まだイベント画像になっていない表示に戻る", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "この画像をイベント画像にする" }));
    await screen.findByText("イベント画像を変えました");
    fireEvent.click(screen.getByRole("button", { name: "花火" }));
    expect(pending()).toBeInTheDocument();
    expect(screen.queryByText("イベント画像を変えました")).not.toBeInTheDocument();
  });

  it("アップロードに失敗したら dirty のまま、apply は false を返す", async () => {
    const onGenerated = vi.fn(async (_blob: Blob) => {
      throw new Error("upload failed");
    });
    const { ref, onDirtyChange } = draw(onGenerated);
    fireEvent.click(screen.getByRole("button", { name: "花火" }));
    let ok: boolean | undefined;
    await waitFor(async () => {
      ok = await ref.current!.apply();
    });
    expect(ok).toBe(false);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(pending()).toBeInTheDocument();
  });
});
