/**
 * 通知からの遷移先を組み立てる。
 *
 * 通知経由の流入を統計で判別できるよう、計測対象のイベントページにだけ
 * ref を付ける。通知ベルとお知らせ一覧 (#294) で同じ扱いにするための共通化。
 */
export function notificationLinkTo(link: string): string {
  if (!link.startsWith("/events/")) return link;
  return link.includes("?")
    ? `${link}&ref=notification`
    : `${link}?ref=notification`;
}
