import { fetchLoginChallenge, loginEventTemplate } from "./nostr.js";

/**
 * Android の署名アプリ（Amber）を NIP-55 の `nostrsigner:` で直接呼んでログイン・連携する
 * (D-NOSTR-SIGNER PR-B)。
 *
 * リレーは使わない。Amber が署名済みのお題を `callbackUrl` の末尾に付けて、
 * ブラウザで開き直す。受け取るのは `/login/nostr-signer`（NostrSignerCallbackPage）。
 * `returnType=event` にして、pubkey を含む署名済みイベント全体を1往復で受け取る。
 * pubkey は渡さなくてよい（Amber が自分の鍵で埋める。Amber IntentUtils.getUnsignedEvent）。
 *
 * Amber は `nostrsigner:` の URL 全体をデコードしてから `?` で区切って読む
 * （Amber IntentUtils.getIntentDataWithoutExtras）。なので `callbackUrl` に `?` を入れると
 * そこで切れる。戻り先は `#` で終わらせ、結果はフラグメントで受け取る。
 * 同じ理由で `+` は空白にならない（`%2b` に置き換えてからデコードする）ので、空白は `%20` にする。
 */

/** 戻り先のページ。同じオリジンの固定のパスだけにする（外部への踏み台にしない） */
export const NOSTR_SIGNER_CALLBACK_PATH = "/login/nostr-signer";

/** 戻ってきたときに、ログインか連携かを知るための控え（localStorage） */
export const NOSTR_SIGNER_INTENT_KEY = "nostrSignerIntent";

export type NostrSignerIntent = "login" | "link";

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** お題の雛形に署名を頼む `nostrsigner:` の URL */
export function buildSignEventUrl(
  template: Record<string, unknown>,
  origin: string,
): string {
  const params = [
    ["type", "sign_event"],
    ["returnType", "event"],
    ["compressionType", "none"],
    ["appName", "events lab"],
    ["callbackUrl", `${origin}${NOSTR_SIGNER_CALLBACK_PATH}#`],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `nostrsigner:${encodeURIComponent(JSON.stringify(template))}?${params}`;
}

/** お題を取り、ログインか連携かを控えてから Amber に移る */
export async function startNostrSignerLogin(
  intent: NostrSignerIntent,
): Promise<void> {
  const challenge = await fetchLoginChallenge();
  localStorage.setItem(NOSTR_SIGNER_INTENT_KEY, intent);
  window.location.href = buildSignEventUrl(
    loginEventTemplate(challenge),
    window.location.origin,
  );
}

/** 控えたログインか連携か。消すのは clearNostrSignerIntent（読むのと分けておく） */
export function readNostrSignerIntent(): NostrSignerIntent {
  return localStorage.getItem(NOSTR_SIGNER_INTENT_KEY) === "link"
    ? "link"
    : "login";
}

export function clearNostrSignerIntent(): void {
  localStorage.removeItem(NOSTR_SIGNER_INTENT_KEY);
}

/**
 * 戻り先の URL のフラグメント（`#` の後ろ）から、署名済みのイベントを取り出す。
 * Amber はエンコードして付ける（Uri.encode）が、ブラウザが一部を戻すこともあるので、
 * デコードできればデコードし、だめならそのまま読む。
 * 署名済みのイベント（pubkey・sig つき）でなければ null。
 */
export function parseSignedEventFromUrl(
  hash: string,
): { pubkey: string; [k: string]: unknown } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  for (const text of [safeDecode(raw), raw]) {
    if (text === null) continue;
    try {
      const ev = JSON.parse(text) as unknown;
      if (
        ev &&
        typeof ev === "object" &&
        typeof (ev as { pubkey?: unknown }).pubkey === "string" &&
        typeof (ev as { sig?: unknown }).sig === "string"
      ) {
        return ev as { pubkey: string };
      }
    } catch {
      /* 次の読み方を試す */
    }
  }
  return null;
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
