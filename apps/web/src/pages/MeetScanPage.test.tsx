import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MeetScanResult } from "@eventer/shared";

/**
 * QRを読み取った先の画面 (#330)。
 *
 * 開いた時点で記録が走ること、**失敗の理由が潰れないこと**、誤読み取りを
 * 取り消せること、未ログインならログインへ送られることを固定する。
 * 会場では電波が不安定なので、通信断を「読み取れないQR」と案内すると
 * 正常なQRを何度も出し直させることになる。
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

const { ApiError, NetworkError } = await import("../api/client.js");
const { MeetScanPage, failureOf } = await import("./MeetScanPage.js");

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
    expect(postMock).toHaveBeenCalledWith(
      "/meet/scan",
      { token: "mt1.u-target.1700000000.abcdef" },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    // 自動送信は1回だけ（読み取りが二重に走らないこと）
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("相手さん")).toBeTruthy();
    // 誰の受付が済んだのかまで分かる（自分の受付が済んだと伝わらないと
    // 受付に並び直す二度手間になる）
    expect(screen.getByText(/あなたの受付（出席）も一緒に済ませました/)).toBeTruthy();
    expect(screen.queryByText(/相手さん さんの受付/)).toBeNull();
  });

  it("取り消しは、この読み取りで付いた出席だけを戻す指示を送る", async () => {
    postMock.mockResolvedValue(RESULT);
    renderPage();
    await screen.findByText(/秋の集まり/);

    postMock.mockResolvedValue({ undone: 1, attendanceRevoked: true });
    screen.getByRole("button", { name: "取り消す" }).click();

    await waitFor(() =>
      expect(postMock).toHaveBeenLastCalledWith(
        "/meet/undo",
        {
          userId: "u-target",
          events: [
            {
              eventId: "e-1",
              revokeMyAttendance: true,
              revokeTargetAttendance: false,
            },
          ],
        },
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      ),
    );
    await screen.findByText("記録を取り消しました");
  });

  it("失敗の理由ごとに違う案内を出す", async () => {
    for (const [error, expected] of [
      ["expired", /有効期限が切れました/],
      ["used", /すでに読み取り済み/],
      ["no_shared_event", /同じイベントに参加していない/],
      ["outside_window", /開催時間帯ではない/],
      ["not_confirmed_me", /あなたの参加がまだ確定していない/],
      ["not_confirmed_target", /相手の参加がまだ確定していない/],
    ] as const) {
      postMock.mockReset();
      postMock.mockRejectedValue(new ApiError(409, { error }));
      const { unmount } = renderPage();
      await screen.findByText(expected);
      unmount();
    }
  });

  it("通信断・セッション切れ・サーバー不調を「読み取れないQR」に潰さない", () => {
    // ここが潰れると、正常なQRを相手に何度も出し直させることになる
    expect(failureOf(new NetworkError(false))).toBe("network");
    expect(failureOf(new NetworkError(true))).toBe("network");
    expect(failureOf(new TypeError("boom"))).toBe("network");
    expect(failureOf(new ApiError(401, { error: "unauthorized" }))).toBe(
      "unauthorized",
    );
    expect(failureOf(new ApiError(500, null))).toBe("server");
    // 想定外の 4xx もQRのせいと決めつけない
    expect(failureOf(new ApiError(429, { error: "rate_limited" }))).toBe(
      "server",
    );
    expect(failureOf(new ApiError(410, { error: "expired" }))).toBe("expired");
  });

  it("失敗しても同じQRで再試行できる", async () => {
    postMock.mockRejectedValue(new NetworkError(true));
    renderPage();

    await screen.findByText(/通信できませんでした/);
    postMock.mockResolvedValue(RESULT);
    screen.getByRole("button", { name: /もう一度試す/ }).click();

    await screen.findByText(/秋の集まり/);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("未ログインならログイン画面へ送り、記録は走らせない", async () => {
    postMock.mockResolvedValue(RESULT);
    renderPage(false);
    await screen.findByText("ログイン画面");
    expect(postMock).not.toHaveBeenCalled();
  });
});
