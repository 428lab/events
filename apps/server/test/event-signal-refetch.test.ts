import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { createSignalThrottle, eventSignal } from "../src/lib/eventSignal.js";
import type { RefetchSignalTarget } from "../src/lib/eventSignal.js";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";
import { verifyEventSignature } from "../src/auth/nostr.js";
import { appSettingsRepo, CHAT_RELAYS_KEY } from "../src/db/repositories/appSettings.js";

/**
 * Refetch signals (D-POLL-MIN Phase 5b-1, docs/event-signal.md): the opaque topic per
 * scope and topic name, the multi-topic `{rev}` publish, and the per-isolate throttle.
 */

beforeAll(() => bindEnv(env as unknown as Env));
afterEach(() => vi.restoreAllMocks());

function spyPublish() {
  return vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relayUrls): Promise<PublishReport> => ({
    ok: true,
    relays: relayUrls.map((url) => ({ url, outcome: "ok" as const })),
  }));
}

describe("refetch topics", () => {
  it("are opaque, stable, and differ per topic name and per scope", () => {
    const eventId = crypto.randomUUID(), other = crypto.randomUUID();
    const topic = (name: Parameters<typeof eventSignal.config>[1], scope = eventId) => eventSignal.config(scope, name, 1)!.topic;
    expect(topic("live")).toMatch(/^[0-9a-f]{64}$/);
    expect(topic("live")).toBe(topic("live"));
    expect(topic("live")).not.toContain(eventId);
    expect(new Set([topic("live"), topic("qa"), topic("bingo"), topic("bingo-staff"), topic("chat-hidden")]).size).toBe(5);
    expect(topic("live", other)).not.toBe(topic("live"));
  });

  it("do not move when the event's access revision changes (joins, leaves, invites)", async () => {
    const owner = crypto.randomUUID(), eventId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,1)").bind(owner, `nostr:${owner}`, `u_${owner.slice(0, 8)}`).run();
    await env.DB.prepare("INSERT INTO event(id,title,starts_at,ends_at,venue_type,status,visibility,created_by,created_at) VALUES(?, 'x',1,2,'online','published','public',?,1)").bind(eventId, owner).run();
    const before = eventSignal.config(eventId, "event-state", 1)!.topic;
    await env.DB.prepare("UPDATE event SET access_revision = access_revision + 5 WHERE id = ?").bind(eventId).run();
    expect(eventSignal.config(eventId, "event-state", 2)!.topic).toBe(before);
  });

  it("source() adds the relays the signal is published to", async () => {
    await appSettingsRepo.set(CHAT_RELAYS_KEY, JSON.stringify(["wss://one.example", "wss://two.example"]));
    try {
      const source = await eventSignal.source("ev", "qa", 123);
      expect(source).toEqual({ ...eventSignal.config("ev", "qa", 123), relays: ["wss://one.example", "wss://two.example"] });
    } finally {
      await appSettingsRepo.delete(CHAT_RELAYS_KEY);
    }
  });
});

describe("publishRefetch", () => {
  it("sends one service-signed, protected event with a t tag per target and only {rev}", async () => {
    const publish = spyPublish();
    const before = Date.now();
    await eventSignal.publishRefetch([["live", "ev-a"], ["qa", "ev-a"], ["meet-token", "user-1"], ["qa", "ev-a"]]);
    expect(publish).toHaveBeenCalledOnce();
    const [relays, signal] = publish.mock.calls[0];
    expect(relays.length).toBeGreaterThan(0);
    expect(signal.kind).toBe(EVENT_SIGNAL_KIND);
    expect(signal.pubkey).toBe(eventSignal.config("ev-a", "live", 1)!.pubkey);
    expect(verifyEventSignature(signal)).toBe(true);
    expect(signal.tags).toEqual([
      ["t", eventSignal.config("ev-a", "live", 1)!.topic],
      ["t", eventSignal.config("ev-a", "qa", 1)!.topic],
      ["t", eventSignal.config("user-1", "meet-token", 1)!.topic],
      ["-"],
    ]);
    const content = JSON.parse(signal.content) as Record<string, unknown>;
    expect(Object.keys(content)).toEqual(["rev"]);
    expect(content.rev).toBeGreaterThanOrEqual(before);
    expect(signal.created_at).toBe(Math.floor((content.rev as number) / 1000));
    expect(JSON.stringify(signal)).not.toContain("ev-a");
    expect(JSON.stringify(signal)).not.toContain("user-1");
  });

  it("sends nothing for no targets, and never throws when the relays fail", async () => {
    const publish = spyPublish();
    await eventSignal.publishRefetch([]);
    expect(publish).not.toHaveBeenCalled();
    publish.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(eventSignal.publishRefetch([["live", "ev"]])).resolves.toBeUndefined();
  });
});

describe("createSignalThrottle", () => {
  function harness() {
    let clock = 0;
    const sent: Array<{ at: number; targets: RefetchSignalTarget[] }> = [];
    const sleeps: Array<{ until: number; resolve: () => void }> = [];
    const throttle = createSignalThrottle(
      async (targets) => { if (targets.length) sent.push({ at: clock, targets: [...targets] }); },
      2_000,
      () => clock,
      (ms) => new Promise<void>((resolve) => sleeps.push({ until: clock + ms, resolve })),
    );
    const advance = async (to: number) => {
      clock = to;
      for (const s of sleeps.filter((s) => s.until <= to)) s.resolve();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { throttle, sent, advance };
  }

  it("sends the first change at once and collapses the rest of the window into one trailing signal", async () => {
    const { throttle, sent, advance } = harness();
    const first = throttle([["qa", "ev"]]);
    await first;
    expect(sent).toEqual([{ at: 0, targets: [["qa", "ev"]] }]);
    await advance(500);
    const second = throttle([["qa", "ev"]]);
    await advance(900);
    const third = throttle([["qa", "ev"]]);
    expect(sent).toHaveLength(1);
    await advance(2_000);
    await Promise.all([second, third]);
    expect(sent).toEqual([{ at: 0, targets: [["qa", "ev"]] }, { at: 2_000, targets: [["qa", "ev"]] }]);
    // After the window, the next change goes out at once again
    await advance(4_500);
    await throttle([["qa", "ev"]]);
    expect(sent.at(-1)).toEqual({ at: 4_500, targets: [["qa", "ev"]] });
  });

  it("throttles each topic and scope separately", async () => {
    const { throttle, sent } = harness();
    await throttle([["qa", "ev"]]);
    await throttle([["qa", "other"], ["meet-ranking", "ev"]]);
    expect(sent.map((s) => s.targets)).toEqual([[["qa", "ev"]], [["qa", "other"], ["meet-ranking", "ev"]]]);
  });
});
