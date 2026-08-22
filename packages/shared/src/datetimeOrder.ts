/**
 * 開始・終了（epoch ms）の組の順序判定 (#399)。
 *
 * 契約は「終了は開始以降（endsAt >= startsAt）」で、スキーマの refine
 * （サーバーの守り）と画面の入力時警告の両方がこの1つを使う。判定を
 * 画面ごとに書き写さないための置き場所。
 *
 * `requireDuration` は「同時刻（開始＝終了）も不可」にする指定。
 * イベント編集で日程調整をやめて日時を直接確定する保存
 * （PATCH /events/:id に scheduling: false を含める）だけは、サーバー
 * （apps/server/src/routes/events.ts）が endsAt > startsAt を要求するので、
 * その画面はこれを立てて実際に弾かれる条件と揃える。
 */
export function isDatetimeOrderInvalid(
  startsAt: number,
  endsAt: number,
  opts?: { requireDuration?: boolean },
): boolean {
  return opts?.requireDuration ? endsAt <= startsAt : endsAt < startsAt;
}
