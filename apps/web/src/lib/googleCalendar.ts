import { stripMarkdown, truncateCodePoints, type Event } from "@eventer/shared";

/**
 * Google カレンダーの「予定を作成」画面を開く URL を組み立てる (#487)。
 *
 * サーバーは関与しない。押した先で Google がフォームを埋めた状態で開くだけで、
 * events lab 側には何も残らない（＝参加登録とは無関係）。
 *
 * **出す・出さないの判断はすべてここ**（null を返す）。呼び出し側に条件を
 * 書き足さない。条件が2か所に分かれると片方だけ直る。
 * - 公開前（下書き）: 本文に載せる /e/:slug が開けない
 * - 日程調整中: 入れる日付が無い
 * - 終了済み: 過去の予定を作っても意味がない
 */

const RENDER_URL = "https://calendar.google.com/calendar/render";

/** 本文に入れる説明の上限（コードポイント数）。長いと Google 側で読みにくい */
const DETAILS_MAX = 500;

/**
 * epoch ms → Google が受け取る UTC の基本形式 `YYYYMMDDTHHMMSSZ`。
 *
 * ローカル時刻ではなく **UTC で渡す**。ローカル形式（末尾 Z なし）で渡すと
 * Google は「開いた人のタイムゾーン」で解釈するので、海外から開いた参加者の
 * カレンダーに別の時刻で入る。UTC なら受け取り側が自分の地域に直してくれる。
 */
export function toGoogleUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * 予定の場所。
 * - online: 参加 URL
 * - offline: 会場名だけ。`venueOnline` には触らない（ハイブリッド→オフラインに
 *   変えたとき古い URL が残ることがあり、それを場所に出すと誤誘導になる）
 * - hybrid: 会場名を優先。現地に行く人のほうが道に迷う。無ければ URL
 */
export function calendarLocation(event: Event): string {
  switch (event.venueType) {
    case "online":
      return event.venueOnline ?? "";
    case "offline":
      return event.venueOffline ?? "";
    default:
      return event.venueOffline || (event.venueOnline ?? "");
  }
}

/**
 * 予定の本文。説明の冒頭（Markdown 記号は落とす）とイベント URL。
 *
 * URL を必ず入れるのは、カレンダーから events lab に戻る道を残すため
 * （当日「これ何だっけ」で開き直せる）。
 * ハイブリッドは場所欄が会場名になるので、オンラインの参加 URL はここに載せる。
 * 載せないと、リモートで参加する人のカレンダーに入口が無くなる。
 */
export function calendarDetails(event: Event, eventUrl: string): string {
  const parts: string[] = [];
  const head = truncateCodePoints(stripMarkdown(event.description || ""), DETAILS_MAX);
  if (head) parts.push(head);
  if (event.venueType === "hybrid" && event.venueOnline && event.venueOffline) {
    parts.push(event.venueOnline);
  }
  parts.push(eventUrl);
  return parts.join("\n\n");
}

/**
 * Google カレンダー追加リンク。出せない条件では null。
 *
 * @param eventUrl 本文に載せるイベントの絶対 URL（短いシェア URL を想定）
 * @param now 終了判定の基準時刻
 */
export function googleCalendarUrl(
  event: Event,
  eventUrl: string,
  now = Date.now(),
): string | null {
  if (event.status !== "published") return null;
  if (event.scheduling) return null;
  if (!event.startsAt) return null;
  // 終了時刻が壊れていて（0 / 開始より前）判定できないときは、開始で見る
  const endsAt = Math.max(event.startsAt, event.endsAt || 0);
  if (endsAt < now) return null;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    // 壊れた範囲（終了 < 開始）を渡すと Google 側がフォームごと空で開く
    dates: `${toGoogleUtc(event.startsAt)}/${toGoogleUtc(endsAt)}`,
    details: calendarDetails(event, eventUrl),
  });
  // 空の location= を送ると Google の場所欄が空文字で埋まるので、あるときだけ
  const location = calendarLocation(event);
  if (location) params.set("location", location);

  return `${RENDER_URL}?${params.toString()}`;
}
