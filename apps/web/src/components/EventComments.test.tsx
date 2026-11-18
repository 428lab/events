import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EVENT_COMMENT_LIMIT } from "@eventer/shared";
import { api, ApiError } from "../api/client.js";
import { i18next } from "../i18n/index.js";
import { EventComments } from "./EventComments.js";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "get").mockImplementation(async (path) => (path === "/auth/me" ? { user: { id: "me" } } : { comments: [
    { id: "own", userId: "me", userName: "私", body: "自分の投稿", createdAt: 1 },
    { id: "other", userId: "other", userName: "別の人", body: "他人の投稿", createdAt: 1 },
  ] }) as never);
  vi.spyOn(api, "del").mockResolvedValue({} as never);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
it.each([false, true])("staff comment moderation (%s) preserves own-delete and posting", async (management) => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <EventComments eventId="e" myRole="staff" canComment showManagementActions={management} />
  </MemoryRouter></QueryClientProvider>);
  await screen.findByText("他人の投稿");
  await waitFor(() => expect(screen.getAllByTitle("コメントを削除")).toHaveLength(management ? 2 : 1));
  fireEvent.click(screen.getAllByTitle("コメントを削除")[0]!);
  await waitFor(() => expect(api.del).toHaveBeenCalledWith("/events/e/comments/own"));
  expect(screen.getByRole("textbox")).toBeInTheDocument();
});

afterEach(async () => {
  await i18next.changeLanguage("ja");
});

// #369: エラーは訳した文字列ではなくキーで持つので、表示中に言語を切り替えると同じ欄が訳し直される
it("a shown post error follows a language switch instead of staying in the old language", async () => {
  vi.spyOn(api, "post").mockRejectedValue(new ApiError(409, { error: "comment_limit" }));
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <EventComments eventId="e" myRole="participant" canComment />
  </MemoryRouter></QueryClientProvider>);
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "hi" } });
  fireEvent.click(screen.getByRole("button", { name: "投稿" }));
  expect(await screen.findByText(`コメントは1イベントにつき${EVENT_COMMENT_LIMIT}件までです。`)).toBeInTheDocument();
  await act(async () => { await i18next.changeLanguage("en"); });
  expect(await screen.findByText(`An event can have at most ${EVENT_COMMENT_LIMIT} comments.`)).toBeInTheDocument();
  expect(screen.queryByText(/コメントは1イベントにつき/)).toBeNull();
});
