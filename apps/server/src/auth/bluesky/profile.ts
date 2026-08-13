/**
 * 表示名とアイコンを**認証不要の公開 API** から取る (#381)。
 *
 * トークンは交換後すぐ捨てるので、認証済みの経路は使えない（そもそも使わない）。
 * 先行実装 aozoraquest では、認証済みセッションで公開データを読むと DPoP nonce の
 * 競合と CORS で連続失敗した記録があり、公開 AppView を使うのはその裏付けでもある。
 *
 * ここが失敗してもログインは通す。表示名・アイコンは「あれば埋める」もの。
 */

const APPVIEW_BASE = "https://public.api.bsky.app";

/** 取得のタイムアウト。lib/avatarStore.ts と同じ値・同じ流儀。
 * 「失敗しても続ける」という意図は、**遅延に対しても効かせないと意味がない**
 * （相手が黙って握ったままだと、ログインの応答がその間ずっと返らない） */
const FETCH_TIMEOUT_MS = 5000;

export interface BlueskyPublicProfile {
  /** 表示用のハンドル。識別子ではない（識別子は DID） */
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const EMPTY: BlueskyPublicProfile = {
  handle: null,
  displayName: null,
  avatarUrl: null,
};

function pick(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** 公開 API で DID からプロフィールを引く。失敗は null 埋めで返す（例外にしない） */
export async function fetchPublicProfile(
  did: string,
): Promise<BlueskyPublicProfile> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = new URL("/xrpc/app.bsky.actor.getProfile", APPVIEW_BASE);
    url.searchParams.set("actor", did);
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      void res.body?.cancel?.().catch(() => {});
      console.warn(`[bluesky] プロフィール取得に失敗 status=${res.status}`);
      return EMPTY;
    }
    const json = (await res.json()) as Record<string, unknown>;
    const handle = pick(json.handle);
    const avatar = pick(json.avatar);
    return {
      // handle.invalid は「ハンドルが解決できない」ことを表す予約値。表示に使わない
      handle: handle && handle !== "handle.invalid" ? handle : null,
      displayName: pick(json.displayName),
      // 取得元は外部。長すぎるURLや http は入れない（Nostr の kind:0 と同じ扱い）
      avatarUrl:
        avatar && avatar.startsWith("https://") && avatar.length <= 500
          ? avatar
          : null,
    };
  } catch (e) {
    console.warn("[bluesky] プロフィール取得に失敗", e);
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}
