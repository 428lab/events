import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 抽選コントロールの「次を引く」 (#436 実機フィードバック)。
 *
 * 初回の draw で番号が画面に出ない報告があった。原因は、UI が draw 応答の
 * 番号を捨てて /status の取り直しだけを見ていたこと：取り直しがレース・失敗・
 * 遅延すると、引いた番号がいつまでも「—」のままになる。
 *
 * このテストは「status の取得がずっと古い値（空）を返し続ける」最悪ケースを再現し、
 * それでも draw 応答の番号がその場で表示されることを固定する。
 */

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("../api/client.js", () => ({
  api: { get: apiGet, post: apiPost, del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));
vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({
    data: { event: { id: "e-1", title: "テスト" }, myRole: "staff" },
    isLoading: false,
  }),
}));

const { EventBingoControlPage } = await import("./EventBingoControlPage.js");

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/events/e-1/bingo/control"]}>
        <Routes>
          <Route
            path="/events/:id/bingo/control"
            element={<EventBingoControlPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe("ビンゴ抽選コントロール (#436)", () => {
  it("初回の draw 応答の番号を、/status の取り直しを待たずにその場で表示する", async () => {
    // /status は常に「まだ0個」の古い応答（取り直しが実らない最悪ケース）
    apiGet.mockResolvedValue({
      status: "running",
      drawnNumbers: [],
      counts: { cards: 3, bingo: 0, reach: 0 },
      rows: [],
    });
    apiPost.mockResolvedValue({
      number: 42,
      drawnNumbers: [42],
      counts: { cards: 3, bingo: 0, reach: 0 },
    });

    renderPage();
    const drawButton = await screen.findByRole("button", { name: "次を引く" });
    fireEvent.click(drawButton);

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    expect(apiPost).toHaveBeenCalledWith("/events/e-1/bingo/draw");
  });

  it("draw 直後に「ビンゴ n人」も応答の値で更新される（#436 実機: 人数が増えない）", async () => {
    // /status は常に古い counts（bingo 0）を返す最悪ケース
    apiGet.mockResolvedValue({
      status: "running",
      drawnNumbers: [1, 2, 3, 4],
      counts: { cards: 3, bingo: 0, reach: 1 },
      rows: [],
    });
    apiPost.mockResolvedValue({
      number: 5,
      drawnNumbers: [1, 2, 3, 4, 5],
      counts: { cards: 3, bingo: 1, reach: 0 },
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "次を引く" }));

    await waitFor(() => {
      expect(
        screen.getByText("カード3枚 ・ ビンゴ1人 ・ リーチ0人"),
      ).toBeInTheDocument();
    });
  });

  it("取り消しも応答の列で巻き戻す（表示が取り直し待ちにならない）", async () => {
    apiGet.mockResolvedValue({
      status: "running",
      drawnNumbers: [42, 7],
      counts: { cards: 3, bingo: 0, reach: 0 },
      rows: [],
    });
    apiPost.mockResolvedValue({
      drawnNumbers: [42],
      counts: { cards: 3, bingo: 0, reach: 0 },
    });

    renderPage();
    const undoButton = await screen.findByRole("button", {
      name: "直前の1個を取り消す",
    });
    // 確認ダイアログは常に OK
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(undoButton);

    await waitFor(() => {
      expect(screen.queryByText("7")).not.toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });
});
