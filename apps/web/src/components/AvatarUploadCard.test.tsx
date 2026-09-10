import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AvatarUploadCard } from "./AvatarUploadCard.js";
import { cropToImage } from "../lib/cropImage.js";
vi.mock("../api/hooks.js", () => ({ useMe: () => ({ data: { id: "self", avatarUrl: "/old.webp" } }) }));
vi.mock("../lib/cropImage.js", () => ({ cropToImage: vi.fn() }));
vi.mock("react-easy-crop", () => ({ default: ({ onCropComplete }: { onCropComplete: (a: unknown, b: unknown) => void }) =>
  <button onClick={() => onCropComplete({}, { x: 0, y: 0, width: 200, height: 200 })}>crop ready</button> }));
beforeEach(() => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 200, height: 300, close: vi.fn() }));
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:avatar");
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(cropToImage).mockResolvedValue(new Blob(["encoded"], { type: "image/webp" }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup() {
  const qc = new QueryClient();
  qc.setQueryData(["me"], { user: { id: "self", avatarUrl: "/old.webp" }, isAdmin: true });
  const ui = render(<QueryClientProvider client={qc}><AvatarUploadCard /></QueryClientProvider>);
  return { ...ui, qc };
}
async function choose(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["original"], "photo.jpg", { type: "image/jpeg" })] } });
  fireEvent.click(await screen.findByText("crop ready"));
}
it("keeps the crop and old avatar on failure, then saves WebP and updates the nested user cache", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 500 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ avatarUrl: "/new.webp" })));
  vi.stubGlobal("fetch", fetcher);
  const { container, qc } = setup(); await choose(container);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(qc.getQueryData(["me"])).toEqual({ user: { id: "self", avatarUrl: "/old.webp" }, isAdmin: true });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("アイコンを保存しました。");
  expect(qc.getQueryData(["me"])).toEqual({ user: { id: "self", avatarUrl: "/new.webp" }, isAdmin: true });
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/webp" } });
  expect(cropToImage).toHaveBeenCalledWith("blob:avatar", expect.any(Object), 512, 512, 1024 * 1024);
});
it("does not upload a browser PNG fallback", async () => {
  vi.mocked(cropToImage).mockResolvedValue(new Blob(["fallback"], { type: "image/png" }));
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const { container } = setup(); await choose(container);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects unsupported input before decoding", async () => {
  const { container } = setup();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["svg"], "image.svg", { type: "image/svg+xml" })] } });
  expect(screen.getByRole("alert")).toBeVisible();
  expect(createImageBitmap).not.toHaveBeenCalled();
});
