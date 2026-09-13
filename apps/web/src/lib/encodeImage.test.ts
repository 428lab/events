import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeImageForUpload } from "./encodeImage.js";

function mockCanvas(width: number, height: number, webp = true) {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const output = new Blob(["encoded"], { type: webp ? "image/webp" : "image/jpeg" });
  let canvas: HTMLCanvasElement | undefined;
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation(function (this: HTMLCanvasElement, callback) {
      canvas = this;
      callback(output);
    });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue(webp ? "data:image/webp;base64," : "data:image/png;base64,");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage, fillRect, fillStyle: "",
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("Image", class {
    width = width;
    height = height;
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:fixture"),
    revokeObjectURL: vi.fn(),
  });
  return { drawImage, fillRect, toBlob, output, outputCanvas: () => canvas! };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("encodeImageForUpload centerCropSquare", () => {
  it.each([
    [1200, 800, 200, 0, 800],
    [600, 900, 0, 150, 600],
    [401, 200, 100.5, 0, 200],
    [80, 40, 20, 0, 40],
    [40, 80, 0, 20, 40],
    [40, 40, 0, 0, 40],
  ])("center-crops %ix%i and encodes exactly 320x320", async (w, h, x, y, side) => {
    const { drawImage, toBlob, output, outputCanvas } = mockCanvas(w, h);
    expect(await encodeImageForUpload(new Blob(["source"]), 320, 0.8, true)).toBe(output);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), x, y, side, side, 0, 0, 320, 320);
    const canvas = outputCanvas();
    expect([canvas.width, canvas.height]).toEqual([320, 320]);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.8);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
  });

  it("retains JPEG fallback with a white 320x320 background", async () => {
    const { fillRect, toBlob, output } = mockCanvas(600, 900, false);
    expect(await encodeImageForUpload(new Blob(["source"]), 320, 0.5, true)).toBe(output);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 320, 320);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.5);
  });

  it.each([[1200, 800, 320, 213], [80, 40, 80, 40]])(
    "keeps existing main-image aspect/no-upscale behavior for %ix%i",
    async (w, h, expectedW, expectedH) => {
      const { drawImage, outputCanvas } = mockCanvas(w, h);
      await encodeImageForUpload(new Blob(["source"]), 320, 0.8);
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, expectedW, expectedH);
      const canvas = outputCanvas();
      expect([canvas.width, canvas.height]).toEqual([expectedW, expectedH]);
    },
  );
});
