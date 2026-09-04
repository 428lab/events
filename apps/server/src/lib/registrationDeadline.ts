/**
 * 募集締切 (#269) の不変条件を **1か所** に置く。
 *
 * ## 守りたいこと
 *
 * 1. 締切は「開催日時が確定している」前提の設定なので、**日程調整中は持てない**。
 *    調整中は開催日が未定で、締切より先に開催日が決まる保証が無い。締切だけ過ぎて
 *    誰も申し込めない状態を作れてしまう。
 * 2. **締切 <= 開始日時**。開始後まで受け付けたいなら「締切なし」を選ぶ、という整理。
 *    開始後の締切を許すと、締切とイベント終了の2つの締めが並んで分かりにくい。
 *
 * ## なぜ関数にするか
 *
 * この不変条件を破れる経路が3本ある（候補日の追加・日程の確定・イベントの更新）。
 * 3本それぞれに判定を書くと必ずずれる。実際に #269 では「候補日の追加は塞いだが
 * 確定側が空いていて、古い候補で finalize すると締切 > 開始日時 を作れる」という
 * 穴が残った。**判定と、その理由の説明を1か所に持つ**。
 *
 * 呼ぶ側は「その操作が通ったあとの状態」を渡す。どの経路も同じ状態を同じ規則で
 * 見ることになるので、経路を足しても穴が空かない。
 */

/** 破っている不変条件。そのままエラーコード（400 のボディ）になる */
export type RegistrationDeadlineViolation =
  | "deadline_requires_fixed_date"
  | "deadline_after_start";

/** 操作後の状態。締切なし（null）は「従来どおりイベント終了まで受け付ける」で常に合法 */
export interface RegistrationDeadlineState {
  /** 操作後の募集締切（epoch ms）。null は締切なし */
  deadline: number | null;
  /** 操作後も日程調整中か */
  scheduling: boolean;
  /** 操作後の開催開始日時（epoch ms） */
  startsAt: number;
}

/** 不変条件を破っていれば違反を、問題なければ null を返す */
export function checkRegistrationDeadline(
  state: RegistrationDeadlineState,
): RegistrationDeadlineViolation | null {
  if (state.deadline === null) return null;
  if (state.scheduling) return "deadline_requires_fixed_date";
  return state.deadline > state.startsAt ? "deadline_after_start" : null;
}
