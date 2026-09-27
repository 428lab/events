import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client.js";
import { VenueOfferPanel } from "./VenueOffers.js";

afterEach(() => vi.restoreAllMocks());
function draw(showEmptyState = true) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
    <VenueOfferPanel kind="for-event" id="e" enabled showEmptyState={showEmptyState} />
  </MemoryRouter></QueryClientProvider>);
}
it("management distinguishes loading/empty/error, while existing default still hides empty lists", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ offers: [] } as never);
  const view = draw();
  expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  await screen.findByText("会場オファーはありません。");
  view.unmount();
  const legacy = draw(false);
  expect(legacy.container).toBeEmptyDOMElement();
  legacy.unmount();
  vi.mocked(api.get).mockRejectedValue(new Error("offline"));
  draw();
  await screen.findByRole("alert");
  expect(screen.queryByText("会場オファーはありません。")).toBeNull();
});
it("management keeps the real offer response controls", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ offers: [{ id: "offer", status: "pending", direction: "venue_to_event", venueId: "v", venue: { name: "交流会場" } }] } as never);
  draw();
  await screen.findByText("交流会場");
  expect(screen.getByRole("button", { name: "承諾" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "辞退" })).toBeEnabled();
});
