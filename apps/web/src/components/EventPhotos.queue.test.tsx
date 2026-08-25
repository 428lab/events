import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * 動画の複数選択はキューで1本ずつ処理する (#427)。
 * 以前は uploadFiles が先頭の1本だけ拾い、残りを黙って捨てていた。
 * ダイアログ本体は別テスト（VideoUploadDialog.*.test）が見るのでモックし、
 * ここでは「順に出ること・キャンセルで次へ進むこと・画像と混在できること・
 * 50枠切れで残りを中止すること」の配線だけを固定する。
 */

const { getMock, dialogSpy } = vi.hoisted(() => ({
  getMock: vi.fn(),
  dialogSpy: vi.fn(),
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

// 動画ダイアログはモックし、onClose の結果をボタンで注入できるようにする
vi.mock("./VideoUploadDialog.js", () => ({
  VideoUploadDialog: (props: {
    file: File;
    queue?: { index: number; total: number };
    onClose: (outcome?: string) => void;
  }) => {
    dialogSpy(props.file.name, props.queue);
    return (
      <div data-testid="video-dialog">
        <span data-testid="dialog-file">{props.file.name}</span>
        {props.queue && (
          <span data-testid="dialog-queue">
            {props.queue.index}/{props.queue.total}
          </span>
        )}
        <button onClick={() => props.onClose("uploaded")}>mock-upload</button>
        <button onClick={() => props.onClose("canceled")}>mock-cancel</button>
        <button onClick={() => props.onClose("failed")}>mock-fail</button>
        <button onClick={() => props.onClose("limit")}>mock-limit</button>
        <button onClick={() => props.onClose("cancelAll")}>mock-cancel-all</button>
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

/** 隠しファイル入力に選択をシミュレートする */
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
  dialogSpy.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("動画キュー (#427)", () => {
  it("動画2本を選ぶと、1本目→2本目の順に両方処理される（N本中M本目つき）", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [video("a.mp4"), video("b.mp4")]);

    // 1本目
    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("a.mp4"),
    );
    expect(screen.getByTestId("dialog-queue")).toHaveTextContent("1/2");

    // 投稿完了 → 2本目が続けて出る
    fireEvent.click(screen.getByText("mock-upload"));
    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("b.mp4"),
    );
    expect(screen.getByTestId("dialog-queue")).toHaveTextContent("2/2");

    // 2本目も完了 → ダイアログが閉じる
    fireEvent.click(screen.getByText("mock-upload"));
    await waitFor(() =>
      expect(screen.queryByTestId("video-dialog")).toBeNull(),
    );
  });

  it("1本目をキャンセルしても2本目のダイアログが出る", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [video("a.mp4"), video("b.mp4")]);
    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("a.mp4"),
    );
    fireEvent.click(screen.getByText("mock-cancel"));
    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("b.mp4"),
    );
  });

  it("「すべてキャンセル」で残りも中止する", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [video("a.mp4"), video("b.mp4")]);
    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("a.mp4"),
    );
    fireEvent.click(screen.getByText("mock-cancel-all"));
    await waitFor(() =>
      expect(screen.queryByTestId("video-dialog")).toBeNull(),
    );
  });

  it("画像と混在: 画像は従来どおりアップロードし、動画はキューに乗る", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [image("x.png"), video("a.mp4"), video("b.mp4")]);

    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("a.mp4"),
    );
    expect(screen.getByTestId("dialog-queue")).toHaveTextContent("1/2");
    // 画像は写真のアップロード経路（fetch POST）に流れている
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("失敗した本はスキップして次へ進み、最後にまとめが出る", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [video("a.mp4"), video("b.mp4")]);
    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("a.mp4"),
    );
    fireEvent.click(screen.getByText("mock-fail"));
    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("b.mp4"),
    );
    fireEvent.click(screen.getByText("mock-upload"));
    await waitFor(() =>
      expect(screen.queryByTestId("video-dialog")).toBeNull(),
    );
    // 1本投稿・1本失敗のまとめ
    expect(screen.getByText(/1 本は失敗/)).toBeInTheDocument();
  });

  it("50枠切れ（photo_limit）が出たら残りの動画は中止する", async () => {
    const { input } = renderAsMember();
    pickFiles(input, [video("a.mp4"), video("b.mp4")]);
    await waitFor(() =>
      expect(screen.getByTestId("dialog-file")).toHaveTextContent("a.mp4"),
    );
    fireEvent.click(screen.getByText("mock-limit"));
    await waitFor(() =>
      expect(screen.queryByTestId("video-dialog")).toBeNull(),
    );
    expect(screen.getByText(/50/)).toBeInTheDocument();
  });
});
