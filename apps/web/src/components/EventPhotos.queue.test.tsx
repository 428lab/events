import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * 動画の複数選択はフロー（2段階 #427）へまとめて渡す。
 * 以前は uploadFiles が先頭の1本だけ拾い、残りを黙って捨てていた。
 * フロー内部の順序・キャンセルは VideoUploadFlow.test が見るのでモックし、
 * ここでは「全本渡ること・画像と併走すること・実行中の追加選択が
 * 次のフローに回ること」の配線だけを固定する。
 */

const { getMock, flowSpy } = vi.hoisted(() => ({
  getMock: vi.fn(),
  flowSpy: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

// 画像経路は canvas を使うので素通しに（jsdom には canvas が無い）
vi.mock("../lib/encodeImage.js", () => ({
  encodeImageForUpload: vi.fn(async (f: Blob) => f),
}));

// フローはモックし、受け取ったファイル一覧と onClose だけを見る
vi.mock("./VideoUploadFlow.js", () => ({
  VideoUploadFlow: (props: { files: File[]; onClose: () => void }) => {
    flowSpy(props.files.map((f) => f.name));
    return (
      <div data-testid="video-flow">
        <span data-testid="flow-files">
          {props.files.map((f) => f.name).join(",")}
        </span>
        <button onClick={() => props.onClose()}>mock-flow-close</button>
      </div>
    );
  },
}));

const { EventPhotos } = await import("./EventPhotos.js");

const EVENT_ID = "ev-q";

const video = (name: string) =>
  new File([new Uint8Array(8)], name, { type: "video/mp4" });
const image = (name: string) =>
  new File([new Uint8Array(8)], name, { type: "image/png" });

function renderAsMember() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventPhotos
          eventId={EVENT_ID}
          myRole="participant"
          photosPublic={false}
          published
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const input = view.container.querySelector('input[type="file"]')!;
  expect(input).not.toBeNull();
  return { ...view, input };
}

function pickFiles(input: Element, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ photo: { id: "p" } }),
}));

beforeEach(() => {
  getMock.mockReset();
  getMock.mockImplementation((url: string) => {
    if (url === `/events/${EVENT_ID}/photos`) return Promise.resolve({ photos: [] });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  flowSpy.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("動画キューの配線 (#427)", () => {
  it("動画2本を選ぶと、2本ともフローに渡る（捨てない）", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [video("a.mp4"), video("b.mp4")]);
    await waitFor(() =>
      expect(screen.getByTestId("flow-files")).toHaveTextContent("a.mp4,b.mp4"),
    );
    // フローが閉じたら消える
    fireEvent.click(screen.getByText("mock-flow-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("video-flow")).toBeNull(),
    );
  });

  it("画像と混在: 画像は従来どおり写真経路、動画はフローへ", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [image("x.png"), video("a.mp4"), video("b.mp4")]);
    await waitFor(() =>
      expect(screen.getByTestId("flow-files")).toHaveTextContent("a.mp4,b.mp4"),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("フロー実行中の追加選択は、今のフローが閉じた後に次のフローで流れる", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [video("a.mp4")]);
    await waitFor(() =>
      expect(screen.getByTestId("flow-files")).toHaveTextContent("a.mp4"),
    );
    // 実行中に追加（ドラッグ&ドロップ相当）
    pickFiles(input, [video("c.mp4")]);
    // 今のフローの表示は変わらない（分母が動かない）
    expect(screen.getByTestId("flow-files")).toHaveTextContent(/^a\.mp4$/);
    // 閉じると次のフローが c.mp4 で始まる
    fireEvent.click(screen.getByText("mock-flow-close"));
    await waitFor(() =>
      expect(screen.getByTestId("flow-files")).toHaveTextContent(/^c\.mp4$/),
    );
  });
});
