import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EventBroadcastsPayload } from "@eventer/shared";

/**
 * 一斉連絡 (#172) の送信前の確認。
 *
 * 人数はページを開いた時点のものなので、開いたまま置いておくと実際の宛先と
 * ずれる。「45人に送信する」と確認したのに65人に届く、を起こさないために、
 * 確認ダイアログを開く直前に人数を取り直し、その数字で確認させる。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({
    data: { event: { id: "e-1", title: "テストイベント" }, myRole: "staff" },
  }),
}));

const { EventBroadcastPage } = await import("./EventBroadcastPage.js");

function payload(confirmed: number): EventBroadcastsPayload {
  return {
    broadcasts: [],
    counts: {
      all: confirmed,
      confirmed,
      waitlist: 0,
      lottery_won: 0,
      lost: 0,
      staff: 0,
      judge: 0,
      observer: 0,
      attended: 0,
      not_attended: 0,
    },
    remainingToday: 5,
    remainingTotal: 50,
  };
}

function draw() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/events/e-1/broadcast"]}>
        <Routes>
          <Route
            path="/events/:id/broadcast"
            element={<EventBroadcastPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
});

describe("送信前の確認 (#172)", () => {
  it("確認ダイアログを開く直前に人数を取り直す", async () => {
    // 1回目（ページを開いたとき）は45人、その後に20人増えている
    getMock
      .mockResolvedValueOnce(payload(45))
      .mockResolvedValue(payload(65));
    draw();

    // 開いた時点の人数が送信先の選択に出ている
    await waitFor(() =>
      expect(screen.getAllByText(/確定（45 人）/).length).toBeGreaterThan(0),
    );

    fireEvent.change(screen.getByLabelText(/件名/), {
      target: { value: "集合場所の変更" },
    });
    fireEvent.change(screen.getByLabelText(/本文/), {
      target: { value: "本文です" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));

    // 取り直した人数で確認させる（45 のままなら実際より少ない人数で確認している）
    const confirm = await screen.findByRole("button", {
      name: "65 人に送信する",
    });
    expect(confirm).toBeTruthy();
    expect(screen.queryByRole("button", { name: "45 人に送信する" })).toBeNull();
  });

  it("宛先が0人になっていたら、確認で届かないことを知らせる", async () => {
    getMock.mockResolvedValueOnce(payload(3)).mockResolvedValue(payload(0));
    draw();

    await waitFor(() =>
      expect(screen.getAllByText(/確定（3 人）/).length).toBeGreaterThan(0),
    );
    fireEvent.change(screen.getByLabelText(/件名/), {
      target: { value: "件名" },
    });
    fireEvent.change(screen.getByLabelText(/本文/), {
      target: { value: "本文" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信内容を確認" }));

    expect(
      await screen.findByText(/いまこの区分に当てはまる人はいません/),
    ).toBeTruthy();
  });
});
