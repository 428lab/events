import { JoseKey } from "@atproto/jwk-jose";
import type { InternalStateData, StateStore } from "@atproto/oauth-client";
import { blueskyAuthStateRepo } from "../../db/repositories/blueskyAuthState.js";

/**
 * 認可開始〜コールバックの持ち越し (#381)。D1 バックの `StateStore`。
 *
 * ライブラリは `InternalStateData` をそのまま渡してくるが、その中の `dpopKey` は
 * `Key` オブジェクトで、JSON にはできない。**保存時に秘密鍵の JWK へ、
 * 取得時に `JoseKey.fromJWK()` で戻す**（スパイク S4 で往復を実機確認済み）。
 * WebcryptoKey ではなく JoseKey で戻すのは、必要なのは JWT への署名だけで、
 * CryptoKeyPair のハンドルまで復元する必要がないため。
 *
 * 期限切れの扱いと掃除もここに置く。生 SQL は
 * db/repositories/blueskyAuthState.ts にしかない。
 */

/** state の有効期間。既存 OAuth の state cookie・Nostr チャレンジと揃える (7.2) */
export const BLUESKY_STATE_TTL_MS = 10 * 60 * 1000;

/** 掃除のしきい値。TTL の2倍（時計ずれと掃除間隔ぶんの余裕）。
 * cron は増やさず、認可開始の書き込みのついでに1文流す (7.2) */
export const BLUESKY_STATE_RETENTION_MS = BLUESKY_STATE_TTL_MS * 2;

/** D1 に入れる形。dpopKey だけ JWK に置き換わっている */
interface StoredState {
  iss: string;
  dpopJwk: Record<string, unknown>;
  authMethod: InternalStateData["authMethod"];
  verifier: string;
  appState?: string;
}

export function createStateStore(now: () => number = Date.now): StateStore {
  return {
    async set(state: string, data: InternalStateData): Promise<void> {
      const dpopJwk = data.dpopKey.privateJwk;
      if (!dpopJwk) {
        // createKey に extractable: true を渡し忘れると privateJwk が undefined に
        // なる（スパイク S4）。ここで落としておかないと、コールバックで初めて
        // 「鍵が戻らない」と分かることになる
        throw new Error("DPoP key is not extractable");
      }
      const stored: StoredState = {
        iss: data.iss,
        dpopJwk: dpopJwk as unknown as Record<string, unknown>,
        authMethod: data.authMethod,
        verifier: data.verifier,
        appState: data.appState,
      };
      const at = now();
      await blueskyAuthStateRepo.insert(state, JSON.stringify(stored), at);
      // 掃除は書き込みのついで（auth/nostr.ts と同じ流儀）
      await blueskyAuthStateRepo.deleteOlderThan(at - BLUESKY_STATE_RETENTION_MS);
    },

    async get(state: string): Promise<InternalStateData | undefined> {
      const row = await blueskyAuthStateRepo.find(state);
      if (!row) return undefined;
      // 期限切れは「無い」ものとして扱う。行はここで消しておく（掃除は
      // 書き込み側でも走るが、読んだ時点で不要と分かっているものを残さない）
      if (row.createdAt < now() - BLUESKY_STATE_TTL_MS) {
        await blueskyAuthStateRepo.remove(state);
        return undefined;
      }
      const stored = JSON.parse(row.data) as StoredState;
      return {
        iss: stored.iss,
        dpopKey: await JoseKey.fromJWK(stored.dpopJwk),
        authMethod: stored.authMethod,
        verifier: stored.verifier,
        appState: stored.appState,
      };
    },

    async del(state: string): Promise<void> {
      // ライブラリは検証の前にこれを呼ぶ（リプレイ防止）。
      // 握りつぶすと同じ state を2回使えてしまうので、失敗は上へ伝える
      await blueskyAuthStateRepo.remove(state);
    },
  };
}
