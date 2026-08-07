import { usersRepo } from "../db/repositories/users.js";
import { deferBackground } from "../runtime.js";

/** 最終アクセス時刻 (user.last_seen_at) の記録 (#257)。DAU/WAU/MAU・リテンション・
 * 休眠復帰を出すための計測基盤で、集計クエリや画面は別PRで作る。
 *
 * 設計上の要点:
 * - **全リクエストで D1 への書き込みを増やさない**。認証を通るたびに UPDATE すると
 *   サブリクエストが1本増えて課金にもレイテンシにも効くので、**JST の日付が
 *   変わった最初の1回だけ**書く（同一日は何度アクセスしても UPDATE 0回）
 * - 判定に使う現在値は currentUser が既に読んでいる user 行から取るので、
 *   読み取りの追加コストはゼロ
 * - 書き込みは waitUntil に逃がしてレスポンスをブロックしない
 * - 失敗しても認証を壊さない（握りつぶしてログだけ）
 * - 退会申請中 (#250) のユーザーは currentUser が null を返すので、そもそも
 *   ここに到達しない（repo 側の UPDATE にも deleted_at IS NULL を付けてある） */

/** JST の 'YYYY-MM-DD'（detectAbuse.ts の jstDay() / kpi.ts の jd() と同じ基準） */
function jstDay(at: number): string {
  return new Date(at + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 最終アクセス時刻を更新すべきか。JST の日付が変わったときだけ true。
 * last_seen_at が NULL（計測開始前からのユーザーの初回アクセス）も true */
export function shouldTouchLastSeen(
  lastSeenAt: number | null,
  now: number,
): boolean {
  return lastSeenAt === null || jstDay(lastSeenAt) !== jstDay(now);
}

/** このアイソレートで既に書き込んだ `userId:JST日付`。
 *
 * 1リクエストの中で currentUser が複数回呼ばれること（requireAuth ＋ ルート内の
 * 任意認証など）があり、最初の UPDATE は waitUntil の中でまだ走っていないため、
 * DB の値だけを見ると同じリクエストで2回書いてしまう。それを防ぐための印。
 *
 * キーに JST 日付を含むので、古い印が翌日の更新を止めることはない。
 * アイソレートが長生きしても青天井にならないよう上限で捨てる（捨てても
 * DB の値による判定が効くので、余分な UPDATE が1回増えるだけ）。 */
const touchedToday = new Set<string>();
const TOUCHED_MAX = 5000;

/** 最終アクセス時刻を記録する (#257)。currentUser から呼ばれる。
 * @param lastSeenAt 現在DBに入っている値（currentUser が読んだ user 行のもの） */
export async function recordLastSeen(
  userId: string,
  lastSeenAt: number | null,
  now = Date.now(),
): Promise<void> {
  if (!shouldTouchLastSeen(lastSeenAt, now)) return;
  const key = `${userId}:${jstDay(now)}`;
  if (touchedToday.has(key)) return;
  if (touchedToday.size >= TOUCHED_MAX) touchedToday.clear();
  touchedToday.add(key);
  await deferBackground(
    usersRepo.touchLastSeen(userId, now).catch((e: unknown) => {
      // 計測のために認証やレスポンスを壊さない。次のリクエストで再試行できるよう
      // 印は取り消しておく
      touchedToday.delete(key);
      console.warn("last_seen_at の更新に失敗", e);
    }),
  );
}
