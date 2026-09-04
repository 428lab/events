/**
 * スタッフ（運営）だけが見る操作画面の文言 (#363)。
 *
 * QR受付・抽選・運営スタッフの招待・一斉連絡・名札の印刷・アクセス統計。
 * 参加者にも見える文言は `eventDetail.ts` / `common.ts` が持つので、
 * 同じ文言をここに増やさない。
 *
 * 5つの名前空間を持つ:
 * - `staffOps` … 画面の見出し・ボタン・案内（下の画面ごとのファイルを繋いだもの）
 * - `staffInviteError` … 招待が断られた理由コード別の案内（`invites.ts`）
 * - `staffInviteStatus` … 招待の状態（`STAFF_INVITE_STATUS_LABELS`。`invites.ts`）
 * - `broadcastSegment` / `broadcastSegmentNote` … 一斉連絡の送信先区分
 *   （`broadcast.ts`）
 *
 * 後ろの3つは**日本語をここに書き写さない**。もとの定数をそのまま `ja` に据えて、
 * 英語だけを足す（`labels.ts` と同じやり方。2か所に増やすと必ず片方が古くなる）。
 *
 * **なぜ画面ごとに分けてあるか (#466)。** もとは1枚のファイルで、日本語の側だけに
 * 画面の区切りコメントが15本並び、英語の側には1本も無かった。同じキーの日本語と
 * 英語が400行以上離れていたので、片方だけ直した崩れが目で見つからない。画面ごとの
 * ファイルにして**日本語と英語を隣に置く**と、区切りは自然にファイル名になり、
 * 型（`Record<keyof typeof ja, string>`）もファイルごとに噛み合う。
 *
 * 足すときは、その画面のファイルに日本語と英語を**並べて**書く。画面をまたいで
 * 引くものだけ `checkin.ts` の先頭のかたまりに置く（`loadFailed` / `toTimetable` /
 * `saveFailed` など）。
 */
// 数の入れ替えは {{n}} を使う。i18next の `count` は複数形の仕組みを
// 起動してしまい、`_other` を用意していないキーで挙動が読みにくくなるため。
import { broadcast } from "./broadcast.js";
import { checkin } from "./checkin.js";
import { invites } from "./invites.js";
import { nameCards } from "./nameCards.js";
import { prep } from "./prep.js";
import { prizes } from "./prizes.js";
import { slots } from "./slots.js";
import { survey } from "./survey.js";

export { broadcastSegment, broadcastSegmentNote } from "./broadcast.js";
export { staffInviteError, staffInviteStatus } from "./invites.js";

/**
 * 画面ごとの断片を1つの名前空間に繋ぐ。**並びは分ける前と同じ**にしてある
 * （辞書を丸ごと書き出して比べられるように）。
 *
 * 重なったキーは後ろが黙って勝つので、`staffOpsParts.test.ts` が
 * 「繋いだキー数 = 断片のキー数の合計」を見張っている。
 */
export const staffOps = {
  ja: {
    ...checkin.ja,
    ...slots.ja,
    ...invites.ja,
    ...broadcast.ja,
    ...nameCards.ja,
    ...prizes.ja,
    ...survey.ja,
    ...prep.ja,
  },
  en: {
    ...checkin.en,
    ...slots.en,
    ...invites.en,
    ...broadcast.en,
    ...nameCards.en,
    ...prizes.en,
    ...survey.en,
    ...prep.en,
  },
};

/** 崩れの検査（`staffOpsParts.test.ts`）が数えるための並び */
export const staffOpsParts = [
  checkin,
  slots,
  invites,
  broadcast,
  nameCards,
  prizes,
  survey,
  prep,
];
