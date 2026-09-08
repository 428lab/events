import type { MyEventSummary } from "@eventer/shared";

/**
 * ログイン後のホームで「次にやること」を出すための振り分け (#489)。
 *
 * 判断そのものはここに集め、画面側は並べるだけにする。
 * タブ（プロフィールの絞り込み）と違い、**問いは1つ**
 * 「自分が次に行くのはどれか」で、それに答える形に並べ替える。
 */

export interface DashboardBuckets {
  /** いま開催中。あれば最優先で出す（複数ありうる） */
  live: MyEventSummary[];
  /** 次に行く1件。開催中があるときは null（liveが主役なので二重に出さない） */
  next: MyEventSummary | null;
  /** next の後に続く予定（next 自身は含まない） */
  upcoming: MyEventSummary[];
  /** 日程調整中。開催日が無いので時系列に混ぜられない */
  scheduling: MyEventSummary[];
}

/** 下書きはホームに出さない（公開前の準備物で、プロフィールの下書きタブが持ち場） */
const isPublished = (e: MyEventSummary) => e.status === "published";

/** 開催中か。終了時刻を過ぎていない、かつ開始済み */
export function isLive(e: MyEventSummary, now: number): boolean {
  return !e.scheduling && e.startsAt <= now && e.endsAt >= now;
}

/**
 * `/api/me/events` の ongoing を、ホームに出す単位へ振り分ける。
 *
 * ongoing には日程調整中（`startsAt === 0`）が混ざる。そのまま `startsAt` で
 * 並べると**日付未定が先頭に固まって**、直近の予定を押し出してしまうため、
 * 時系列の列とは分けて扱う（一覧の phase 分けと同じ方針 #234）。
 */
export function dashboardBuckets(
  ongoing: MyEventSummary[] | undefined,
  now: number,
): DashboardBuckets {
  const mine = (ongoing ?? []).filter(isPublished);

  const scheduling = mine.filter((e) => e.scheduling);
  const dated = mine
    .filter((e) => !e.scheduling)
    // 終了済みは ongoing に来ない想定だが、境界をまたいだページでは来うる
    .filter((e) => e.endsAt >= now)
    .sort((a, b) => a.startsAt - b.startsAt);

  const live = dated.filter((e) => isLive(e, now));
  const future = dated.filter((e) => !isLive(e, now));

  // 開催中があるときは、そちらが主役。next を別に立てると同じ日の予定が
  // 2か所に出て、どちらを見ればよいか分からなくなる
  const next = live.length > 0 ? null : (future[0] ?? null);
  const upcoming = next ? future.slice(1) : future;

  return { live, next, upcoming, scheduling };
}

/** ホームに出すものが何も無いか（＝オンボーディングを出す） */
export function isDashboardEmpty(b: DashboardBuckets): boolean {
  return (
    b.live.length === 0 &&
    b.next === null &&
    b.upcoming.length === 0 &&
    b.scheduling.length === 0
  );
}
