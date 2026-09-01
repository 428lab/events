import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 開催前アンケートの管理ページ (#444 レビュー should-fix)。
 *
 * 新規作成の保存後、編集中の行が id を持たないままだと、**2回目の保存が
 * 「全部新規」＝既存質問の全 DELETE → 回答の CASCADE 消滅**になる。
 * 保存応答の id を行へ反映し、再保存が id 付きで送られることを固定する。
 */

const { apiGet, apiPut, ApiErrorClass } = vi.hoisted(() => {
  class ApiErrorClass extends Error {
    constructor(
      public status: number,
      public body: unknown,
    ) {
      super(`API error ${status}`);
    }
  }
  return { apiGet: vi.fn(), apiPut: vi.fn(), ApiErrorClass };
});

vi.mock("../api/client.js", () => ({
  api: { get: apiGet, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: apiPut },
  ApiError: ApiErrorClass,
  NetworkError: class NetworkError extends Error {},
}));
vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({
    data: {
      event: { id: "e-1", title: "テストイベント", status: "draft" },
      myRole: "staff",
    },
    isLoading: false,
  }),
}));

const { EventPreSurveyAdminPage } = await import("./EventPreSurveyAdminPage.js");

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/events/e-1/pre-survey"]}>
        <Routes>
          <Route path="/events/:id/pre-survey" element={<EventPreSurveyAdminPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
});

describe("開催前アンケートの管理ページ (#444)", () => {
  it("保存応答の質問 id を行へ反映し、再保存が id 付きで送られる（全置換で回答が消えない）", async () => {
    // 未作成（404）から新規作成する流れ
    apiGet.mockRejectedValue(new ApiErrorClass(404, { error: "not_found" }));
    apiPut.mockResolvedValue({
      survey: {
        id: "s-1",
        title: "興味ありますか？",
        description: "",
        status: "open",
        token: "t".repeat(32),
        responseCount: 0,
        createdAt: 0,
        questions: [
          {
            id: "q-1",
            question: "参加したい曜日",
            qtype: "text",
            options: [],
            required: false,
            sortOrder: 0,
          },
        ],
      },
    });

    renderPage();
    fireEvent.change(await screen.findByLabelText("アンケートのタイトル"), {
      target: { value: "興味ありますか？" },
    });
    fireEvent.change(screen.getByLabelText("質問"), {
      target: { value: "参加したい曜日" },
    });
    fireEvent.click(screen.getByRole("button", { name: "アンケートを作る" }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    // 1回目は新規（id なし）でよい
    expect(apiPut.mock.calls[0][1].questions[0].id).toBeUndefined();

    // 再保存: 応答で受けた id が付いて送られる（＝既存質問の UPDATE になる）
    await waitFor(() => screen.getByText("保存しました。"));
    fireEvent.click(screen.getByRole("button", { name: "アンケートを作る" }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2));
    expect(apiPut.mock.calls[1][1].questions[0].id).toBe("q-1");
  });
});
