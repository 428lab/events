import { api } from "../api/client.js";

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<unknown>;
}

export function hasNip07(): boolean {
  return Boolean((window as { nostr?: Nip07 }).nostr);
}

/**
 * NIP-07 拡張（Alby / nos2x 等）でログイン or 連携。
 * チャレンジ取得 → kind:22242 に署名 → サーバー検証。
 * 拡張が無い場合は "no_extension" を投げる。
 */
export async function nostrNip07Login(): Promise<void> {
  const nostr = (window as { nostr?: Nip07 }).nostr;
  if (!nostr) throw new Error("no_extension");
  const { challenge } = await api.get<{ challenge: string }>(
    "/auth/nostr/challenge",
  );
  const event = await nostr.signEvent({
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["relay", window.location.origin],
      ["challenge", challenge],
    ],
    content: "events lab にログイン",
  });
  await api.post("/auth/nostr/login", { event });
}
