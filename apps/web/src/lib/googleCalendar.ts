import type { Event } from "@eventer/shared";

/**
 * Google カレンダーの「予定を作成」画面を開く URL を組み立てる (#487)。
 *
 * サーバーは関与しない。押した先で Google がフォームを埋めた状態で開くだけで、
 * events lab 側には何も残らない（＝参加登録とは無関係）。
 *
 * 日程調整中（開催日時が未確定）のイベントでは null を返す。入れる日付が無い。
 */

const RENDER_URL = "https://calendar.google.com/calendar/render";

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

/** 予定の場所。オンラインは URL、それ以外は会場名（ハイブリッドは会場を優先） */
export function calendarLocation(event: Event): string {
  if (event.venueType === "online") return event.venueOnline ?? "";
  return event.venueOffline || (event.venueOnline ?? "");
}

/**
 * 予定の本文。説明の冒頭とイベント URL を入れる。
 *
 * URL を必ず入れるのは、カレンダーから events lab に戻る道を残すため
 * （当日「これ何だっけ」で開き直せる）。説明は長いと Google 側で
 * 読みにくくなるので頭だけ。
 */
export function calendarDetails(event: Event, eventUrl: string): string {
  const head = (event.description || "").trim().slice(0, 500);
  return head ? `${head}\n\n${eventUrl}` : eventUrl;
}

/**
 * Google カレンダー追加リンク。日程未確定なら null。
 *
 * @param eventUrl 本文に載せるイベントの絶対 URL（短いシェア URL を想定）
 */
export function googleCalendarUrl(
  event: Event,
  eventUrl: string,
): string | null {
  if (event.scheduling) return null;
  if (!event.startsAt) return null;

  // 終了が入っていない・開始より前のイベントは開始と同じにする。
  // 範囲が壊れた dates= を渡すと Google 側がフォームごと空で開く
  const endsAt =
    event.endsAt && event.endsAt >= event.startsAt ? event.endsAt : event.startsAt;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toGoogleUtc(event.startsAt)}/${toGoogleUtc(endsAt)}`,
    details: calendarDetails(event, eventUrl),
  });
  // 空の location= を送ると Google の場所欄が空文字で埋まるので、あるときだけ
  const location = calendarLocation(event);
  if (location) params.set("location", location);

  return `${RENDER_URL}?${params.toString()}`;
}
