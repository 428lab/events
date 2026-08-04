import {
  CHAT_RELAYS,
  CHAT_RELAY_MAX,
  CHAT_RELAY_URL_PATTERN,
} from "@eventer/shared";
import { one, run } from "../client.js";

/** アプリ全体の運用設定 (key-value)。app admin のみが書き換える */
export const appSettingsRepo = {
  async get(key: string): Promise<string | null> {
    const row = await one<{ value: string }>(
      "SELECT value FROM app_setting WHERE key = ?",
      key,
    );
    return row?.value ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    await run(
      `INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      Date.now(),
    );
  },

  async delete(key: string): Promise<void> {
    await run("DELETE FROM app_setting WHERE key = ?", key);
  },
};

/** チャットリレーURL一覧（JSON配列）を保存する設定キー */
export const CHAT_RELAYS_KEY = "chat_relays";

/** チャットに使うリレーの実効値。設定が無い/壊れている/空のときは既定値。
 * 各エントリは wss:// のURLのみ許可し、上限 CHAT_RELAY_MAX 件に丸める */
export async function getChatRelays(): Promise<string[]> {
  const raw = await appSettingsRepo.get(CHAT_RELAYS_KEY);
  if (raw === null) return [...CHAT_RELAYS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...CHAT_RELAYS];
    const valid = parsed.filter(
      (v): v is string =>
        typeof v === "string" && CHAT_RELAY_URL_PATTERN.test(v),
    );
    if (valid.length === 0 || valid.length !== parsed.length) {
      return [...CHAT_RELAYS];
    }
    return valid.slice(0, CHAT_RELAY_MAX);
  } catch {
    return [...CHAT_RELAYS];
  }
}
