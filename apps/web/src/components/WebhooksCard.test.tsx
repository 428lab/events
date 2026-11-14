import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { WebhookView } from "@eventer/shared";
import { api } from "../api/client.js";
import { WebhooksCard } from "./WebhooksCard.js";

/** Discord / Slack 通知の設定 (docs/webhooks.md)。URL は伏せて出し、テスト送信の結果を出す */
const hook: WebhookView = {
  id: "w1", kind: "discord", urlHint: "discord.com …a9Xz", label: "運営", notifyInquiry: true, notifyJoin: true, notifyCancel: false,
  active: false, failCount: 5, lastError: "HTTP 404", lastSentAt: null, createdAt: 1,
};

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><WebhooksCard owner={{ community: "c1" }} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "get").mockResolvedValue({ webhooks: [hook] } as never);
});

it("登録済みは伏せた URL と停止中を出し、テスト送信の結果を出す。Discord / Slack 以外の URL は追加できない", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({ ok: false, status: 404 } as never);
  draw();
  expect(await screen.findByText("discord.com …a9Xz")).toBeInTheDocument();
  expect(screen.getByText("停止中")).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "テスト送信" })); });
  expect(post).toHaveBeenCalledWith("/communities/c1/webhooks/w1/test");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("送れませんでした（404）"));

  fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "https://example.com/hook" } });
  expect(screen.getByText("Discord か Slack の Webhook URL を入れてください。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "追加する" })).toBeDisabled();
});
