import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { WebcryptoKey } from "@atproto/jwk-webcrypto";
import { bindEnv, type Env } from "../src/runtime.js";
import { blueskyAuthStateRepo } from "../src/db/repositories/blueskyAuthState.js";
import {
  createStateStore,
  discardState,
  peekState,
} from "../src/auth/bluesky/stateStore.js";

/**
 * 認可開始が失敗したときの後始末 (#381)。
 *
 * state 行には **DPoP の秘密鍵**が入る。行は PAR の**前**に書かれるので、
 * PAR で落ちると掃除（TTL の2倍 = 20分）まで残ってしまっていた。
 * 開始側が「書かれた state」を受け取って消せること＝この配線を固定する。
 */

async function makeDpopKey() {
  return WebcryptoKey.generate(["ES256"], undefined, { extractable: true });
}

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

describe("失敗した認可開始の後始末 (#381)", () => {
  it("行を書いた直後に、その state を開始側へ知らせる", async () => {
    const written: string[] = [];
    const store = createStateStore(Date.now, (s) => written.push(s));
    const state = `s_${crypto.randomUUID()}`;

    await store.set(state, {
      iss: "https://bsky.social",
      dpopKey: await makeDpopKey(),
      authMethod: { method: "none" },
      verifier: "verifier-value",
      appState: JSON.stringify({ tag: "abc" }),
    });

    // これが渡らないと、PAR で失敗したときに消す手がかりが無い
    expect(written).toEqual([state]);
    expect(await blueskyAuthStateRepo.find(state)).toBeTruthy();

    // 開始側がやること: 知らされた state を消す
    for (const s of written) await discardState(s);
    expect(await blueskyAuthStateRepo.find(state)).toBeNull();
    expect(await peekState(state)).toBeNull();
  });

  it("知らせる相手がいなくても書き込みは壊れない（省略可）", async () => {
    const store = createStateStore();
    const state = `s_${crypto.randomUUID()}`;
    await store.set(state, {
      iss: "https://bsky.social",
      dpopKey: await makeDpopKey(),
      authMethod: { method: "none" },
      verifier: "v",
    });
    expect(await blueskyAuthStateRepo.find(state)).toBeTruthy();
    await discardState(state);
  });
});
