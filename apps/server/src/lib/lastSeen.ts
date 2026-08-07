import { usersRepo } from "../db/repositories/users.js";
import { deferBackground } from "../runtime.js";

/** アクセスの記録 (#257)。DAU/WAU/MAU・リテンション・休眠復帰を出すための計測基盤で、
 * 集計クエリや画面は別PRで作る。記録先は2つ（migrations/0056 参照）。
 *   - user.last_seen_at … 最終アクセス時刻。「今どれだけ休眠か」を出す
 *   - user_active_day   … その日アクセスした事実。「過去日まで遡った推移」を出す
 *
 * 設計上の要点:
 * - **全リクエストで D1 への書き込みを増やさない**。認証を通るたびに書くと
 *   サブリクエストが増えて課金にもレイテンシにも効くので、**JST の日付が
 *   変わった最初の1回だけ**書く（同一日は何度アクセスしても書き込み0回）。
 *   上の2つは D1 の batch で1回にまとめるので、書き込みは 1ユーザー 1日 1回
 * - 判定に使う現在値は currentUser が既に読んでいる user 行から取るので、
 *   読み取りの追加コストはゼロ
 * - 書き込みは waitUntil に逃がしてレスポンスをブロックしない
 * - 失敗しても認証を壊さない（握りつぶしてログだけ）
 * - 退会申請中 (#250) のユーザーは currentUser が null を返すので、そもそも
 *   ここに到達しない（repo 側の SQL にも deleted_at IS NULL を付けてある） */

/** JST の 'YYYY-MM-DD'（detectAbuse.ts の jstDay() / kpi.ts の jd() と同じ基準）。
 * user_active_day.day もこの基準で入る */
export function jstDay(at: number): string {
  return new Date(at + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** アクセスを記録すべきか。JST の日付が変わったときだけ true。
 * last_seen_at が NULL（計測開始前からのユーザーの初回アクセス）も true */
export function shouldTouchLastSeen(
  lastSeenAt: number | null,
  now: number,
): boolean {
  return lastSeenAt === null || jstDay(lastSeenAt) !== jstDay(now);
}

/** このアイソレートで既に記録した userId → JST日付。
 *
 * 1リクエストの中で currentUser が複数回呼ばれること（requireAuth ＋ ルート内の
 * 任意認証など）があり、最初の書き込みは waitUntil の中でまだ走っていないため、
 * DB の値だけを見ると同じリクエストで2回書いてしまう。それを防ぐための印。
 *
 * 値に JST 日付を持つので、古い印が翌日の記録を止めることはない（日付が違えば
 * 素通りして上書きされる）。1ユーザー1エントリなので古い日の残骸も溜まらない。
 * アイソレートが長生きしても青天井にならないよう上限で捨てる（捨てても
 * DB の値による判定が効くので、余分な書き込みが1回増えるだけ）。 */
const touchedDay = new Map<string, string>();
const TOUCHED_MAX = 5000;

/** アクセスを記録する (#257)。currentUser から呼ばれる。
 * @param lastSeenAt 現在DBに入っている値（currentUser が読んだ user 行のもの） */
export async function recordLastSeen(
  userId: string,
  lastSeenAt: number | null,
  now = Date.now(),
): Promise<void> {
  if (!shouldTouchLastSeen(lastSeenAt, now)) return;
  const day = jstDay(now);
  if (touchedDay.get(userId) === day) return;
  if (touchedDay.size >= TOUCHED_MAX) touchedDay.clear();
  touchedDay.set(userId, day);
  // 記録に失敗したら印も取り消す。残したままだとこのアイソレートが生きている間
  // 再試行されず、そのユーザーのその日の記録が丸ごと落ちる
  const forget = (): void => {
    if (touchedDay.get(userId) === day) touchedDay.delete(userId);
  };
  try {
    await deferBackground(
      usersRepo.touchLastSeen(userId, now, day).catch((e: unknown) => {
        forget();
        console.warn("last_seen_at の更新に失敗", e);
      }),
    );
  } catch (e) {
    // deferBackground 自体が投げた場合（waitUntil が受け付けない ExecutionContext
    // だった等）。上の .catch は touchLastSeen にしか掛かっていないので、ここでも
    // 印を取り消さないと同じ穴が空く
    forget();
    console.warn("last_seen_at のバックグラウンド実行に失敗", e);
  }
}
