import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BINGO_POLL_MS } from "@eventer/shared";

/**
 * ビンゴのポーリング復帰 (#436 実機フィードバック)。
 *
 * 投影画面・カード画面は、ゲームが作られる**前**に開かれることが普通にある
 * （プロジェクターを先に映してから、司会が手元で「ビンゴを準備する」）。
 * その時点の応答は 404 で、旧実装はエラーでポーリングを恒久停止していた。
 * 以後ゲームを作って抽選しても、その画面は再読み込みするまで一切更新されない
 * ＝「最初の1回だけ番号が出ない」の正体。
 *
 * 専用ページ（pollWhileMissing=true）は 404 の間もポーリングを続け、
 * ゲームが作られたら自動で拾うことを固定する。
 */

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("./client.js", () => ({
  api: { get: apiGet, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));

const { useBingoState } = await import("./bingoHooks.js");

afterEach(() => {
  vi.useRealTimers();
  apiGet.mockReset();
});

describe("useBingoState のポーリング復帰 (#436)", () => {
  it("ゲーム作成前の 404 の後もポーリングを続け、作られたら自動で拾う", async () => {
    vi.useFakeTimers();
    apiGet
      .mockRejectedValueOnce(new Error("not_found(404)"))
      .mockResolvedValue({
        status: "setup",
        drawnNumbers: [],
        counts: { cards: 0, bingo: 0, reach: 0 },
        card: null,
        me: null,
      });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useBingoState("e-1", true, true), {
      wrapper,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(result.current.isError).toBe(true);
    expect(apiGet).toHaveBeenCalledTimes(1);

    // ポーリング1周期後: 旧実装はここで2回目が飛ばない（恒久停止）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BINGO_POLL_MS + 100);
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(result.current.data?.status).toBe("setup");
  });
});
