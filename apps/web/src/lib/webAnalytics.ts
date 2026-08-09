/** 計測タグの読み込み先。SPA の画面遷移（History API）も自前で拾う実装なので、
 * React Router 側に遷移ごとの送信を足す必要はない。 */
const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/** どのページが見られているかの計測を有効にする (#328)。
 *
 * ホスティング先が提供する計測をそのまま使う。クッキーを使わず、
 * アプリ側のデータベースにも書かない（外部の解析サービスには渡さない）。
 *
 * - 識別子は公開リポジトリに置かないので、ビルド時の環境変数
 *   `VITE_WEB_ANALYTICS_TOKEN` から受け取る。
 *   未設定の環境では何もしない＝計測は自動で無効（メール送信と同じ考え方）。
 * - 画面遷移は計測タグ側が `history.pushState` と `popstate` を見て拾うため、
 *   `spa: true`（既定でも有効だが意図を明示）だけで足りる。
 * - 読み込みや送信に失敗しても画面の表示には影響させない。 */
export function setupWebAnalytics(doc: Document = document): void {
  const token = import.meta.env.VITE_WEB_ANALYTICS_TOKEN;
  if (typeof token !== "string" || token === "") return;
  try {
    // 二重に読み込むと同じ閲覧が二重に数えられるので、既にあれば足さない
    if (doc.querySelector(`script[src="${BEACON_SRC}"]`)) return;
    const script = doc.createElement("script");
    script.src = BEACON_SRC;
    script.defer = true;
    script.setAttribute("data-cf-beacon", JSON.stringify({ token, spa: true }));
    // 通信のブロックやオフラインでの失敗は無視する（画面には出さない）
    script.addEventListener("error", () => {});
    (doc.body ?? doc.head).appendChild(script);
  } catch {
    /* 計測は画面の表示より優先しない */
  }
}
