import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMembersPayload, EventLiveState, EventSignalConfig } from "@eventer/shared";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { useLiveEventChat } from "./LiveEventChat.js";

const { subscriptions, signals, pools, poolDefaults } = vi.hoisted(() => ({
  subscriptions: [] as Array<{ channel: string; deliver: (event: import("nostr-tools/pure").Event) => void }>,
  signals: [] as Array<{ topic: string; deliver: (event: import("nostr-tools/pure").Event) => void }>,
  pools: [] as Array<{ connected: boolean; eose: boolean; onstatus?: () => void }>,
  /** EOSE state for newly created pools */
  poolDefaults: { eose: true },
}));
vi.mock("../lib/useEventChatAccess.js", () => ({ useEventChatAccess: () => ({ chatAvailable: true, isError: false }) }));
const { memberArgs, refetches } = vi.hoisted(() => ({ memberArgs: [] as unknown[][], refetches: { count: 0 } }));
vi.mock("../api/eventChatHooks.js", () => ({ useChatMembers: (...args: unknown[]) => {
  memberArgs.push(args);
  return { data: chats[args[0] as string], dataUpdatedAt: memberUpdatedAt, isError: memberError, refetch: () => { refetches.count++; memberUpdatedAt = Date.now() + 1; return Promise.resolve(); } };
} }));
vi.mock("../api/encryptedChatHooks.js", () => ({ useEncryptedChat: () => ({ data: undefined, dataUpdatedAt: 0, isError: false }) }));
// The pool reaches EOSE on connect unless a test turns `eose` off; `synced()` reflects it.
vi.mock("../lib/nostrChat.js", () => ({
  randomLocalSigner: () => ({}),
  ChatRelayPool: class {
    connected = true;
    eose = poolDefaults.eose;
    onstatus?: () => void;
    constructor() { pools.push(this); }
    connect() { this.onstatus?.(); return Promise.resolve(); }
    subscribe(channel: string, deliver: (event: NostrEvent) => void) { subscriptions.push({ channel, deliver }); return () => {}; }
    subscribeSignal(configs: Array<{ topic: string }>, deliver: (event: NostrEvent) => void) {
      signals.push({ topic: configs[0].topic, deliver });
      return { close: () => {}, synced: () => this.connected && this.eose };
    }
    close() {}
  },
}));
// Signature checks are covered in lib/eventSignal.test.ts; here only parsing and gating matter.
vi.mock("nostr-tools/pure", async (importOriginal) => ({ ...(await importOriginal<typeof import("nostr-tools/pure")>()), verifyEvent: () => true }));

const SERVICE = "5e".repeat(32);
const signalConfig = (id: string): EventSignalConfig => ({ kind: EVENT_SIGNAL_KIND, pubkey: SERVICE, topic: `topic-${id}`, rev: 1_000 });
const chats: Record<string, ChatMembersPayload> = Object.fromEntries(["one", "two"].map(id => [id, {
  channelId: `channel-${id}`, chatEnabled: true, relays: ["wss://relay.example"], hiddenNoteIds: [], hiddenSignal: signalConfig(id), writeWindow: { opensAt: null, closesAt: 1_700_003_600_000 },
  members: [{ pubkey: "shared-author", userId: `user-${id}`, username: id, name: `Name ${id}`, avatarUrl: `/api/users/user-${id}/avatar?v=1`, role: "staff" }],
}]));
const state = { chatSource: "event" } as EventLiveState;
let memberUpdatedAt = Date.now();
let memberError = false;

function Stage({ eventId, liveState = state, page = "screen", stateCurrent = true }: { eventId: string; liveState?: EventLiveState; page?: "screen" | "control"; stateCurrent?: boolean }) {
  const chat = useLiveEventChat(eventId, liveState, stateCurrent, Date.now(), true, page);
  // This is the render-phase stage output, before the switch cleanup effect can run.
  rendered.push({ eventId, messages: chat.rows.map(row => row.plainText), status: chat.status });
  return <div>{chat.rows.map(row => <div key={row.id}>{row.name}: {row.plainText}<img src={row.avatar ?? undefined} alt="" /></div>)}</div>;
}
const rendered: Array<{ eventId: string; messages: string[]; status: string }> = [];

function hideSignal(topic: string, rev: number, hidden: string[], shown: string[] = []): NostrEvent {
  return { id: "51".repeat(32), pubkey: SERVICE, kind: EVENT_SIGNAL_KIND, created_at: Math.floor(rev / 1000), tags: [["t", topic], ["-"]], content: JSON.stringify({ rev, hidden, shown }), sig: "00".repeat(64) } as NostrEvent;
}

beforeEach(() => {
  subscriptions.length = 0; signals.length = 0; pools.length = 0; rendered.length = 0; memberArgs.length = 0; refetches.count = 0;
  memberUpdatedAt = Date.now(); memberError = false; poolDefaults.eose = true;
  for (const id of ["one", "two"]) { chats[id].hiddenNoteIds = []; chats[id].hiddenSignal = signalConfig(id); }
});
/** Mount, connect, and let the post-EOSE metadata read land (the mock refetch bumps dataUpdatedAt). */
async function mountLive(view: ReturnType<typeof render>, ui: React.ReactElement) {
  await act(async () => {});
  view.rerender(ui);
}
describe("useLiveEventChat event switch", () => {
  it("never paints the old post or image under the new event's cached authorized member, then delivers a new post", async () => {
    const view = render(<Stage eventId="one" />);
    await mountLive(view, <Stage eventId="one" />); // subscribe after the pool connects
    const old = { id: "old", pubkey: "shared-author", created_at: Math.floor(Date.now() / 1000), content: "old event post" } as NostrEvent;
    act(() => subscriptions.find(s => s.channel === "channel-one")!.deliver(old));
    expect(screen.getByText(/old event post/)).toBeTruthy();
    expect(view.container.querySelector("img")?.getAttribute("src")).toContain("user-one");

    const beforeSwitch = rendered.length;
    view.rerender(<Stage eventId="two" />);
    expect(rendered[beforeSwitch]).toEqual({ eventId: "two", messages: [], status: "connecting" });
    expect(screen.queryByText(/old event post/)).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
    await mountLive(view, <Stage eventId="two" />);
    act(() => subscriptions.find(s => s.channel === "channel-two")!.deliver({ ...old, id: "new", content: "new event post" }));
    expect(screen.getByText(/new event post/)).toBeTruthy();
    expect(view.container.querySelector("img")?.getAttribute("src")).toContain("user-two");
  });

  it("purges rows on OFF and changed hidden-note permissions", async () => {
    const view = render(<Stage eventId="one" />);
    await mountLive(view, <Stage eventId="one" />);
    const post = { id: "hide-me", pubkey: "shared-author", created_at: Math.floor(Date.now() / 1000), content: "private post" } as NostrEvent;
    act(() => subscriptions[0].deliver(post));
    expect(screen.getByText(/private post/)).toBeTruthy();

    view.rerender(<Stage eventId="one" liveState={{ ...state, chatSource: "off" }} />);
    expect(screen.queryByText(/private post/)).toBeNull();
    view.rerender(<Stage eventId="one" />);
    expect(screen.queryByText(/private post/)).toBeNull();
    await mountLive(view, <Stage eventId="one" />);
    act(() => subscriptions.at(-1)!.deliver(post));
    expect(screen.getByText(/private post/)).toBeTruthy();

    chats.one.hiddenNoteIds = [post.id];
    view.rerender(<Stage eventId="one" />);
    await act(async () => {});
    act(() => subscriptions.at(-1)!.deliver(post));
    expect(screen.queryByText(/private post/)).toBeNull();
  });
});

describe("useLiveEventChat page modes (D-POLL-MIN)", () => {
  it("screen (OBS) never polls chat metadata and still fails closed after 5 s of live state", async () => {
    const view = render(<Stage eventId="one" page="screen" />);
    await mountLive(view, <Stage eventId="one" page="screen" />);
    // useChatMembers(eventId, enabled, failClosed): no poll argument any more
    expect(memberArgs.every(args => args.length === 3)).toBe(true);
    expect(rendered.at(-1)!.status).toBe("on");

    // Old metadata no longer blanks the screen (no freshness window)…
    memberUpdatedAt = Date.now() - 10 * 60_000;
    view.rerender(<Stage eventId="one" page="screen" />);
    expect(rendered.at(-1)!.status).toBe("connecting"); // …except when it predates the signal EOSE
    memberUpdatedAt = Date.now() + 5;
    view.rerender(<Stage eventId="one" page="screen" />);
    expect(rendered.at(-1)!.status).toBe("on");

    // Live state that is no longer current (failed GET or the `live` signal subscription down) blanks rows
    view.rerender(<Stage eventId="one" page="screen" stateCurrent={false} />);
    expect(rendered.at(-1)!.status).toBe("unavailable");
  });

  it("screen holds rows until the hide/unhide signal has reached EOSE and metadata was read after it", async () => {
    const post = { id: "aa".repeat(32), pubkey: "shared-author", created_at: Math.floor(Date.now() / 1000), content: "held post" } as NostrEvent;
    poolDefaults.eose = false;
    const view = render(<Stage eventId="one" page="screen" />);
    await act(async () => {});
    view.rerender(<Stage eventId="one" page="screen" />);
    act(() => subscriptions.at(-1)!.deliver(post));
    expect(screen.queryByText(/held post/)).toBeNull();
    expect(rendered.at(-1)!.status).toBe("connecting");
    expect(refetches.count).toBe(0);

    // EOSE arrives: one metadata read, and rows only once it has landed.
    const before = memberUpdatedAt;
    act(() => { pools.at(-1)!.eose = true; pools.at(-1)!.onstatus?.(); });
    expect(refetches.count).toBe(1);
    expect(memberUpdatedAt).toBeGreaterThan(before);
    view.rerender(<Stage eventId="one" page="screen" />);
    expect(screen.getByText(/held post/)).toBeTruthy();

    // Reconnect: the old EOSE no longer counts; rows hold until the new EOSE and read.
    act(() => { pools.at(-1)!.connected = false; pools.at(-1)!.onstatus?.(); });
    expect(screen.queryByText(/held post/)).toBeNull();
    act(() => { pools.at(-1)!.connected = true; pools.at(-1)!.onstatus?.(); });
    expect(refetches.count).toBe(2);
    view.rerender(<Stage eventId="one" page="screen" />);
    expect(screen.getByText(/held post/)).toBeTruthy();
  });

  it("a hide signal removes the row at once and an unhide brings it back, with no metadata request", async () => {
    const post = { id: "bb".repeat(32), pubkey: "shared-author", created_at: Math.floor(Date.now() / 1000), content: "signalled post" } as NostrEvent;
    const view = render(<Stage eventId="one" page="screen" />);
    await mountLive(view, <Stage eventId="one" page="screen" />);
    act(() => subscriptions.at(-1)!.deliver(post));
    expect(screen.getByText(/signalled post/)).toBeTruthy();
    const reads = refetches.count;
    const subscribed = subscriptions.length;

    act(() => signals.at(-1)!.deliver(hideSignal("topic-one", 2_000, [post.id])));
    expect(screen.queryByText(/signalled post/)).toBeNull();
    // An older signal (already in the payload, or out of order) does not undo it.
    act(() => signals.at(-1)!.deliver(hideSignal("topic-one", 1_500, [], [post.id])));
    expect(screen.queryByText(/signalled post/)).toBeNull();
    // A signal for another topic or author is ignored.
    act(() => signals.at(-1)!.deliver(hideSignal("topic-two", 3_000, [], [post.id])));
    act(() => signals.at(-1)!.deliver({ ...hideSignal("topic-one", 3_000, [], [post.id]), pubkey: "ee".repeat(32) }));
    expect(screen.queryByText(/signalled post/)).toBeNull();

    act(() => signals.at(-1)!.deliver(hideSignal("topic-one", 4_000, [], [post.id])));
    expect(screen.getByText(/signalled post/)).toBeTruthy();
    expect(refetches.count).toBe(reads);
    // Applying hidden ids does not reconnect (the buffer survives).
    expect(subscriptions.length).toBe(subscribed);
  });

  it("screen shows no rows without a service key (no signal to keep hides current)", async () => {
    chats.one.hiddenSignal = null;
    const view = render(<Stage eventId="one" page="screen" />);
    await mountLive(view, <Stage eventId="one" page="screen" />);
    expect(rendered.at(-1)!.status).toBe("unavailable");
    expect(subscriptions).toHaveLength(0);
  });

  it("the live-state kill switch still blanks rows", async () => {
    const post = { id: "cc".repeat(32), pubkey: "shared-author", created_at: Math.floor(Date.now() / 1000), content: "live post" } as NostrEvent;
    const view = render(<Stage eventId="one" page="screen" />);
    await mountLive(view, <Stage eventId="one" page="screen" />);
    act(() => subscriptions.at(-1)!.deliver(post));
    expect(screen.getByText(/live post/)).toBeTruthy();
    view.rerender(<Stage eventId="one" page="screen" liveState={{ ...state, chatSource: "off" }} />);
    expect(screen.queryByText(/live post/)).toBeNull();
    expect(rendered.at(-1)!.status).toBe("off");
  });

  it("control does not poll chat metadata, ignores its age, still requires a successful fetch and current live state", async () => {
    memberUpdatedAt = Date.now() - 10 * 60_000;
    const view = render(<Stage eventId="one" page="control" />);
    await act(async () => {});
    expect(memberArgs.length).toBeGreaterThan(0);
    expect(refetches.count).toBe(0);
    expect(rendered.at(-1)!.status).toBe("on");

    view.rerender(<Stage eventId="one" page="control" stateCurrent={false} />);
    expect(rendered.at(-1)!.status).toBe("unavailable");

    memberError = true;
    view.rerender(<Stage eventId="one" page="control" />);
    expect(rendered.at(-1)!.status).toBe("unavailable");

    memberError = false;
    memberUpdatedAt = 0;
    view.rerender(<Stage eventId="one" page="control" />);
    expect(rendered.at(-1)!.status).toBe("unavailable");
  });
});
