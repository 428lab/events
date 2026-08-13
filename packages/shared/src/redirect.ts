/**
 * ログイン後の戻り先として安全なパスだけを通す (#330, #381)。
 *
 * **画面とサーバーで同じ規則を使う**ためにここに置いてある。
 * 画面は `/login?next=…` を控えるときに、サーバーは Bluesky のコールバックで
 * 302 の行き先を組むときに通す。規則が2か所に分かれると、片方だけ緩いほうが
 * 踏み台になる（実際 Bluesky 側は「先頭が / か」だけを見ていた）。
 *
 * 「先頭が / かどうか」だけでは `//evil.com` や `/\evil.com` を弾けない。
 * ブラウザはこれらをプロトコル相対URLとして扱うので、外部サイトへ飛ばす
 * 踏み台になる。同一オリジンに解決できたときだけ、パス＋クエリ＋ハッシュを
 * **組み直して**返す（元の文字列はそのまま使わない）。
 *
 * 組み直しは安全のうえでも効いている。URL の解析器は入力から改行とタブを
 * 取り除くので、`/a\nb` のような値が Location ヘッダに素通りしない
 * （素通りすると `Response` の構築時にヘッダ検証で落ち、**セッションは発行
 * 済みなのにリダイレクトが返らない**＝「ログインしたのに未ログイン」になる）。
 *
 * @param origin 自分のオリジン。画面は `window.location.origin`、
 *   サーバーは `APP_BASE_URL` を渡す
 */
export function safeRedirectPath(
  next: string | null | undefined,
  origin: string,
): string | null {
  if (!next || !next.startsWith("/")) return null;
  // "//host" と "/\host"（一部ブラウザが "//" と同一視する）を先に落とす
  if (/^[/\\]{2}/.test(next)) return null;
  try {
    const url = new URL(next, origin);
    if (url.origin !== new URL(origin).origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
