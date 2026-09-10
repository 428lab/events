import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from "cloudflare:test";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { avatarWebp } from "./fixtures/avatarWebp.js";
import { userAvatarsRepo } from "../src/db/repositories/userAvatars.js";
import { avatarKey, syncAvatarFromSource } from "../src/lib/avatarStore.js";
import { uploadedAvatarKeys } from "../src/lib/avatarUploadStorage.js";

async function hit(path: string, init: RequestInit = {}) {
  const { default: worker } = await import("../src/worker.js");
  const ctx = createExecutionContext();
  const result = await worker.fetch(new Request(`https://example.com${path}`, init), env as never, ctx);
  await waitOnExecutionContext(ctx);
  return result;
}
async function login() {
  const res = await hit("/api/auth/dev-login", { method: "POST" });
  const { user } = await res.json() as { user: { id: string } };
  return { id: user.id, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}
function upload(cookie?: string, bytes = avatarWebp, mime = "image/webp") {
  return hit("/api/me/avatar", { method: "PUT", headers: { ...(cookie ? { cookie } : {}), "content-type": mime }, body: bytes });
}
beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => vi.restoreAllMocks());
describe("personal WebP avatar upload (#511)", () => {
  it("requires authentication and rejects other formats, oversized bodies and wrong dimensions", async () => {
    expect((await upload()).status).toBe(401);
    const { id, cookie } = await login();
    expect((await upload(cookie, avatarWebp, "image/png")).status).toBe(400);
    expect((await upload(cookie, new Uint8Array(1024 * 1024 + 1))).status).toBe(413);
    expect((await upload(cookie, new Uint8Array([1, 2, 3]))).status).toBe(400);
    const wrong = avatarWebp.slice(); wrong[24] = 0;
    expect((await upload(cookie, wrong)).status).toBe(400);
    expect(await uploadedAvatarKeys(id)).toEqual([]);
  });
  it("stores WebP for the session owner, publicly serves it, and removes the previous immutable object", async () => {
    const { id, cookie } = await login();
    const other = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,0)").bind(other, other, other).run();
    const first = await upload(cookie); expect(first.status).toBe(200);
    const old = await userAvatarsRepo.findAvatarSyncState(id);
    expect(old?.uploadedKey).toMatch(new RegExp(`^avatars/${id}/uploads/`));
    const second = await upload(cookie); expect(second.status).toBe(200);
    const { avatarUrl } = await second.json() as { avatarUrl: string };
    expect(await env.BUCKET.head(old!.uploadedKey!)).toBeNull();
    const read = await hit(avatarUrl);
    expect(read.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(avatarWebp);
    expect(await uploadedAvatarKeys(id)).toHaveLength(1);
    expect((await userAvatarsRepo.findAvatarSyncState(other))?.uploadedKey).toBeNull();
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?").bind(Date.now() - 400 * 86400000, id).run();
    const purge = await hit("/api/cron/purge-deleted", { method: "POST", headers: { "x-cron-key": "test-cron-secret" } });
    expect(purge.status).toBe(200); await purge.arrayBuffer();
    expect(await uploadedAvatarKeys(id)).toEqual([]);
  });
  it("keeps the previous image and cleans the candidate when the DB save fails", async () => {
    const { id, cookie } = await login();
    expect((await upload(cookie)).status).toBe(200);
    const before = await userAvatarsRepo.findAvatarSyncState(id);
    vi.spyOn(userAvatarsRepo, "setUploadedAvatar").mockRejectedValueOnce(new Error("test database failure"));
    expect((await upload(cookie)).status).toBe(500);
    expect(await userAvatarsRepo.findAvatarSyncState(id)).toEqual(before);
    expect(await uploadedAvatarKeys(id)).toEqual([before!.uploadedKey]);
    const image = await env.BUCKET.get(before!.uploadedKey!);
    expect(new Uint8Array(await image!.arrayBuffer())).toEqual(avatarWebp);
  });
  it("allows only one writer for concurrent manual replacements", async () => {
    const { id, cookie } = await login();
    const original = userAvatarsRepo.setUploadedAvatar.bind(userAvatarsRepo);
    let count = 0, release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    vi.spyOn(userAvatarsRepo, "setUploadedAvatar").mockImplementation(async (...args) => {
      if (++count === 2) release();
      await gate;
      return original(...args);
    });
    const responses = await Promise.all([upload(cookie), upload(cookie)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await uploadedAvatarKeys(id)).toHaveLength(1);
  });
  it("prevents an already-running SNS import from overwriting the manual upload", async () => {
    const { id, cookie } = await login();
    fetchMock.get("https://avatar-upload.example.net").intercept({ path: "/icon.png" })
      .reply(200, new Uint8Array([137,80,78,71,13,10,26,10,1]), { headers: { "content-type": "image/png" } });
    let reached!: () => void, release!: () => void;
    const started = new Promise<void>(r => { reached = r; });
    const gate = new Promise<void>(r => { release = r; });
    const original = env.BUCKET.put.bind(env.BUCKET);
    vi.spyOn(env.BUCKET, "put").mockImplementation(async (key, body, options) => {
      if (key === avatarKey(id)) { reached(); await gate; }
      return original(key, body, options);
    });
    const importing = syncAvatarFromSource(id, "https://avatar-upload.example.net/icon.png");
    await Promise.race([started, importing.then(() => { throw new Error("SNS import ended before the race checkpoint"); })]);
    let snapshot;
    try { expect((await upload(cookie)).status).toBe(200); snapshot = await userAvatarsRepo.findAvatarSyncState(id); }
    finally { release(); await importing; }
    expect(await userAvatarsRepo.findAvatarSyncState(id)).toEqual(snapshot);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await syncAvatarFromSource(id, "https://avatar-upload.example.net/icon.png")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    const served = await hit(`/api/users/${id}/avatar`);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(avatarWebp);
  });
});
