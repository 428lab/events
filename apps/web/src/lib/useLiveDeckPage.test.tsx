import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";
import type { LiveContestDeck } from "@eventer/shared";
import { useLiveDeckPage, type PresentPageTransport } from "./presentPageSync.js";

/** 配信画面のスライドのページ（docs/contest-organizer-ux.md「配信との連動」）。
 * コンテストに連動中は、その世代の鍵で署名された発表者のページに合わせる。届くまでは運営が保存したページ */

const sk = generateSecretKey();
const contest: LiveContestDeck = {
  entryId: "red", entryName: "赤チーム", deckId: "d1", slug: "abc",
  present: { kind: 21080, relays: ["wss://r.example"], topic: "t1", version: 2, pubkey: getPublicKey(sk), control: "presenter", deckSlug: null },
};
let deliver: (ev: NostrEvent) => void = () => {};
const transport = (): PresentPageTransport => ({
  subscribe: (_t, _s, onEvent) => { deliver = onEvent; return () => {}; },
  publish: async () => true,
  close: () => {},
});
const signed = (page: number, key = sk) => finalizeEvent({
  kind: 21080, created_at: Math.floor(Date.now() / 1000), tags: [["t", "t1"], ["v", "2"], ["-"]],
  content: JSON.stringify({ slug: "abc", page, at: Date.now() }),
}, key);

it("連動中の配信画面は、発表者の鍵で署名されたページに合わせ、ほかの鍵は無視する。届くまでは保存したページ。連動していなければ保存したページ", () => {
  const { result, rerender } = renderHook(
    ({ follow }) => useLiveDeckPage({ deckPage: 1, followContest: follow, contest: follow ? contest : null }, 5, transport),
    { initialProps: { follow: true } },
  );
  expect(result.current).toBe(1);
  act(() => deliver(signed(3, generateSecretKey())));
  expect(result.current).toBe(1);
  act(() => deliver(signed(3)));
  expect(result.current).toBe(3);
  rerender({ follow: false });
  expect(result.current).toBe(1);
});
