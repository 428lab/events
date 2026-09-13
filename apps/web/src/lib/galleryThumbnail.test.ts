import { describe, it, expect, vi, afterEach } from "vitest";
import { EVENT_THUMBNAIL_MAX_BYTES } from "@eventer/shared";
import { encodeGalleryThumbnail } from "./galleryThumbnail.js";
import { encodeImageForUpload } from "./encodeImage.js";
vi.mock("./encodeImage.js", () => ({ encodeImageForUpload: vi.fn() }));
const encode = vi.mocked(encodeImageForUpload);
afterEach(() => vi.resetAllMocks());
describe("encodeGalleryThumbnail", () => {
  it.each(["image/webp", "image/jpeg"])("keeps actual %s MIME and uses 320px", async (type) => {
    const source = new Blob(["main"]);
    const small = new Blob(["small"], { type });
    encode.mockResolvedValue(small);
    expect(await encodeGalleryThumbnail(source)).toBe(small);
    expect(encode).toHaveBeenCalledWith(source, 320, 0.8);
  });
  it("omits the encoder's original-blob failure fallback", async () => {
    const source = new Blob(["main"], { type: "image/jpeg" });
    encode.mockResolvedValue(source);
    expect(await encodeGalleryThumbnail(source)).toBeNull();
  });
  it("retries oversized output then omits if still too large", async () => {
    const source = new Blob(["main"]);
    encode.mockResolvedValue(new Blob([new Uint8Array(EVENT_THUMBNAIL_MAX_BYTES + 1)], { type: "image/webp" }));
    expect(await encodeGalleryThumbnail(source)).toBeNull();
    expect(encode.mock.calls).toEqual([[source, 320, 0.8], [source, 320, 0.5]]);
  });
  it("does not send empty or unsupported fallback output", async () => {
    encode.mockResolvedValueOnce(new Blob([], { type: "image/jpeg" }))
      .mockResolvedValueOnce(new Blob(["png"], { type: "image/png" }));
    expect(await encodeGalleryThumbnail(new Blob(["main"]))).toBeNull();
  });
});
