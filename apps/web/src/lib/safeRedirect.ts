/**
 * ログイン後の戻り先（`/login?next=…`）として安全なパスだけを通す。
 *
 * 「先頭が / かどうか」だけでは `//evil.com` や `/\evil.com` を弾けない。
 * ブラウザはこれらをプロトコル相対URLとして扱うので、外部サイトへ飛ばす
 * 踏み台になる。同一オリジンに解決できたときだけ、パス＋クエリ＋ハッシュを
 * 組み直して返す（元の文字列はそのまま使わない）。
 */
export function safeRedirectPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/")) return null;
  // "//host" と "/\host"（一部ブラウザが "//" と同一視する）を先に落とす
  if (/^[/\\]{2}/.test(next)) return null;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
