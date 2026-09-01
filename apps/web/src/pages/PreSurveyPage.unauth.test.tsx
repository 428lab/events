import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * 未ログインでも回答ページ (/s/:token) に到達できる (#444 レビュー blocker)。
 *
 * この機能の主目的は「アカウントの無い人が回答できる」こと。ルートを
 * ログイン側の Routes にだけ書くと、未ログインは `*` の catch-all で
 * トップへ飛ばされて**回答者全員が回答できない**。server テストでは
 * 捕まらない退行（実際に起きた）なので、App 全体を未ログイン状態で
 * render してフォームが出ることを固定する。
 */

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("../api/client.js", () => ({
  api: { get: apiGet, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public body: unknown,
    ) {
      super(`API error ${status}`);
    }
  },
  NetworkError: class NetworkError extends Error {},
}));
// 未ログイン（useMe が空）・退会猶予なし。他の hooks は本物のまま
vi.mock("../api/hooks.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMe: () => ({ data: undefined, isLoading: false }),
  usePendingDeletion: () => null,
}));

const { App } = await import("../App.js");
const { AppThemeProvider } = await import("../theme/ThemeContext.js");

describe("開催前アンケートの未ログイン経路 (#444)", () => {
  it("未ログインで /s/:token を開くと回答フォームが出る（トップへ飛ばされない）", async () => {
    apiGet.mockImplementation((path: string) =>
      path === "/public/pre-surveys/tok123"
        ? Promise.resolve({
            status: "open",
            title: "秋のもくもく会、興味ありますか？",
            description: "",
            questions: [
              {
                id: "q1",
                question: "参加したい曜日",
                qtype: "select",
                options: ["土曜", "日曜"],
                required: true,
                sortOrder: 0,
              },
            ],
          })
        : Promise.reject(new Error("unexpected fetch: " + path)),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AppThemeProvider>
          <MemoryRouter initialEntries={["/s/tok123"]}>
            <App />
          </MemoryRouter>
        </AppThemeProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("秋のもくもく会、興味ありますか？"),
    ).toBeInTheDocument();
    expect(screen.getByText("参加したい曜日")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回答を送信" })).toBeInTheDocument();
  });
});
