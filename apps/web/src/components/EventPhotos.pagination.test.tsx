import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { EventPhoto, EventPhotosPage, EventRole } from "@eventer/shared";
import { i18next } from "../i18n/index.js";

const { getMock, delMock } = vi.hoisted(() => ({ getMock: vi.fn(), delMock: vi.fn() }));
vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return { ...actual, api: { ...actual.api, get: getMock, del: delMock } };
});
vi.mock("../lib/encodeImage.js", () => ({ encodeImageForUpload: vi.fn(async (f: Blob) => f) }));
const { EventPhotos } = await import("./EventPhotos.js");

function media(count: number, eventId = "ev"): EventPhoto[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${eventId}-${count - i}`, eventId, userId: "owner", userName: "Author",
    userAvatarUrl: null, commentCount: 0, createdAt: count - i,
    kind: "photo", durationMs: null,
  }));
}
let rows: EventPhoto[];
function response(page: number): EventPhotosPage {
  return { photos: rows.slice((page - 1) * 24, page * 24), total: rows.length, page, limit: 24 };
}
beforeEach(() => {
  rows = media(25);
  getMock.mockReset();
  delMock.mockReset();
  getMock.mockImplementation(async (url: string) => {
    if (url === "/auth/me") return { user: { id: "owner" }, isAdmin: false };
    if (url.includes("/comments")) return { comments: [] };
    const match = /\/events\/(.+)\/photos\?page=(\d+)/.exec(url);
    if (match) return response(Number(match[2]));
    throw new Error(`unexpected ${url}`);
  });
  delMock.mockImplementation(async (url: string) => {
    rows = rows.filter((p) => !url.endsWith(`/${p.id}`));
    return { ok: true };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function gallery(role: EventRole | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const tree = (eventId: string) => (
    <QueryClientProvider client={qc}><MemoryRouter>
      <EventPhotos eventId={eventId} myRole={role} photosPublic published />
    </MemoryRouter></QueryClientProvider>
  );
  const view = render(tree("ev"));
  return { ...view, qc, switchEvent: (id: string) => view.rerender(tree(id)) };
}
const images = (container: HTMLElement) => [...container.querySelectorAll('img[src*="/photos/"]')];
const next = () => screen.getByRole("button", { name: "次へ" });
const previous = () => screen.getByRole("button", { name: "前へ" });

describe("EventPhotos pagination", () => {
  it("renders 24, then the last item with correct total/boundaries; supports English controls", async () => {
    const { container } = gallery();
    await screen.findByText("写真（25）");
    expect(images(container)).toHaveLength(24);
    expect(previous()).toBeDisabled();
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    await waitFor(() => expect(images(container)).toHaveLength(1));
    expect(images(container)[0]).toHaveAttribute("src", "/api/events/ev/photos/ev-1/image");
    expect(screen.getByText("写真（25）")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    await act(async () => { await i18next.changeLanguage("en"); });
    expect(screen.getByRole("navigation", { name: "Photo and video pages" })).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2 (newest first)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(images(container)).toHaveLength(24));
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(getMock).not.toHaveBeenCalledWith("/events/ev/photos");
  });

  it("deletion of the only last-page item clamps to page one, including deleting everything", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container, qc } = gallery("staff");
    await screen.findByText("写真（25）");
    fireEvent.click(next());
    await waitFor(() => expect(images(container)).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "写真を削除" }));
    await screen.findByText("写真（24）");
    await waitFor(() => expect(images(container)).toHaveLength(24));
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    rows = [];
    await act(async () => { await qc.invalidateQueries({ queryKey: ["event", "ev", "photos"] }); });
    await waitFor(() => expect(images(container)).toHaveLength(0));
    expect(screen.getByText(/まだ写真がありません/)).toBeInTheDocument();
  });

  it("photo and video upload invalidations refresh the current page and heading; page one shows the new photo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      rows.unshift({ ...media(1)[0], id: "uploaded", createdAt: 100 });
      return new Response(JSON.stringify({ photo: rows[0] }), { status: 201 });
    }));
    const { container, qc } = gallery("participant");
    await screen.findByText("写真（25）");
    fireEvent.click(next());
    await waitFor(() => expect(images(container)).toHaveLength(1));
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["image"], "image.png", { type: "image/png" })] },
    });
    await screen.findByText("写真（26）");
    expect(images(container)).toHaveLength(2);
    // VideoUploadFlow uses this same event/photos prefix on each successful upload.
    rows.unshift({ ...media(1)[0], id: "video-upload", kind: "video", durationMs: 1000 });
    await act(async () => { await qc.invalidateQueries({ queryKey: ["event", "ev", "photos"] }); });
    await screen.findByText("写真（27）");
    expect(images(container)).toHaveLength(3);
    fireEvent.click(previous());
    await waitFor(() => expect(images(container)[0]).toHaveAttribute("src", "/api/events/ev/photos/video-upload/poster"));
    expect(images(container)[1]).toHaveAttribute("src", "/api/events/ev/photos/uploaded/image");
  });

  it("waits for refetch before clamping a cached empty page recreated by an upload", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container, qc } = gallery("staff");
    await screen.findByText("写真（25）");
    fireEvent.click(next());
    await waitFor(() => expect(images(container)).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "写真を削除" }));
    await screen.findByText("写真（24）");
    await waitFor(() => expect(images(container)).toHaveLength(24));
    rows.unshift({ ...media(1)[0], id: "new-upload" });
    await act(async () => { await qc.invalidateQueries({ queryKey: ["event", "ev", "photos"] }); });
    await screen.findByText("写真（25）");
    let resolve!: (value: EventPhotosPage) => void;
    getMock.mockImplementationOnce(() => new Promise<EventPhotosPage>((r) => { resolve = r; }));
    fireEvent.click(next());
    await screen.findByText("読み込み中…");
    expect(screen.queryByText(/まだ写真がありません/)).not.toBeInTheDocument();
    await act(async () => { resolve(response(2)); });
    await waitFor(() => expect(images(container)).toHaveLength(1));
    expect(screen.getByText("2 / 2 ページ（新しい順）")).toBeInTheDocument();
    expect(next()).toBeDisabled();
  });

  it("allows Previous after a cached out-of-range page refetch fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container, qc } = gallery("staff");
    await screen.findByText("写真（25）");
    fireEvent.click(next());
    await waitFor(() => expect(images(container)).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "写真を削除" }));
    await screen.findByText("写真（24）");
    await waitFor(() => expect(images(container)).toHaveLength(24));
    rows.unshift({ ...media(1)[0], id: "new-upload" });
    await act(async () => { await qc.invalidateQueries({ queryKey: ["event", "ev", "photos"] }); });
    await screen.findByText("写真（25）");
    let reject!: (reason: Error) => void;
    getMock.mockImplementationOnce(() => new Promise<EventPhotosPage>((_, r) => { reject = r; }));
    fireEvent.click(next());
    await screen.findByText("読み込み中…");
    expect(previous()).toBeDisabled();
    await act(async () => { reject(new Error("offline")); });
    await screen.findByText("読み込めませんでした。再読み込みしてください。");
    expect(previous()).toBeEnabled();
    expect(next()).toBeDisabled();
    fireEvent.click(previous());
    await waitFor(() => expect(images(container)).toHaveLength(24));
    expect(screen.getByText("1 / 2 ページ（新しい順）")).toBeInTheDocument();
    expect(screen.queryByText("読み込めませんでした。再読み込みしてください。")).not.toBeInTheDocument();
    expect(previous()).toBeDisabled();
  });

  it("event switch resets page/lightbox and does not request old IDs in the new event", async () => {
    const view = gallery();
    await screen.findByText("写真（25）");
    fireEvent.click(next());
    await waitFor(() => expect(images(view.container)).toHaveLength(1));
    fireEvent.click(images(view.container)[0].parentElement!);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    rows = media(2, "other");
    view.switchEvent("other");
    await screen.findByText("写真（2）");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(images(view.container)).toHaveLength(2);
    expect(getMock).toHaveBeenCalledWith("/events/other/photos?page=1");
    expect(getMock).not.toHaveBeenCalledWith("/events/other/photos?page=2");
    expect(getMock).not.toHaveBeenCalledWith("/events/other/photos/ev-1/comments");
  });

  it("loading/failure do not masquerade as empty; failed page can retry or go back", async () => {
    let resolve!: (value: EventPhotosPage) => void;
    const initial = new Promise<EventPhotosPage>((r) => { resolve = r; });
    getMock.mockImplementationOnce(() => Promise.resolve({ user: null }))
      .mockImplementationOnce(() => initial);
    const { container } = gallery();
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
    expect(screen.queryByText(/まだ写真がありません/)).not.toBeInTheDocument();
    await act(async () => { resolve(response(1)); });
    await screen.findByText("写真（25）");
    getMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(next());
    await screen.findByText("読み込めませんでした。再読み込みしてください。");
    expect(images(container)).toHaveLength(0);
    expect(previous()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await waitFor(() => expect(images(container)).toHaveLength(1));
    expect(next()).toBeDisabled();
  });
});
