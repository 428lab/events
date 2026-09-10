import { afterEach, expect, it, vi } from "vitest";
import { cropToImage } from "./cropImage.js";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([
  { native: true, png: 10, jpeg: 20, expected: "image/webp" },
  { native: false, png: 10, jpeg: 20, expected: "image/png" },
  { native: false, png: 30, jpeg: 20, expected: "image/jpeg" },
])("prefers WebP, otherwise compares actual encoded sizes: %o", async data => {
  vi.stubGlobal("Image", class { onload?: () => void; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: "" } as unknown as CanvasRenderingContext2D);
  const encoder = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, requested) => {
    const mime = requested === "image/webp" && !data.native ? "image/png" : requested!;
    const size = mime === "image/png" ? data.png : mime === "image/jpeg" ? data.jpeg : 40;
    callback(new Blob([new Uint8Array(size)], { type: mime }));
  });
  const result = await cropToImage("image", { x: 0, y: 0, width: 512, height: 512 }, 512, 512, 1024 * 1024, true);
  expect(result.type).toBe(data.expected);
  if (data.native) expect(encoder).toHaveBeenCalledTimes(1);
  else expect(encoder.mock.calls.map(call => call[1])).toEqual(["image/webp", "image/png", "image/jpeg"]);
});
