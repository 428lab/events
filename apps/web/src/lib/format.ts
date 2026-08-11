import type { Event, EventRole, VenueType } from "@eventer/shared";
import { dateLocale, i18next } from "../i18n/index.js";

/**
 * 日時の書式は **端末のタイムゾーンのまま、ロケールだけ切り替える** (#352)。
 * Intl に timeZone を渡していないのは意図的（利用者ごとのタイムゾーン設定は
 * 作らない）。テストのタイムゾーン固定 (#322) もそのまま効く。
 */

export function formatDateRange(startsAt: number, endsAt: number): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  const sameYear = s.getFullYear() === e.getFullYear();

  // 開始は常に年つき
  const start = new Intl.DateTimeFormat(dateLocale(), {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(s);

  // 終了は重複を避けて簡潔に（同日→時刻のみ / 同年→月日＋時刻 / 別年→年つき）
  const end = new Intl.DateTimeFormat(
    dateLocale(),
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : sameYear
        ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : {
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          },
  ).format(e);

  return i18next.t("common.dateRange", { start, end });
}

/** 単一日時を日本語表記（年つき） */
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** 月日のみ（例: "3/15"）。年は見出しで区切る年表の日付欄で使う (#308) */
export function formatMonthDay(ms: number): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    month: "numeric",
    day: "numeric",
  }).format(ms);
}

/** 時刻のみ（HH:mm） */
export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** 締切までの残り時間をざっくり日本語で（例: "あと5時間" / "あと20分"）。
 * 締切間近を伝えるのが目的なので粒度は粗くてよい。過ぎていれば空文字 (#269) */
export function formatRemaining(target: number, now = Date.now()): string {
  const diff = target - now;
  if (diff <= 0) return "";
  const hours = Math.floor(diff / 3600000);
  if (hours >= 1) return i18next.t("common.remainingHours", { n: hours });
  // 1時間未満は分単位。切り上げて「あと0分」を出さない。
  // 59分台の切り上げが 60 になると「あと60分」＝1時間の表記と食い違うので 59 で止める
  const minutes = Math.min(59, Math.max(1, Math.ceil(diff / 60000)));
  return i18next.t("common.remainingMinutes", { n: minutes });
}

/** epoch ms → datetime-local の value（ローカル時刻 "YYYY-MM-DDTHH:mm"） */
export function toDateTimeLocal(ms: number | null | undefined): string {
  if (!ms) return "";
  const off = new Date(ms).getTimezoneOffset();
  return new Date(ms - off * 60000).toISOString().slice(0, 16);
}

/** datetime-local の value → epoch ms（空なら null） */
export function fromDateTimeLocal(s: string): number | null {
  if (!s) return null;
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** イベント内での立場のラベル。訳は packages/shared/src/i18n が持つ。
 * 知らない値が来たらそのまま返す（サーバーが増やしても画面は壊れない） */
export function roleLabel(role: EventRole | string): string {
  return i18next.t(`role.${role}`, { defaultValue: String(role) });
}

/** 開催形態のラベル。知らない値はそのまま返す */
export function venueLabel(venue: VenueType | string): string {
  return i18next.t(`venue.${venue}`, { defaultValue: String(venue) });
}

/** 人数表示に使うイベント項目 */
type CountableEvent = Pick<
  Event,
  | "attendanceCheck"
  | "scheduling"
  | "startsAt"
  | "participantCount"
  | "attendedCount"
  | "capacityTotal"
>;

/** 出席者数も並べるか。出席チェックモードで、かつ開始日時を過ぎたイベントだけ。
 * 開催前は誰も出席していないので「出席 0 人」を並べても意味がない。
 * 日程調整中・開始日時が未設定 (0) のイベントは開催前として扱う (#297) */
export function showsAttendedCount(
  event: CountableEvent,
  now: number = Date.now(),
): boolean {
  return (
    event.attendanceCheck &&
    !event.scheduling &&
    event.startsAt > 0 &&
    event.startsAt <= now
  );
}

/** 「参加 5 人」「参加 5 / 21 人」「参加 5 人・出席 3 人」 (#297)。
 *
 * 参加枠があるイベントは上限も並べる。空きがあるかが一覧で分かるようにするため。
 * 上限は枠の合計にスタッフ等を足した数（capacityTotal 参照）なので、
 * 分子の参加者数と数える対象が揃っている */
export function participantCountLabel(
  event: CountableEvent,
  now: number = Date.now(),
): string {
  const base =
    event.capacityTotal == null
      ? i18next.t("common.participants", { n: event.participantCount })
      : i18next.t("common.participantsOfCapacity", {
          n: event.participantCount,
          total: event.capacityTotal,
        });
  return showsAttendedCount(event, now)
    ? i18next.t("common.participantsWithAttended", {
        base,
        n: event.attendedCount,
      })
    : base;
}
