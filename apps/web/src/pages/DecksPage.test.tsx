import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client.js";
import { DecksPage } from "./DecksPage.js";

/** スライドの一覧の「プロフィールに載せる」と表示回数（docs/slide-editor.md） */
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "get").mockImplementation(async (path: string) =>
    (path === "/decks/mine"
      ? { decks: [{ id: "d1", slug: "abc", title: "発表", slideCount: 2, updatedAt: 0, profileShown: false, views: 7 }] }
      : { decks: [] }) as never);
  vi.spyOn(api, "put").mockResolvedValue({ ok: true } as never);
});

it("デッキごとに表示回数を出し、「プロフィールに載せる」を押すとそのデッキを載せる", async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><DecksPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("7回表示")).toBeTruthy();
  const toggle = screen.getByRole("checkbox", { name: "プロフィールに載せる" });
  expect((toggle as HTMLInputElement).checked).toBe(false);
  await act(async () => { fireEvent.click(toggle); });
  expect(api.put).toHaveBeenCalledExactlyOnceWith("/decks/d1/profile", { show: true });
});
