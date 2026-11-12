import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PresentedDecksResponse } from "@eventer/shared";
import { api } from "../api/client.js";
import { PresentedDecks } from "./PresentedDecks.js";

/** イベントページの「発表スライド」。サムネと「見る」を並べ、無ければ何も出さない。発表前は運営だけに出ていると分かる */

const slide = { id: "s1", background: "#112233", elements: [] };
function respond(presented: PresentedDecksResponse) {
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.endsWith("/state")) return { mode: "aggregation" } as never;
    if (path.endsWith("/presented-decks")) return presented as never;
    throw new Error(`unexpected ${path}`);
  });
}
function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><PresentedDecks eventId="e1" contest /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("チーム・個人のスライドを1枚目のサムネと「見る」で並べる。発表前に運営が見ているときは、運営だけと出る", async () => {
  respond({
    staffPreview: true,
    decks: [
      { entryId: "red", entryName: "赤チーム", kind: "team", deck: { slug: "redslug", title: "赤の発表", firstSlide: slide, slideCount: 3 } },
      { entryId: "solo", entryName: "ひとり", kind: "individual", deck: { slug: "soloslug", title: "ひとりの発表", firstSlide: null, slideCount: 0 } },
    ],
  });
  draw();
  expect(await screen.findByRole("heading", { name: "発表スライド" })).toBeInTheDocument();
  expect(screen.getByText("運営だけに表示中（発表が終わると公開）")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "赤チーム のスライドを見る" })).toHaveAttribute("href", "/d/redslug");
  expect(screen.getByText("赤の発表・3枚")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "見る" }).map((a) => a.getAttribute("href"))).toEqual(["/d/redslug", "/d/soloslug"]);
});

it("発表スライドが無い（まだ見せられない・外部URLだけ）ときは、何も出さない", async () => {
  respond({ staffPreview: false, decks: [] });
  const { container } = draw();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/events/e1/presented-decks"));
  expect(container).toBeEmptyDOMElement();
});
