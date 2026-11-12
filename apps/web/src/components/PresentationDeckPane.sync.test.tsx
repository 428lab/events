import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event as NostrEvent, type EventTemplate } from "nostr-tools/pure";
import type { Deck, PresentControlConfig } from "@eventer/shared";
import { PresentationDeckPane } from "./PresentationDeckPane.js";
import type { PresentPageTransport } from "../lib/presentPageSync.js";

/** 発表のページめくりの同期（オーナー決定 2026-11-13）。めくる人が送ったページに見ている画面が合わせる。
 * その世代の鍵で署名されたものだけ受け取り、手元でめくったら「発表者に合わせる」で戻る */

const deck = { title: "発表", content: { slides: [1, 2, 3].map((n) => ({ id: `s${n}`, background: "#000000", elements: [] })) } } as unknown as Deck;
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const sk = generateSecretKey();
const base = { kind: 21080 as const, relays: ["wss://r.example"], topic: "t1", version: 3, pubkey: getPublicKey(sk), control: "presenter" as const, deckSlug: null };

let deliver: (ev: NostrEvent) => void = () => {};
let published: EventTemplate[] = [];
const transport = (): PresentPageTransport => ({
  subscribe: (_t, _s, onEvent) => { deliver = onEvent; return () => {}; },
  publish: async (tpl) => { published.push(tpl); return true; },
  close: () => {},
});
const signed = (page: number, key = sk, at = Date.now()) => finalizeEvent({
  kind: 21080, created_at: Math.floor(at / 1000), tags: [["t", "t1"], ["v", "3"], ["-"]],
  content: JSON.stringify({ slug: "abc", page, at }),
}, key);

function draw(control: PresentControlConfig) {
  render(<MemoryRouter><PresentationDeckPane deck={deck} slug="abc" control={control} makeTransport={transport} /></MemoryRouter>);
}
const pageText = () => screen.getByText(/\d \/ 3/).textContent;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  published = [];
});
afterEach(() => vi.unstubAllGlobals());

it("見ている画面は、その世代の鍵で署名されたページにだけ合わせる。手元でめくると止まり、「発表者に合わせる」で戻る", () => {
  draw(base);
  act(() => deliver(signed(2, generateSecretKey())));
  expect(pageText()).toBe("1 / 3");
  act(() => deliver(signed(2)));
  expect(pageText()).toBe("3 / 3");

  fireEvent.click(screen.getByRole("button", { name: "前のページ" }));
  expect(pageText()).toBe("2 / 3");
  act(() => deliver(signed(0, sk, Date.now() + 1000)));
  expect(pageText()).toBe("2 / 3");
  expect(published).toHaveLength(0);

  fireEvent.click(screen.getByRole("button", { name: "発表者に合わせる" }));
  expect(pageText()).toBe("1 / 3");
  expect(screen.queryByRole("button", { name: "発表者に合わせる" })).not.toBeInTheDocument();
});

it("めくる人の画面は、めくるたびにページを1回送る。鍵を持たない画面は送らない", () => {
  draw({ ...base, secret: toHex(sk) });
  expect(screen.getByText("あなたがページをめくっています")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
  expect(published).toHaveLength(1);
  expect(published[0]).toMatchObject({ kind: 21080, tags: [["t", "t1"], ["v", "3"], ["-"]] });
  expect(JSON.parse(published[0]!.content)).toMatchObject({ slug: "abc", page: 1 });
});

it("開いたばかりのめくる人の画面は、今のページを知るまで送り直さない（途中で開いても全員を1ページ目に戻さない）", () => {
  vi.useFakeTimers();
  try {
    draw({ ...base, secret: toHex(sk) });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(published).toHaveLength(0);
    act(() => deliver(signed(2)));
    expect(pageText()).toBe("3 / 3");
    act(() => { vi.advanceTimersByTime(3_500); });
    expect(published.length).toBeGreaterThan(0);
    expect(JSON.parse(published.at(-1)!.content)).toMatchObject({ page: 2 });
  } finally {
    vi.useRealTimers();
  }
});
