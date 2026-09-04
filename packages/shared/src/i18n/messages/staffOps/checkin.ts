/**
 * 運営画面をまたいで使うものと、QR受付・入場QR (#154)。
 *
 * 先頭のひとかたまりは**画面をまたいで引く**もの。ここに足すときは、
 * 本当に2画面以上から引くかを確かめる（1画面だけならその画面のファイルへ）。
 */
const ja = {
  /* ── 運営画面をまたいで使うもの ───────────────────────────── */
  /** 矢印つきの戻り導線（QR受付・アクセス統計）。矢印も言語ごとに持つ */
  backToEvent: "← イベントへ戻る",
  /** 文中に置く戻りリンク（名札の印刷）。矢印は付けない */
  backToEventLink: "イベントへ戻る",
  loadFailed: "読み込めませんでした。",
  /** 準備の段取りと役割と持ち場の両方から、当日のタイムラインへ渡す導線。
   *  同じ文言を画面ごとに持つと片方だけ直る（#466 で1つに寄せた） */
  toTimetable: "当日のタイムラインへ",
  /** 準備の段取りと役割と持ち場で、保存が通らなかったときの案内。
   *  上と同じ理由で1つにしてある */
  saveFailed: "保存できませんでした。",
  /** 受付結果＋アンケートを1枚にした名簿。QR受付とアクセス統計の両方から落とせる。
   *  **マッチングが成立した会場のオーナーも同じ CSV を同じボタンから落とす**ので、
   *  会場側 (`venue.*`) には置かない（英語だけ割れるため #366 で1つに寄せた） */
  attendanceCsv: "入館名簿CSV",
  /** 人数。英語で "1 people" にならないよう単数と複数でキーを分ける
   *  （どちらを使うかは数だけで決まる。日本語はどちらも同じ綴り） */
  personCount: "{{n}} 人",
  peopleCount: "{{n}} 人",

  /* ── QR受付 (#154) ─────────────────────────────────────── */
  checkinStaffOnly: "QR受付はスタッフ専用です。",
  checkinCameraError:
    "カメラを起動できませんでした。ブラウザのサイト設定でカメラの使用を許可して、ページを再読み込みしてください。",
  checkinHint:
    "参加者の「入場QR」またはプロフィールカードのQRを枠内にかざしてください。入場QRは本人確認済みとして自動で出席記録されます。",
  checkinLogHeading: "受付ログ（最新{{n}}件）",
  checkinLogUndone: "取消済み",
  /** 受付ログの1行の見出し。ログには**種別**を積み、表示のたびに訳す
   *  （訳した文字列を積むと、言語を切り替えたときに前の言語のまま残る） */
  checkinLogCheckedIn: "出席（本人確認済み）",
  checkinLogAlready: "出席済み",
  checkinLogNotConfirmed: "確定参加者ではない",
  checkinLogManual: "出席（手動）",
  /** スキャンを止めない軽い通知 */
  checkinWrongEvent: "別のイベントの入場QRです",
  checkinInvalidQr: "無効なQRコードです",
  checkinNotOurQr: "このイベントの受付用QRではありません",
  checkinLookupFailed: "照会に失敗しました",
  checkinUndoFailed: "取り消しに失敗しました",
  /** 手動記録が断られた理由。受付の列で「失敗しました」だけだと案内できない */
  checkinManualNotConfirmed: "参加が確定している人だけ出席にできます",
  checkinManualFailed: "出席の記録に失敗しました",
  /** 読み取り結果のオーバーレイ。背景色は文言ではないので画面側が持つ */
  checkinResultCheckedIn: "出席 記録済み（本人確認済み）",
  checkinResultManualDone: "出席 記録済み（手動）",
  checkinResultAlready: "出席済みです",
  checkinResultNotConfirmed: "このイベントの確定参加者ではありません",
  checkinResultUnknownUser: "登録されていないユーザーです",
  checkinResultExpired:
    "QRの有効期限が切れています。参加者に画面を更新してもらってください",
  checkinManualWarning:
    "本人確認チケットではありません。本人確認のうえ手動で記録してください",
  checkinBackToScan: "スキャンに戻る",
  checkinManualAttend: "手動で出席にする",

  /* ── 入場QR (#154)。見出しは eventDetail.entranceQr ────────── */
  entranceQrError:
    "入場QRを取得できませんでした。参加が確定しているか確認してください。",
  entranceQrAlt: "入場QRコード",
  entranceQrHint: "受付でスタッフに読み取ってもらってください",
  entranceQrRemaining: "QRコードは自動的に更新されます（有効期限 残り {{time}}）",
} as const;

const en: Record<keyof typeof ja, string> = {
  backToEvent: "← Back to the event",
  backToEventLink: "Back to the event",
  loadFailed: "Could not load this.",
  toTimetable: "Go to the timetable",
  saveFailed: "Could not save that.",
  attendanceCsv: "Attendance CSV",
  personCount: "{{n}} person",
  peopleCount: "{{n}} people",

  checkinStaffOnly: "The QR check-in desk is for organizers only.",
  checkinCameraError:
    "Could not start the camera. Allow camera access in your browser's site settings, then reload the page.",
  checkinHint:
    "Hold the participant's entry QR code, or the QR code on their profile card, inside the frame. An entry QR code counts as verified and checks them in automatically.",
  checkinLogHeading: "Check-in log (last {{n}})",
  checkinLogUndone: "Undone",
  checkinLogCheckedIn: "Attended (verified)",
  checkinLogAlready: "Already attended",
  checkinLogNotConfirmed: "Not a confirmed participant",
  checkinLogManual: "Attended (manual)",
  checkinWrongEvent: "This entry QR code belongs to a different event.",
  checkinInvalidQr: "This QR code is not valid.",
  checkinNotOurQr: "This is not a check-in QR code for this event.",
  checkinLookupFailed: "Could not look this person up.",
  checkinUndoFailed: "Could not undo that.",
  checkinManualNotConfirmed:
    "Only confirmed participants can be marked as attended.",
  checkinManualFailed: "Could not record the attendance.",
  checkinResultCheckedIn: "Checked in (verified)",
  checkinResultManualDone: "Checked in (manual)",
  checkinResultAlready: "Already checked in",
  checkinResultNotConfirmed: "Not a confirmed participant of this event",
  checkinResultUnknownUser: "This user is not registered",
  checkinResultExpired:
    "This QR code has expired. Ask them to refresh their screen.",
  checkinManualWarning:
    "This is not a verified entry ticket. Check who they are, then record it by hand.",
  checkinBackToScan: "Back to scanning",
  checkinManualAttend: "Mark as attended",

  entranceQrError:
    "Could not get your entry QR code. Check that your registration is confirmed.",
  entranceQrAlt: "Entry QR code",
  entranceQrHint: "Show this to an organizer at the check-in desk.",
  entranceQrRemaining:
    "This QR code refreshes itself (expires in {{time}})",
};

export const checkin = { ja, en };
