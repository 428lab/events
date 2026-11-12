/** 発表画面で出すスライドの見つけ方。成果物の「プレゼン資料URL」が events lab のスライド閲覧
 * （`/d/:slug`）を指していれば、その slug を返す。それ以外（外部サイト・空）は null。
 *
 * 個人・チームのどちらも同じ。チームのスライドを作ると空の資料URLに `${appBaseUrl}/d/:slug` が入り
 * （teams.ts createTeamDeck）、個人は自分で貼る。外部URLは取りに行かない（埋め込みも取得もしない）。 */
const OWN_HOSTS = new Set(["events.kojira.io", "eventer-staging.kojiran.workers.dev"]);
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

export function deckSlugFromUrl(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim(), origin);
  } catch {
    return null;
  }
  const own = parsed.origin === new URL(origin).origin
    || (parsed.protocol === "https:" && OWN_HOSTS.has(parsed.hostname) && !parsed.port);
  if (!own) return null;
  const m = /^\/d\/([^/]+)\/?$/.exec(parsed.pathname);
  return m && SLUG.test(m[1]) ? m[1] : null;
}
