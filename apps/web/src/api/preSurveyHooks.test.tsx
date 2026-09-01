import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 初回訪問フラグ (#450 フォローアップ)。
 * 初回ロード: ?first=1 を付けてフェッチし、成功したら localStorage に
 * 訪問済みマークを保存する。2回目以降（同じトークン）はフラグ無し。
 * マークはトークン単位＝再発行後は再び初回扱い（配り直しとみなす仕様）。
 */

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("./client.js", () => ({
  api: { get: apiGet, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));

const { usePublicPreSurvey } = await import("./preSurveyHooks.js");

function renderSurveyHook(token: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePublicPreSurvey(token), { wrapper });
}

beforeEach(() => {
  apiGet.mockReset();
  localStorage.clear();
  apiGet.mockResolvedValue({
    status: "open",
    title: "t",
    description: "",
    questions: [],
  });
});

describe("開催前アンケートの初回訪問フラグ (#450)", () => {
  it("初回ロードは ?first=1 付き。成功でマークが保存され、2回目はフラグ無し", async () => {
    const { result } = renderSurveyHook("tok123");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith("/public/pre-surveys/tok123?first=1");
    expect(localStorage.getItem("eventer:preSurveyVisited:tok123")).toBe("1");

    // 2回目（別マウント・同トークン）: マークがあるのでフラグ無し
    const second = renderSurveyHook("tok123");
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenLastCalledWith("/public/pre-surveys/tok123");
  });

  it("マークはトークン単位: 再発行後の新トークンは再び初回扱い", async () => {
    localStorage.setItem("eventer:preSurveyVisited:oldtok", "1");
    const { result } = renderSurveyHook("newtok");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith("/public/pre-surveys/newtok?first=1");
  });
});
