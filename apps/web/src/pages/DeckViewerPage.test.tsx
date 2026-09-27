import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeckViewerPage } from "./DeckViewerPage.js";

vi.mock("../api/deckHooks.js", () => ({ usePublicDeck: () => ({ data: { title: "Introduction", content: { slides: [
  { id: "one", background: "#0E1426", elements: [] }, { id: "two", background: "#0E1426", elements: [] },
] } }, isLoading: false, isError: false }) }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ slug: "sample" }) }));
afterEach(() => { vi.unstubAllGlobals(); });
it("lets mobile viewers read at original size without slide-tap advancement", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const { container } = render(<DeckViewerPage />);
  fireEvent.click(screen.getByRole("button", { name: "拡大して読む" }));
  const region = screen.getByRole("region", { name: "1ページ目" });
  expect(region.querySelector("div[style*=\"width: 960px\"]")).toBeTruthy();
  fireEvent.click(region.firstElementChild!);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  fireEvent.click(container.querySelectorAll("button")[2]);
  expect(screen.getByRole("region", { name: "2ページ目" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "拡大表示を閉じる" }));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
