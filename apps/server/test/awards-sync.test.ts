import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { AWARDS_SYNC_KIND, type AwardsSyncConfig, type EventState } from "@eventer/shared";
import worker from "../src/worker.js";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import { verifyEventSignature } from "../src/auth/nostr.js";

const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
afterEach(() => vi.restoreAllMocks());
async function actor() {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,1)", id, id, id).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}
async function setup(visibility = "public") {
  const host = await actor(), viewer = await actor(), id = crypto.randomUUID();
  await sql("INSERT INTO event(id,title,starts_at,ends_at,venue_type,status,visibility,created_by,created_at) VALUES(?, 'Secret ceremony',1,2,'online','published',?,?,1)", id, visibility, host.id).run();
  await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'staff','confirmed',1)", crypto.randomUUID(), id, host.id).run();
  return { host, viewer, id };
}
async function request(id: string, path: string, cookie?: string, method = "GET", keyless = false) {
  const ctx = createExecutionContext();
  const bindings = keyless ? { ...env, NOSTR_SERVICE_KEY: undefined } : env;
  const res = await worker.fetch(new Request(`https://example.com/api/events/${id}${path}`, {
    method, headers: cookie ? { cookie } : {},
  }), bindings as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function config(id: string, cookie: string) {
  const res = await request(id, "/awards-sync", cookie);
  expect(res.status).toBe(200);
  return (await res.json() as { sync: AwardsSyncConfig }).sync;
}

it("only authenticated viewers get an opaque topic; private invitations do not unlock chat", async () => {
  const { host, viewer, id } = await setup();
  expect((await request(id, "/awards-sync")).status).toBe(401);
  const publicConfig = await config(id, viewer.cookie);
  expect(publicConfig).toMatchObject({ kind: AWARDS_SYNC_KIND, topic: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(publicConfig.topic).not.toContain(id);
  expect(await config(id, host.cookie)).toEqual(publicConfig);
  await sql("UPDATE event SET visibility='private', access_revision=access_revision+1 WHERE id=?", id).run();
  for (const path of ["/awards-sync", "/state", "/awards"]) {
    expect((await request(id, path, viewer.cookie)).status).toBe(404);
  }
  await sql("INSERT INTO event_access_invite(id,event_id,user_id,invited_by,status,source,created_at) VALUES(?,?,?,?,'accepted','invite',1)", crypto.randomUUID(), id, viewer.id, host.id).run();
  const privateConfig = await config(id, viewer.cookie);
  expect(privateConfig.topic).not.toBe(publicConfig.topic);
  expect((await request(id, "/chat-members", viewer.cookie)).status).toBe(403);
  await sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=?", id).run();
  expect((await request(id, "/awards-sync", viewer.cookie)).status).toBe(404);
});

it("advance/reset commit first, then send only a signed unprotected ephemeral wake-up; viewers cannot emit it", async () => {
  const { host, viewer, id } = await setup("private");
  const cfg = await config(id, host.cookie);
  const committed: number[] = [];
  const publish = vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async () => {
    committed.push((await sql("SELECT awards_reveal_cursor AS cursor FROM event_state WHERE event_id=?", id).first<{cursor:number}>())!.cursor);
    return { ok: true, relays: [] };
  });
  const advanced = await request(id, "/state/awards-advance", host.cookie, "POST");
  expect(advanced.status).toBe(200);
  const state = await advanced.json() as EventState;
  expect(state.awardsRevealCursor).toBe(1);
  expect(state.updatedAt).toBeGreaterThan(Date.now() - 5000);
  expect((await request(id, "/state/awards-reset", host.cookie, "POST")).status).toBe(200);
  expect(committed).toEqual([1, 0]);
  for (const [relays, signal] of publish.mock.calls) {
    expect(signal.kind).toBe(AWARDS_SYNC_KIND);
    expect(signal.content).toBe("");
    expect(signal.pubkey).toBe(cfg.pubkey);
    expect(signal.tags).toEqual([["e", cfg.topic], ["nonce", expect.any(String)]]);
    expect(JSON.stringify(signal)).not.toContain(id);
    expect(JSON.stringify(signal)).not.toContain("Secret ceremony");
    expect(verifyEventSignature(signal)).toBe(true);
    expect(relays).toEqual(cfg.relays);
  }
  expect(publish.mock.calls[0][1].id).not.toBe(publish.mock.calls[1][1].id);
  expect((await request(id, "/state/awards-advance", viewer.cookie, "POST")).status).toBe(404);
  expect(publish).toHaveBeenCalledTimes(2);
});

it("keyless/failed relay does not roll back a committed advance or require a relay for initial HTTP state", async () => {
  const { host, id } = await setup();
  const publish = vi.spyOn(nostrRelay, "publishToRelays").mockRejectedValue(new Error("offline"));
  expect(await (await request(id, "/awards-sync", host.cookie, "GET", true)).json()).toEqual({ sync: null });
  expect((await request(id, "/state/awards-advance", host.cookie, "POST", true)).status).toBe(200);
  expect(publish).not.toHaveBeenCalled();
  expect((await request(id, "/state/awards-advance", host.cookie, "POST")).status).toBe(200);
  expect(publish).toHaveBeenCalledOnce();
  expect(await (await request(id, "/state", host.cookie)).json()).toMatchObject({ awardsRevealCursor: 2 });
  expect((await request(id, "/awards", host.cookie)).status).toBe(200);
});
