import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { WebcryptoKey } from "@atproto/jwk-webcrypto";
import { bindEnv, type Env } from "../src/runtime.js";
import { blueskyAuthStateRepo } from "../src/db/repositories/blueskyAuthState.js";
import {
  BLUESKY_STATE_TTL_MS,
  createStateStore,
} from "../src/auth/bluesky/stateStore.js";

/** Bluesky ログイン (#381) の state ストア。設計 14 のテスト5。
 * DPoP 秘密鍵を JWK で往復させる・期限切れは見えない・掃除は古い行だけ */

async function makeDpopKey() {
  // extractable を渡さないと privateJwk が取れない（スパイク S4）
  return WebcryptoKey.generate(["ES256"], undefined, { extractable: true });
}

describe("Bluesky state ストア (#381)", () => {
  it("保存→取得で DPoP 鍵が JWK 経由で往復する", async () => {
    bindEnv(env as unknown as Env);
    const store = createStateStore();
    const key = await makeDpopKey();
    const state = `s_${crypto.randomUUID()}`;

    await store.set(state, {
      iss: "https://bsky.social",
      dpopKey: key,
      authMethod: { method: "none" },
      verifier: "verifier-value",
      appState: JSON.stringify({ tag: "abc", next: "/me" }),
    });

    const got = await store.get(state);
    expect(got).toBeTruthy();
    expect(got!.iss).toBe("https://bsky.social");
    expect(got!.verifier).toBe("verifier-value");
    expect(got!.authMethod).toEqual({ method: "none" });
    expect(got!.appState).toBe(JSON.stringify({ tag: "abc", next: "/me" }));
    // 同じ鍵に戻っている（kid と公開 JWK の一致、かつ署名できる）
    expect(got!.dpopKey.kid).toBe(key.kid);
    expect(got!.dpopKey.publicJwk).toEqual(key.publicJwk);
    const jwt = await got!.dpopKey.createJwt(
      { alg: "ES256", typ: "dpop+jwt" },
      { htm: "POST", htu: "https://bsky.social/oauth/par" },
    );
    expect(jwt.split(".").length).toBe(3);
  });

  it("TTL を超えた行は取得できない（行も残さない）", async () => {
    bindEnv(env as unknown as Env);
    const key = await makeDpopKey();
    const state = `s_${crypto.randomUUID()}`;
    const t0 = Date.now();
    // 保存時点は t0、取得時点は TTL を1ミリ秒超えた後
    let now = t0;
    const store = createStateStore(() => now);
    await store.set(state, {
      iss: "https://bsky.social",
      dpopKey: key,
      authMethod: { method: "none" },
      verifier: "v",
    });
    now = t0 + BLUESKY_STATE_TTL_MS + 1;
    expect(await store.get(state)).toBeUndefined();
    expect(await blueskyAuthStateRepo.find(state)).toBeNull();
  });

  it("del で消える（同じ state の2回目は取れない）", async () => {
    bindEnv(env as unknown as Env);
    const store = createStateStore();
    const key = await makeDpopKey();
    const state = `s_${crypto.randomUUID()}`;
    await store.set(state, {
      iss: "https://bsky.social",
      dpopKey: key,
      authMethod: { method: "none" },
      verifier: "v",
    });
    expect(await store.get(state)).toBeTruthy();
    await store.del(state);
    expect(await store.get(state)).toBeUndefined();
  });

  it("掃除は古い行だけを消す", async () => {
    bindEnv(env as unknown as Env);
    const old = `s_${crypto.randomUUID()}`;
    const fresh = `s_${crypto.randomUUID()}`;
    const now = Date.now();
    await blueskyAuthStateRepo.insert(old, "{}", now - 60 * 60 * 1000);
    await blueskyAuthStateRepo.insert(fresh, "{}", now);
    await blueskyAuthStateRepo.deleteOlderThan(now - 20 * 60 * 1000);
    expect(await blueskyAuthStateRepo.find(old)).toBeNull();
    expect(await blueskyAuthStateRepo.find(fresh)).toBeTruthy();
  });

  it("書き込みのついでに古い行が消える", async () => {
    bindEnv(env as unknown as Env);
    const store = createStateStore();
    const stale = `s_${crypto.randomUUID()}`;
    await blueskyAuthStateRepo.insert(stale, "{}", Date.now() - 60 * 60 * 1000);
    await store.set(`s_${crypto.randomUUID()}`, {
      iss: "https://bsky.social",
      dpopKey: await makeDpopKey(),
      authMethod: { method: "none" },
      verifier: "v",
    });
    expect(await blueskyAuthStateRepo.find(stale)).toBeNull();
  });
});
