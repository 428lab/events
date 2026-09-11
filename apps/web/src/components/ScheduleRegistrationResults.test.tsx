import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ScheduleRegistrationResults } from "./ScheduleRegistrationResults.js";
import { api } from "../api/client.js";
vi.mock("../api/client.js", () => ({ api: { get: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("distinguishes confirmed, lottery and action-needed without presenting the snapshot as current status", async () => {
  vi.mocked(api.get).mockResolvedValue({
    results: [
      {
        userId: "a",
        name: "参加太郎",
        outcome: "registered",
        status: "confirmed",
        reason: null,
      },
      {
        userId: "b",
        name: "抽選花子",
        outcome: "registered",
        status: "applied",
        reason: null,
      },
      {
        userId: "c",
        name: "未回答さん",
        outcome: "action_required",
        status: null,
        reason: "survey_required",
      },
    ],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ScheduleRegistrationResults eventId="event" open onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("参加太郎 — 参加確定")).toBeVisible();
  expect(screen.getByText("抽選花子 — 抽選申込（参加未確定）")).toBeVisible();
  expect(
    screen.getByText("未回答さん — 必須アンケートへの回答が必要"),
  ).toBeVisible();
  expect(screen.getByText(/確定時点の記録です/)).toBeVisible();
});
