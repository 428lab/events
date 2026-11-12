import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deckSlugFromUrl } from "../lib/presentationDeck.js";

/** 発表画面: 発表中のエントリーの資料URLが events lab のスライドなら、左にスライド・右に採点（オーナー依頼 2026-11-13） */
const h = vi.hoisted(() => ({
  presentingEntryId: "team-a" as string,
  entries: [] as unknown[],
  deckCalls: [] as string[],
}));

vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useParams: () => ({ id: "ev" }) }));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "me" } }),
  useIsAdmin: () => false,
  useEvent: () => ({ data: { myRole: "participant", event: { aggregateSelfEntry: false } } }),
  useEventEntries: () => ({ data: h.entries }),
  useEventMembers: () => ({ data: [] }),
}));
vi.mock("../api/scoringHooks.js", () => ({
  useEventState: () => ({ data: { presentingEntryId: h.presentingEntryId, scoringStarted: true, scoringLocked: false } }),
  useCriteria: () => ({ data: [{ id: "c1", eventId: "ev", name: "技術力", description: null, sortOrder: 0, maxLevel: 4 }] }),
  useMyScores: () => ({ data: [] }),
  useSaveScores: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
}));
vi.mock("../api/deckHooks.js", () => ({
  usePublicDeck: (slug: string) => {
    h.deckCalls.push(slug);
    if (!slug) return { data: undefined, isError: false };
    return { data: { title: "発表", content: { slides: [
      { id: "s1", background: "#000000", elements: [] },
      { id: "s2", background: "#000000", elements: [] },
    ] } }, isError: false };
  },
}));
vi.mock("../components/PresenterSidePanel.js", () => ({ PresenterPanelToggle: () => null, PresenterSidePanel: () => null }));

const entry = (id: string, name: string, presentationUrl: string | null) => ({
  id, eventId: "ev", kind: "team", name, memberUserIds: ["other"], presentationOrder: null,
  submission: presentationUrl ? { presentationUrl, sourceCodeUrl: null } : null,
});

async function draw() {
  const { PresentPage } = await import("./PresentPage.js");
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><MemoryRouter><PresentPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 640 });
  h.deckCalls = [];
});
afterEach(() => { vi.unstubAllGlobals(); });

it("資料URLが events lab のスライドなら左にスライド、右に採点。ページを進めて発表が変わると1ページ目に戻る", async () => {
  h.entries = [entry("team-a", "チーム・ねこ", "/d/abc123"), entry("team-b", "チーム・いぬ", "https://events.kojira.io/d/def456")];
  h.presentingEntryId = "team-a";
  const view = await draw();
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /別タブで開く/ })).toHaveAttribute("href", "/d/abc123");
  expect(screen.getByRole("button", { name: "4" })).toBeInTheDocument(); // 採点はそのまま右に
  expect(screen.queryByText("資料:")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
  expect(screen.getByText("2 / 2")).toBeInTheDocument();

  h.presentingEntryId = "team-b";
  const { PresentPage } = await import("./PresentPage.js");
  view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PresentPage /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(h.deckCalls).toContain("def456");
});

it("外部の資料URLは今までどおりリンクだけを出し、スライドは取りに行かない", async () => {
  h.entries = [entry("solo", "kojira", "https://docs.google.com/presentation/d/xyz")];
  h.presentingEntryId = "solo";
  await draw();
  expect(screen.getByText("資料:")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "https://docs.google.com/presentation/d/xyz" })).toBeInTheDocument();
  expect(screen.queryByText(/\d \/ \d/)).not.toBeInTheDocument();
  expect(h.deckCalls.every((s) => s === "")).toBe(true);
});

it("資料URLから自分たちのスライドの slug だけを取り出す", () => {
  const origin = "https://eventer-staging.kojiran.workers.dev";
  const table: [string | null, string | null][] = [
    ["/d/abc123", "abc123"],
    [`${origin}/d/abc123?x=1#p2`, "abc123"],
    ["https://events.kojira.io/d/abc123/", "abc123"],
    ["https://evil.example/d/abc123", null],
    ["https://events.kojira.io/decks/abc123/edit", null],
    ["http://events.kojira.io/d/abc123", null],
    ["", null],
    [null, null],
  ];
  for (const [url, slug] of table) expect(deckSlugFromUrl(url, origin)).toBe(slug);
});
