import { one, run } from "../client.js";

/**
 * Bluesky ログイン (#381) の認可開始〜コールバック間の持ち越し (bluesky_oauth_state)。
 *
 * **生 SQL はこのファイルだけ。** 中身の解釈（JSON の形・DPoP 鍵の JWK 往復・
 * 期限切れの扱い）は auth/bluesky/stateStore.ts が持つ。ここは行の出し入れだけ。
 */

export interface BlueskyAuthStateRow {
  /** ライブラリが生成した state（認可 URL には出ない。7.3 参照） */
  state: string;
  /** InternalStateData を JSON にしたもの（DPoP 秘密鍵を含む） */
  data: string;
  createdAt: number;
}

interface Row {
  state: string;
  data: string;
  created_at: number;
}

export const blueskyAuthStateRepo = {
  async insert(state: string, data: string, createdAt: number): Promise<void> {
    await run(
      "INSERT INTO bluesky_oauth_state (state, data, created_at) VALUES (?, ?, ?)",
      state,
      data,
      createdAt,
    );
  },

  async find(state: string): Promise<BlueskyAuthStateRow | null> {
    const row = await one<Row>(
      "SELECT state, data, created_at FROM bluesky_oauth_state WHERE state = ?",
      state,
    );
    return row
      ? { state: row.state, data: row.data, createdAt: row.created_at }
      : null;
  },

  async remove(state: string): Promise<void> {
    await run("DELETE FROM bluesky_oauth_state WHERE state = ?", state);
  },

  /** createdAt が threshold より古い行を消す（掃除は書き込みのついで。7.2） */
  async deleteOlderThan(threshold: number): Promise<void> {
    await run(
      "DELETE FROM bluesky_oauth_state WHERE created_at < ?",
      threshold,
    );
  },
};
