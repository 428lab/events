import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MeetScanResult } from "@eventer/shared";

/**
 * QRを読み取った先の画面 (#330)。
 *
 * 開いた時点で記録が走ること、失敗した理由が読み手に分かること、
 * 誤読み取りを取り消せること、未ログインならログインへ送られることを固定する。
 */

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
    },
  };
});

const { ApiError } = await import("../api/client.js");
const { MeetScanPage } = await import("./MeetScanPage.js");

const RESULT: MeetScanResult = {
  target: {
    id: "u-target",
    username: "aite",
    name: "相手さん",
    avatarUrl: null,
  },
  events: [
    {
      eventId: "e-1",
      title: "秋の集まり",
      meetCreated: true,
      attendedMe: true,
      attendedTarget: false,
    },
  ],
};

function renderPage(loggedIn = true) {
  getMock.mockImplementation((path: string) =>
    path === "/auth/me"
      ? Promise.resolve(
          loggedIn ? { user: { id: "u-me", username: "me" } } : { user: null },
        )
      : Promise.resolve({}),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/m/mt1.u-target.1700000000.abcdef"]}>
        <Routes>
          <Route path="/m/:token" element={<MeetScanPage />} />
          <Route path="/login" element={<div>ログイン画面</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe("読み取り直後の画面 (#330)", () => {
  it("開いた時点でトークンを送り、記録できたことを相手の名前つきで出す", async () => {
    postMock.mockResolvedValue(RESULT);
    renderPage();

    await screen.findByText(/秋の集まり/);
    expect(postMock).toHaveBeenCalledWith("/meet/scan", {
      token: "mt1.u-target.1700000000.abcdef",
    });
    // 送信は1回だけ（読み取りが二重に走らないこと）
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("相手さん")).toBeTruthy();
    // 出席も付いたことが分かる
    expect(screen.getByText(/受付（出席）も一緒に済ませました/)).toBeTruthy();
  });

  it("取り消すと、この読み取りで付いた出席も戻す指示を送る", async () => {
    postMock.mockResolvedValue(RESULT);
    renderPage();
    await screen.findByText(/秋の集まり/);

    postMock.mockResolvedValue({ undone: 1 });
    screen.getByRole("button", { name: "取り消す" }).click();

    await waitFor(() =>
      expect(postMock).toHaveBeenLastCalledWith("/meet/undo", {
        userId: "u-target",
        events: [
          {
            eventId: "e-1",
            revokeMyAttendance: true,
            revokeTargetAttendance: false,
          },
        ],
      }),
    );
    await screen.findByText("記録を取り消しました");
  });

  it("失敗の理由ごとに違う案内を出す", async () => {
    for (const [error, expected] of [
      ["expired", /有効期限が切れました/],
      ["no_shared_event", /同じイベントに参加していない/],
      ["outside_window", /開催時間帯ではない/],
      ["not_confirmed", /参加がまだ確定していない/],
    ] as const) {
      postMock.mockReset();
      postMock.mockRejectedValue(new ApiError(409, { error }));
      const { unmount } = renderPage();
      await screen.findByText(expected);
      unmount();
    }
  });

  it("未ログインならログイン画面へ送り、記録は走らせない", async () => {
    postMock.mockResolvedValue(RESULT);
    renderPage(false);
    await screen.findByText("ログイン画面");
    expect(postMock).not.toHaveBeenCalled();
  });
});
