import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMembersPayload, EventLiveState } from "@eventer/shared";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { useLiveEventChat } from "./LiveEventChat.js";

const { subscriptions } = vi.hoisted(() => ({ subscriptions: [] as Array<{ channel: string; deliver: (event: import("nostr-tools/pure").Event) => void }> }));
vi.mock("../lib/useEventChatAccess.js", () => ({ useEventChatAccess: () => ({ chatAvailable: true, isError: false }) }));
vi.mock("../api/eventChatHooks.js", () => ({ useChatMembers: (id: string) => ({ data: chats[id], dataUpdatedAt: memberUpdatedAt, isError: false }) }));
vi.mock("../api/encryptedChatHooks.js", () => ({ useEncryptedChat: () => ({ data: undefined, dataUpdatedAt: 0, isError: false }) }));
vi.mock("../lib/nostrChat.js", () => ({
  randomLocalSigner: () => ({}),
  ChatRelayPool: class {
    connected = true;
    onstatus?: () => void;
    connect() { this.onstatus?.(); return Promise.resolve(); }
    subscribe(channel: string, deliver: (event: NostrEvent) => void) { subscriptions.push({ channel, deliver }); return () => {}; }
    close() {}
  },
}));

const chats: Record<string, ChatMembersPayload> = Object.fromEntries(["one", "two"].map(id => [id, {
  channelId: `channel-${id}`, chatEnabled: true, relays: ["wss://relay.example"], hiddenNoteIds: [],
  members: [{ pubkey: "shared-author", userId: `user-${id}`, username: id, name: `Name ${id}`, avatarUrl: `/api/users/user-${id}/avatar?v=1`, role: "staff" }],
}]));
const state = { chatSource: "event" } as EventLiveState;
let memberUpdatedAt = Date.now();

function Stage({ eventId, liveState = state }: { eventId: string; liveState?: EventLiveState }) {
  const chat = useLiveEventChat(eventId, liveState, Date.now(), false, Date.now(), true);
  // This is the render-phase stage output, before the switch cleanup effect can run.
  rendered.push({ eventId, messages: chat.rows.map(row => row.plainText), status: chat.status });
  return <div>{chat.rows.map(row => <div key={row.id}>{row.name}: {row.plainText}<img src={row.avatar ?? undefined} alt="" /></div>)}</div>;
}
const rendered: Array<{ eventId: string; messages: string[]; status: string }> = [];

beforeEach(() => { subscriptions.length = 0; rendered.length = 0; memberUpdatedAt = Date.now(); chats.one.hiddenNoteIds = []; });
describe("useLiveEventChat event switch", () => {
  it("never paints the old post or image under the new event's cached authorized member, then delivers a new post", async () => {
    const view = render(<Stage eventId="one" />);
    await act(async () => {}); // subscribe after the pool connects
    const old = { id: "old", pubkey: "shared-author", created_at: Math.floor(Date.now() / 1000), content: "old event post" } as NostrEvent;
    act(() => subscriptions.find(s => s.channel === "channel-one")!.deliver(old));
    expect(screen.getByText(/old event post/)).toBeTruthy();
    expect(view.container.querySelector("img")?.getAttribute("src")).toContain("user-one");

    const beforeSwitch = rendered.length;
    view.rerender(<Stage eventId="two" />);
    expect(rendered[beforeSwitch]).toEqual({ eventId: "two", messages: [], status: "connecting" });
    expect(screen.queryByText(/old event post/)).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
    await act(async () => {});
    act(() => subscriptions.find(s => s.channel === "channel-two")!.deliver({ ...old, id: "new", content: "new event post" }));
    expect(screen.getByText(/new event post/)).toBeTruthy();
    expect(view.container.querySelector("img")?.getAttribute("src")).toContain("user-two");
  });

  it("purges rows on OFF, stale metadata, and changed hidden-note permissions", async () => {
    const view = render(<Stage eventId="one" />);
    await act(async () => {});
    const post = { id: "hide-me", pubkey: "shared-author", created_at: Math.floor(Date.now() / 1000), content: "private post" } as NostrEvent;
    act(() => subscriptions[0].deliver(post));
    expect(screen.getByText(/private post/)).toBeTruthy();

    view.rerender(<Stage eventId="one" liveState={{ ...state, chatSource: "off" }} />);
    expect(screen.queryByText(/private post/)).toBeNull();
    view.rerender(<Stage eventId="one" />);
    expect(screen.queryByText(/private post/)).toBeNull();
    await act(async () => {});
    act(() => subscriptions.at(-1)!.deliver(post));
    expect(screen.getByText(/private post/)).toBeTruthy();

    memberUpdatedAt = Date.now() - 7000;
    view.rerender(<Stage eventId="one" />);
    expect(screen.queryByText(/private post/)).toBeNull();
    memberUpdatedAt = Date.now();
    chats.one.hiddenNoteIds = [post.id];
    view.rerender(<Stage eventId="one" />);
    await act(async () => {});
    act(() => subscriptions.at(-1)!.deliver(post));
    expect(screen.queryByText(/private post/)).toBeNull();
  });
});
