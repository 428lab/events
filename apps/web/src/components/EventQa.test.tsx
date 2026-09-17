import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client.js";
import { EventQa } from "./EventQa.js";

const payload = {
  anonymity: "choice", canPost: true, canModerate: true, revealsAuthor: true, pickedQuestionId: "hidden",
  questions: [
    { id: "own", body: "自分の質問", mine: true, votes: 1, voted: false, anonymous: false, answered: false, hidden: false, createdAt: 1,
      author: { name: "私", username: "me" } },
    { id: "anon", body: "匿名の質問", mine: false, votes: 2, voted: false, anonymous: true, answered: false, hidden: false, createdAt: 1,
      author: { name: "匿名投稿者の実名", username: "anonymous" } },
    { id: "hidden", body: "隠した質問", mine: false, votes: 3, anonymous: true, answered: false, hidden: true, createdAt: 1,
      author: { name: "隠した質問者の実名", username: "hidden" } },
  ],
};
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "get").mockResolvedValue(structuredClone(payload) as never);
  vi.spyOn(api, "post").mockResolvedValue({} as never);
  vi.spyOn(api, "del").mockResolvedValue({} as never);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
function draw(showManagementActions: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (show: boolean) => <QueryClientProvider client={qc}><MemoryRouter>
    <EventQa eventId="e" canPost showManagementActions={show} />
  </MemoryRouter></QueryClientProvider>;
  const view = render(tree(showManagementActions));
  return { qc, ...view, management: () => view.rerender(tree(true)) };
}
it("information derives question count/picked/list from public subset without changing query; retains own deletion/post/vote", async () => {
  const view = draw(false);
  await screen.findByText("Q&A（2）");
  expect(screen.queryByText("隠した質問")).toBeNull();
  expect(screen.queryByText(/匿名投稿者の実名/)).toBeNull();
  expect(screen.queryByTitle("非表示にする")).toBeNull();
  expect(screen.queryByTitle("いまこの質問にする")).toBeNull();
  fireEvent.click(screen.getByTitle("自分の質問を取り消す"));
  await waitFor(() => expect(api.del).toHaveBeenCalledWith("/events/e/questions/own"));
  expect(screen.getByRole("textbox")).toBeInTheDocument();
  expect(screen.getAllByTestId("ThumbUpOffAltIcon")).toHaveLength(2);
  expect(view.qc.getQueryData(["event", "e", "questions"])).toEqual(payload);
  view.management();
  await screen.findByText("Q&A（3）");
  expect(screen.getAllByText("隠した質問").length).toBeGreaterThan(0);
  expect(screen.getByText(/匿名投稿者の実名/)).toBeInTheDocument();
  expect(screen.getAllByTitle("非表示にする")).toHaveLength(2);
});
it("the presentation flag cannot grant moderation absent server capability", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...payload, canModerate: false, revealsAuthor: false } as never);
  draw(true);
  await screen.findByText("Q&A（3）");
  expect(screen.queryByTitle("非表示にする")).toBeNull();
  expect(screen.queryByText(/匿名投稿者の実名/)).toBeNull();
});
