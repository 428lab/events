import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AvatarUploadCard } from "./AvatarUploadCard.js";
import { cropToImage } from "../lib/cropImage.js";
// jsdom's File lacks arrayBuffer(); browsers and Node have it.
import { File as NodeFile } from "node:buffer";
vi.mock("../api/hooks.js", () => ({ useMe: () => ({ data: { id: "self", avatarUrl: "/old.webp" } }) }));
vi.mock("../lib/cropImage.js", () => ({ cropToImage: vi.fn() }));
vi.mock("react-easy-crop", () => ({ default: ({ onCropComplete }: { onCropComplete: (a: unknown, b: unknown) => void }) =>
  <button onClick={() => onCropComplete({ x: 25, y: 0, width: 50, height: 100 }, { x: 0, y: 0, width: 200, height: 200 })}>crop ready</button> }));
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
  expect(cropToImage).toHaveBeenCalledWith("blob:avatar", expect.any(Object), 512, 512, 1024 * 1024, true);
});
it.each(["image/png", "image/jpeg"])("uploads the selected fallback with its actual MIME: %s", async mime => {
  vi.mocked(cropToImage).mockResolvedValue(new Blob(["fallback"], { type: mime }));
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ avatarUrl: "/new" })));
  vi.stubGlobal("fetch", fetcher);
  const { container } = setup(); await choose(container);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("アイコンを保存しました。");
  expect(fetcher.mock.calls[0][1].headers["Content-Type"]).toBe(mime);
});
it("rejects unsupported input before decoding", async () => {
  const { container } = setup();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["gif"], "image.gif", { type: "image/gif" })] } });
  expect(screen.getByRole("alert")).toBeVisible();
  expect(createImageBitmap).not.toHaveBeenCalled();
});
it("uploads an SVG as-is apart from the root viewBox chosen with the square crop (#576)", async () => {
  const original = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" onload="alert(1)"><script>alert(1)</script><rect width="200" height="100"/></svg>`;
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ avatarUrl: "/new.svg" })));
  vi.stubGlobal("fetch", fetcher);
  const { container, qc } = setup();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new NodeFile([original], "icon.svg", { type: "image/svg+xml" })] } });
  fireEvent.click(await screen.findByText("crop ready"));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("アイコンを保存しました。");
  expect(createImageBitmap).not.toHaveBeenCalled();
  expect(cropToImage).not.toHaveBeenCalled();
  const init = fetcher.mock.calls[0][1] as RequestInit;
  expect(init.headers).toEqual({ "Content-Type": "image/svg+xml" });
  // The mocked cropper reports the centre square of the 200x100 drawing as percentages.
  expect(await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(init.body as Blob); })).toBe(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="50 0 100 100" width="512" height="512"><script>alert(1)</script><rect width="200" height="100"/></svg>`);
  expect(qc.getQueryData(["me"])).toEqual({ user: { id: "self", avatarUrl: "/new.svg" }, isAdmin: true });
});
it.each([
  ["over 200KB", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><!--${"x".repeat(200 * 1024)}--></svg>`],
  ["non-svg root", `<html xmlns="http://www.w3.org/1999/xhtml"/>`],
  ["no size", `<svg xmlns="http://www.w3.org/2000/svg"/>`],
])("rejects an SVG that cannot be used: %s", async (_, text) => {
  const { container } = setup();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new NodeFile([text], "icon.svg", { type: "image/svg+xml" })] } });
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
});
