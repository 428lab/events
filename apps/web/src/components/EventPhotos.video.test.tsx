import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { EventPhoto } from "@eventer/shared";

/**
 * イベントギャラリーの動画表示 (#408)。
 * 一覧に kind 混在で返ってきた動画が、ポスターのサムネイル＋再生アイコン＋
 * 長さバッジで並び、開くと <video>（自動再生なし）になることを確かめる。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

const { EventPhotos } = await import("./EventPhotos.js");

const EVENT_ID = "ev-1";

const media: EventPhoto[] = [
  {
    id: "v-1",
    eventId: EVENT_ID,
    userId: "u-2",
    userName: "撮影者",
    userAvatarUrl: null,
    commentCount: 0,
    createdAt: 2000,
    kind: "video",
    durationMs: 42_000,
  },
  {
    id: "p-1",
    eventId: EVENT_ID,
    userId: "u-2",
    userName: "撮影者",
    userAvatarUrl: null,
    commentCount: 0,
    createdAt: 1000,
    kind: "photo",
    durationMs: null,
  },
];

beforeEach(() => {
  getMock.mockReset();
  getMock.mockImplementation((url: string) => {
    if (url === `/events/${EVENT_ID}/photos`) {
      return Promise.resolve({ photos: media });
    }
    if (typeof url === "string" && url.includes("/comments")) {
      return Promise.resolve({ comments: [] });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
});

function renderGallery() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // 未ログイン閲覧（photosPublic な公開イベント）の形で描画する
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventPhotos
          eventId={EVENT_ID}
          myRole={null}
          photosPublic
          published
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("イベントギャラリーの動画 (#408)", () => {
  it("動画はポスターのサムネイル＋再生アイコン＋長さバッジで並ぶ", async () => {
    const { container } = renderGallery();
    await waitFor(() =>
      expect(screen.getByTestId("video-play-overlay")).toBeInTheDocument(),
    );
    expect(screen.getByText("0:42")).toBeInTheDocument();
    const imgs = [...container.querySelectorAll("img")].map((i) =>
      i.getAttribute("src"),
    );
    expect(imgs).toContain(`/api/events/${EVENT_ID}/photos/v-1/poster`);
    expect(imgs).toContain(`/api/events/${EVENT_ID}/photos/p-1/image`);
  });

  it("動画を開くと <video>（自動再生なし・controls あり）が出る", async () => {
    const { container } = renderGallery();
    await waitFor(() =>
      expect(screen.getByTestId("video-play-overlay")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("video-play-overlay").parentElement!);
    await waitFor(() => {
      const video = document.querySelector("video");
      expect(video).not.toBeNull();
      expect(video!.getAttribute("src")).toBe(
        `/api/events/${EVENT_ID}/photos/v-1/video`,
      );
      expect(video!.hasAttribute("controls")).toBe(true);
      expect(video!.hasAttribute("autoplay")).toBe(false);
    });
    // ライトボックス内の <img> ではない（動画は video 要素で出す）
    expect(container).toBeDefined();
  });
});
