import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client.js";
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
