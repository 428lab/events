/**
 * QRを読み取った側の画面の文言 (#357)。
 *
 * 2つの名前空間を持つ:
 * - `meet` … 画面の見出し・ボタン・記録できたときの案内
 * - `meetFailure` … 記録できなかった理由コード別の詳しい案内
 *
 * `meetFailure` のキーは `MeetScanFailure`（eventMeets.ts）に web 側だけで
 * 分かる失敗（network / unauthorized / server）を足したもの。**画面の
 * `Failure` と同じ顔ぶれを保つこと**。1つでも欠けると `t()` が型で落ちる。
 *
 * 再試行できるかどうか（Alert の severity）は文言ではないので、ここではなく
 * 画面側の `RETRYABLE` が持つ。
 *
 * `errors.*` にも同じコードの短い文言がある。あちらはどの画面からも引く汎用の
 * 言い方で、こちらはこの画面だけの案内。**必ず詳しくなるとは限らず**、汎用の
 * 言い方で過不足がないものは `errors.*` と同文のままにしてある。
 */
const ja = {
  title: "交流の記録",
  recording: "記録しています…",
  /** common.retry（"もう一度"）とは言い回しが違うので別に持つ */
  retry: "もう一度試す",
  signIn: "ログインする",
  backToTop: "トップへ戻る",
  undone: "記録を取り消しました",
  undoFailed: "取り消しに失敗しました。もう一度お試しください",
  /** 受付が済んだのが自分か相手かで案内を分ける（1つに潰さないこと） */
  attendedMe: "あなたの受付（出席）も一緒に済ませました",
  attendedTarget: "{{name}} さんの受付（出席）も済ませました",
  recorded: "「{{title}}」で出会いを記録しました！お互いにXPが入ります",
  alreadyRecorded: "「{{title}}」では記録済みです",
} as const;

const en: Record<keyof typeof ja, string> = {
  title: "Meet record",
  recording: "Recording…",
  retry: "Try again",
  signIn: "Sign in",
  backToTop: "Back to home",
  undone: "This record has been undone.",
  undoFailed: "Could not undo. Please try again.",
  attendedMe: "You have been checked in at the same time.",
  attendedTarget: "{{name}} has been checked in as well.",
  recorded: "You met at “{{title}}”! You both earn XP.",
  alreadyRecorded: "You have already met at “{{title}}”.",
};

/** 記録できなかった理由。コードは画面の `Failure` と1対1 */
const failureJa = {
  expired:
    "QRの有効期限が切れました。相手の画面のQRをもう一度読み取ってください",
  used: "このQRはすでに読み取り済みです。相手の画面には新しいQRが出ているので、そちらを読み取ってください",
  invalid: "このQRは読み取れませんでした。もう一度読み取ってください",
  self: "自分のQRは読み取れません",
  /** `errors.no_shared_event` と同文。汎用の言い方で過不足がないので、あえて
   * 書き分けていない。キーは画面の `Failure` と1対1でないと型で落ちるので残す */
  no_shared_event: "同じイベントに参加していないため記録できません",
  outside_window:
    "イベントの開催時間帯ではないため記録できません（開始30分前から終了2時間後まで）",
  not_confirmed_me:
    "あなたの参加がまだ確定していないため記録できません。参加を確定してからもう一度お試しください",
  /** `errors.not_confirmed_target` と同文。相手の参加は自分では動かせず、
   * 次にすることを書き足せないので、あえて書き分けていない（キーは残す） */
  not_confirmed_target: "相手の参加がまだ確定していないため記録できません",
  /** 応答が返らなかった（圏外・回線断・時間切れ） */
  network: "通信できませんでした。電波の状態を確かめて、もう一度お試しください",
  /** ログインが切れていた */
  unauthorized: "ログインの有効期限が切れました。ログインし直してください",
  /** サーバー側の一時的な不調 */
  server: "一時的に記録できませんでした。もう一度お試しください",
} as const;

const failureEn: Record<keyof typeof failureJa, string> = {
  expired:
    "This QR code has expired. Please scan the QR code on their screen again.",
  used: "This QR code has already been scanned. A new one is showing on their screen, so please scan that instead.",
  invalid: "This QR code could not be read. Please scan it again.",
  self: "You cannot scan your own QR code.",
  no_shared_event: "You are not in the same event, so this cannot be recorded.",
  outside_window:
    "The event is not running right now, so this cannot be recorded (from 30 minutes before the start until 2 hours after the end).",
  not_confirmed_me:
    "Your registration is not confirmed yet, so this cannot be recorded. Please confirm your registration and try again.",
  not_confirmed_target:
    "Their registration is not confirmed yet, so this cannot be recorded.",
  network: "Could not connect. Please check your signal and try again.",
  unauthorized: "Your session has expired. Please sign in again.",
  server: "This could not be recorded right now. Please try again.",
};

export const meet = { ja, en };
export const meetFailure = { ja: failureJa, en: failureEn };
