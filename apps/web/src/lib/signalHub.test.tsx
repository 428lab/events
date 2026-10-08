import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import type { EventSignalSource } from "@eventer/shared";

/**
 * The shared signal connection (D-POLL-MIN Phase 5b-1). The relay pool is faked; signals
 * are really signed, so author and signature checks run for real.
 */

const { pools } = vi.hoisted(() => ({
  pools: [] as Array<{
    relays: readonly string[];
    connected: boolean;
    closed: boolean;
    onstatus: (() => void) | null;
    subs: Array<{ topics: string[]; deliver: (ev: NostrEvent) => void; eose: boolean; closed: boolean }>;
  }>,
}));
vi.mock("./nostrChat.js", () => ({
  randomLocalSigner: () => ({}),
  ChatRelayPool: class {
    connected = true;
    closed = false;
    onstatus: (() => void) | null = null;
    subs: Array<{ topics: string[]; deliver: (ev: NostrEvent) => void; eose: boolean; closed: boolean }> = [];
    constructor(_signer: unknown, public relays: readonly string[]) { pools.push(this); }
    connect() { return Promise.resolve(); }
    subscribeSignal(configs: Array<{ topic: string }>, deliver: (ev: NostrEvent) => void) {
      const sub = { topics: configs.map((c) => c.topic), deliver, eose: false, closed: false };
      this.subs.push(sub);
      return { close: () => { sub.closed = true; }, synced: () => this.connected && sub.eose && !sub.closed };
    }
    close() { this.closed = true; }
  },
}));

const { useEventSignal, resetSignalHubsForTest, HUB_IDLE_CLOSE_MS, RESUBSCRIBE_DEBOUNCE_MS } = await import("./signalHub.js");

const serviceSk = generateSecretKey();
const SERVICE = getPublicKey(serviceSk);
const RELAYS = ["wss://x.example", "wss://r.example"];
const source = (topic: string, rev = 1_000, relays = RELAYS): EventSignalSource =>
  ({ kind: EVENT_SIGNAL_KIND, pubkey: SERVICE, topic, rev, relays });
const T1 = "71".repeat(32);
const T2 = "72".repeat(32);

function signal(topics: string[], rev: number, opts: { sk?: Uint8Array; kind?: number; protectedTag?: boolean; content?: string } = {}) {
  return finalizeEvent({
    kind: opts.kind ?? EVENT_SIGNAL_KIND,
    created_at: Math.floor(rev / 1000),
    tags: [...topics.map((t) => ["t", t]), ...(opts.protectedTag === false ? [] : [["-"]])],
    content: opts.content ?? JSON.stringify({ rev }),
  }, opts.sk ?? serviceSk);
}

function Listen({ src, onSignal, jitterMs, eventId, report }: {
  src: EventSignalSource | null; onSignal: () => unknown; jitterMs?: number; eventId?: string; report?: (synced: boolean) => void;
}) {
  const { synced } = useEventSignal(src, onSignal, { jitterMs, eventId });
  report?.(synced);
  return null;
}

/** Let the debounced REQ swap happen and mark it as past EOSE */
async function settle(eose = true) {
  await act(async () => { await vi.advanceTimersByTimeAsync(RESUBSCRIBE_DEBOUNCE_MS); });
  if (eose) {
    act(() => {
      for (const sub of pools.at(-1)!.subs) sub.eose = true;
      pools.at(-1)!.onstatus?.();
    });
  }
}
const lastSub = () => pools.at(-1)!.subs.at(-1)!;
const deliver = async (ev: NostrEvent) => {
  await act(async () => { lastSub().deliver(ev); await vi.advanceTimersByTimeAsync(0); });
};

beforeEach(() => {
  vi.useFakeTimers();
  pools.length = 0;
});
afterEach(() => {
  act(() => resetSignalHubsForTest());
  vi.useRealTimers();
});

describe("useEventSignal (D-POLL-MIN Phase 5b-1)", () => {
  it("shares one connection and one REQ per relay for every topic, and reports synced after EOSE", async () => {
    const one = vi.fn(), two = vi.fn(), synced: boolean[] = [];
    render(<>
      <Listen src={source(T1)} onSignal={one} report={(s) => synced.push(s)} />
      <Listen src={source(T2)} onSignal={two} />
      <Listen src={source(T1)} onSignal={vi.fn()} />
    </>);
    await settle(false);
    expect(pools).toHaveLength(1);
    expect(pools[0].relays).toEqual(RELAYS);
    expect(pools[0].subs).toHaveLength(1);
    expect(pools[0].subs[0].topics.sort()).toEqual([T1, T2].sort());
    expect(synced.at(-1)).toBe(false);
    act(() => { pools[0].subs[0].eose = true; pools[0].onstatus?.(); });
    expect(synced.at(-1)).toBe(true);

    await deliver(signal([T2], 2_000));
    expect(two).toHaveBeenCalledOnce();
    expect(one).not.toHaveBeenCalled();
    // One event can carry several topics
    await deliver(signal([T1, T2], 3_000));
    expect(one).toHaveBeenCalledOnce();
    expect(two).toHaveBeenCalledTimes(2);
  });

  it("ignores signals not newer than the payload or the last one handled (strfry's pre-EOSE replays)", async () => {
    const onSignal = vi.fn();
    render(<Listen src={source(T1, 5_000)} onSignal={onSignal} />);
    await settle();
    await deliver(signal([T1], 4_000));
    await deliver(signal([T1], 5_000));
    expect(onSignal).not.toHaveBeenCalled();
    await deliver(signal([T1], 6_000));
    await deliver(signal([T1], 6_000, { content: JSON.stringify({ rev: 6_000, x: 1 }) }));
    await deliver(signal([T1], 5_500));
    expect(onSignal).toHaveBeenCalledOnce();
  });

  it("rejects another author, kind or topic, a missing [\"-\"], a bad signature and malformed content", async () => {
    const onSignal = vi.fn();
    render(<Listen src={source(T1)} onSignal={onSignal} />);
    await settle();
    await deliver(signal([T1], 2_000, { sk: generateSecretKey() }));
    await deliver(signal([T1], 2_001, { kind: 20079 }));
    await deliver(signal([T2], 2_002));
    await deliver(signal([T1], 2_003, { protectedTag: false }));
    await deliver(signal([T1], 2_004, { content: "not json" }));
    await deliver(signal([T1], 2_005, { content: JSON.stringify({ rev: "2005" }) }));
    const tampered = { ...JSON.parse(JSON.stringify(signal([T1], 2_006))), content: JSON.stringify({ rev: 9_999 }) };
    await deliver(tampered);
    expect(onSignal).not.toHaveBeenCalled();
    await deliver(signal([T1], 2_007));
    expect(onSignal).toHaveBeenCalledOnce();
  });

  it("waits a random delay up to jitterMs, and absorbs signals that arrive meanwhile", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const onSignal = vi.fn();
    render(<Listen src={source(T1)} onSignal={onSignal} jitterMs={4_000} />);
    await settle();
    await deliver(signal([T1], 2_000));
    await deliver(signal([T1], 3_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(onSignal).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onSignal).toHaveBeenCalledOnce();
  });

  it("runs one refetch at a time, plus exactly one more if a signal arrived during it", async () => {
    let finish: () => void = () => undefined;
    const onSignal = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<Listen src={source(T1)} onSignal={onSignal} />);
    await settle();
    await deliver(signal([T1], 2_000));
    expect(onSignal).toHaveBeenCalledOnce();
    await deliver(signal([T1], 3_000));
    await deliver(signal([T1], 4_000));
    expect(onSignal).toHaveBeenCalledOnce();
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(onSignal).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(onSignal).toHaveBeenCalledTimes(2);
  });

  it("keeps the old REQ until the new topic set reaches EOSE, then closes it", async () => {
    const first = render(<Listen src={source(T1)} onSignal={vi.fn()} />);
    await settle();
    const before = lastSub();
    const two = vi.fn();
    first.rerender(<><Listen src={source(T1)} onSignal={vi.fn()} /><Listen src={source(T2)} onSignal={two} /></>);
    await settle(false);
    const after = lastSub();
    expect(after).not.toBe(before);
    expect(after.topics.sort()).toEqual([T1, T2].sort());
    expect(before.closed).toBe(false);
    act(() => { after.eose = true; pools[0].onstatus?.(); });
    expect(before.closed).toBe(true);
    await deliver(signal([T2], 2_000));
    expect(two).toHaveBeenCalledOnce();
  });

  it("closes the connection only after the last topic has been gone for a while", async () => {
    const view = render(<Listen src={source(T1)} onSignal={vi.fn()} />);
    await settle();
    view.rerender(<Listen src={null} onSignal={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(HUB_IDLE_CLOSE_MS - 1); });
    expect(pools[0].closed).toBe(false);
    // A screen that comes back in time reuses the connection
    view.rerender(<Listen src={source(T1)} onSignal={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(HUB_IDLE_CLOSE_MS); });
    expect(pools).toHaveLength(1);
    expect(pools[0].closed).toBe(false);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(HUB_IDLE_CLOSE_MS); });
    expect(pools[0].closed).toBe(true);
  });

  it("subscribes to nothing without a source (no service key)", async () => {
    const synced: boolean[] = [];
    render(<Listen src={null} onSignal={vi.fn()} report={(s) => synced.push(s)} />);
    await settle(false);
    expect(pools).toHaveLength(0);
    expect(synced.every((s) => !s)).toBe(true);
  });

  it("stops listening when the event's access is reset", async () => {
    const onSignal = vi.fn();
    render(<Listen src={source(T1)} onSignal={onSignal} eventId="ev-1" />);
    await settle();
    act(() => { window.dispatchEvent(new CustomEvent("event-access-reset", { detail: "ev-other" })); });
    await deliver(signal([T1], 2_000));
    expect(onSignal).toHaveBeenCalledOnce();
    act(() => { window.dispatchEvent(new CustomEvent("event-access-reset", { detail: "ev-1" })); });
    await deliver(signal([T1], 3_000));
    expect(onSignal).toHaveBeenCalledOnce();
  });
});
