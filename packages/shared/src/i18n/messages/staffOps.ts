/**
 * スタッフ（運営）だけが見る操作画面の文言 (#363)。
 *
 * QR受付・抽選・運営スタッフの招待・一斉連絡・名札の印刷・アクセス統計。
 * 参加者にも見える文言は `eventDetail.ts` / `common.ts` が持つので、
 * 同じ文言をここに増やさない。
 *
 * 5つの名前空間を持つ:
 * - `staffOps` … 画面の見出し・ボタン・案内
 * - `staffInviteError` … 招待が断られた理由コード別の案内
 * - `staffInviteStatus` … 招待の状態（`STAFF_INVITE_STATUS_LABELS`）
 * - `broadcastSegment` / `broadcastSegmentNote` … 一斉連絡の送信先区分
 *
 * 後ろの3つは**日本語をここに書き写さない**。もとの定数をそのまま `ja` に据えて、
 * 英語だけを足す（`labels.ts` と同じやり方。2か所に増やすと必ず片方が古くなる）。
 */
// 数の入れ替えは {{n}} を使う。i18next の `count` は複数形の仕組みを
// 起動してしまい、`_other` を用意していないキーで挙動が読みにくくなるため。
import {
  BROADCAST_OVERLAP_NOTE,
  BROADCAST_SEGMENT_LABELS,
  BROADCAST_SEGMENT_NOTES,
  type BroadcastSegment,
} from "../../eventBroadcast.js";
import {
  STAFF_INVITE_STATUS_LABELS,
  type StaffInviteStatus,
} from "../../staffInvites.js";

const ja = {
  /* ── 運営画面をまたいで使うもの ───────────────────────────── */
  /** 矢印つきの戻り導線（QR受付・アクセス統計）。矢印も言語ごとに持つ */
  backToEvent: "← イベントへ戻る",
  /** 文中に置く戻りリンク（名札の印刷）。矢印は付けない */
  backToEventLink: "イベントへ戻る",
  loadFailed: "読み込めませんでした。",
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

  /* ── 申込者の管理 (#286) ───────────────────────────────── */
  slotAdminStaffOnly: "申込者の管理はスタッフ専用です。",
  slotAdminTitle: "申込者の管理",
  slotAdminIntro:
    "参加枠ごとの申込者です。参加確定・キャンセル待ち・落選をここで切り替えられます。当日キャンセルが出たときにキャンセル待ちの人を確定にするのもこの画面です。",
  slotNone: "参加枠がありません。",
  slotOverCapacity: "定員超過",
  /** 枠の要約。区切りは common.dotSeparator で画面側がつなぐ */
  slotConfirmedOfCapacity: "確定 {{n}} / 定員 {{capacity}}",
  slotWonOfCapacity: "当選 {{n}} / 定員 {{capacity}}",
  slotApplicantCount: "申込 {{n}} 人",
  slotApplicantsCount: "申込 {{n}} 人",
  slotWaitlistCount: "キャンセル待ち {{n}} 人",
  slotDrawAt: "抽選日時 {{date}}",
  slotDraw: "自動抽選（申込中 {{applied}} → 定員 {{capacity}}）",
  slotNoApplicants: "まだ申込者がいません。",
  /** 同じ confirmed でも、抽選枠なら「当選」、先着枠なら「参加確定」と読むほうが
   *  自然なので枠の方式で言い分ける。「キャンセル待ち」「落選」は
   *  eventDetail.statusWaitlist / statusLost と同じ文言なのでここには持たない */
  statusWon: "当選",
  statusFirstComeConfirmed: "参加確定",
  statusApplying: "申込中",
  slotOverCapacityConfirm:
    "{{slot}}は定員 {{capacity}} 人に対して既に {{confirmed}} 人が確定しています。{{name}} さんを確定にすると定員を超えます。よろしいですか？",
  slotStatusChangeFailed:
    "{{name}} さんの参加状態を変更できませんでした。画面を開いたまま状態が変わった可能性があります",

  /* ── 自分宛の運営への招待 (#339) ────────────────────────── */
  myInvitesTitle: "運営への招待",
  myInvitesIntro:
    "承諾すると、そのイベントの運営として準備や当日の操作ができるようになります。断ることもできます。",
  myInvitesEmpty: "返事待ちの招待はありません。",
  invitePreRelease: "公開前",
  inviteScheduleTbd: "開催日時は調整中",
  inviteFrom: "{{name}} さんからの招待",
  inviteDraftNotice:
    "このイベントはまだ公開されていません。承諾すると内容を見て、準備を一緒に進められます。",
  inviteSlotWarning:
    "いま申し込んでいる参加枠は外れます。運営は参加枠を使わずに参加するためで、あとから運営を降りても申し込みは戻りません（先着枠は他の人が繰り上がります）。",
  inviteSlotNote:
    "すでに参加を申し込んでいる場合、参加枠は外れて運営として参加します。",
  inviteAccept: "承諾して運営になる",
  inviteDecline: "断る",
  inviteDeclineConfirm: "「{{title}}」の運営への招待を断りますか？",

  /* ── イベント側の招待カード (#339) ─────────────────────── */
  inviteStaffTitle: "運営に招く",
  inviteStaffIntro:
    "指名して招待します。相手が承諾すると運営になり、公開前でも一緒に準備できます。承諾するまでは運営ではありません。",
  inviteStaffField: "名前かユーザー名で招待",
  inviteStaffPlaceholder: "例: example_user",
  inviteStaffSend: "招待",
  inviteStaffEmpty: "招待はまだありません。",
  inviteStaffBy: "招待: {{name}}",
  /** 送った招待を取り下げる操作。状態の「取り消し」(staffInviteStatus.revoked)
   *  とは別物（あちらは済んだ状態、こちらはこれから押すボタン） */
  inviteStaffRevoke: "取り消し",
  inviteStaffRemoveRow: "一覧から消す",
  /** 入力候補の見出し。候補の出どころは英字のキーで持ち、表示のたびに訳す */
  inviteCandidateMembers: "このイベントの参加者",
  inviteCandidateFollowing: "フォロー中",
  /** 理由コードが表に無いときの受け皿。コード別の文言は staffInviteError */
  inviteErrorDefault: "処理できませんでした。時間をおいて試してください。",

  /* ── 一斉連絡 (#172)。見出しは eventDetail.broadcast ────────── */
  broadcastStaffOnly: "一斉連絡はスタッフ専用です。",
  broadcastIntro:
    "送信先の区分を選んでお知らせを送ります。アプリ内のお知らせはすぐに届きます。メールは順番に送るため、送りきるまで1時間あたり{{perHour}}通ほどのペースになります（100人なら{{eta100}}、300人なら{{eta300}}）。他のイベントの一斉連絡と同時に送信待ちがあるときは、順番を分け合うためさらに時間がかかることがあります。急ぎの連絡はアプリ内のお知らせが先に届きます。",
  broadcastSegmentField: "送信先",
  broadcastSegmentOption: "{{label}}（{{n}} 人）",
  broadcastCountNote:
    "人数は実際に届く人数です。送ったものはこのページの履歴で読めるので、自分あてには届きません。",
  broadcastTitleHelp: "お知らせの見出しになります",
  broadcastBodyField: "本文",
  broadcastBodyHelp: "送信後は取り消せません",
  broadcastNoUndoWarning:
    "送信後は取り消せません。届いたお知らせやメールを消すことはできません。",
  broadcastConfirmOpen: "送信内容を確認",
  broadcastRemaining:
    "今日はあと {{today}} 回 ／ このイベントで通算あと {{total}} 回 送れます",
  /** 上限に達したときの案内。24時間の上限は「送る前の注意」と「断られた理由」で
   *  同じ文なので1つのキーを両方から引く */
  broadcastLimitTotalNotice:
    "このイベントで送れる回数（通算）を使い切りました。時間をおいても増えません。",
  broadcastLimitDayNotice:
    "24時間あたりの送信回数の上限に達しました。いちばん古い送信から24時間が過ぎると、また送れるようになります。",
  broadcastLimitTotalError:
    "このイベントで送れる回数を使い切りました。時間をおいても増えません。どうしても必要な場合は運営にお問い合わせください。",
  broadcastSendFailed: "送信できませんでした。時間をおいて試してください。",
  broadcastRetryFailed: "送り直せませんでした。時間をおいて試してください。",
  /** 送信履歴 */
  broadcastHistoryTitle: "送信履歴",
  broadcastHistoryNote: "この一覧はスタッフだけが見られます。",
  broadcastHistoryEmpty: "まだ送信していません。",
  broadcastIncompleteChip: "一部のみ送信",
  broadcastSentToOne: "{{n}} 人へ",
  broadcastSentTo: "{{n}} 人へ",
  broadcastIncompleteNotice:
    "途中で失敗したため、この人数までにしかお知らせが届いていません。同じ内容をもう一度送ると、すでに届いている人には2通届きます。",
  /** メールの送信状況 */
  broadcastEmailNone: "メールの宛先はありません（アプリ内のお知らせのみ）",
  broadcastEmailPending: "送信待ち {{n}}",
  broadcastEmailSent: "送信済み {{n}}",
  broadcastEmailFailed: "失敗 {{n}}",
  broadcastEmailSkipped: "対象外 {{n}}",
  broadcastRetryOne: "失敗した {{n}} 件を送り直す",
  broadcastRetry: "失敗した {{n}} 件を送り直す",
  broadcastRetryNote:
    "送り直しても、すでに届いた人にもう1通増えることはありません。送信回数も消費しません。",
  /** 送信前の確認 */
  broadcastConfirmTitle: "この内容で送信します",
  broadcastConfirmWarning:
    "送信後は取り消せません。送る相手と人数を確かめてください。",
  broadcastConfirmEmpty:
    "いまこの区分に当てはまる人はいません。送信しても誰にも届きません。",
  broadcastConfirmCancel: "やめる",
  broadcastSendOne: "{{n}} 人に送信する",
  broadcastSend: "{{n}} 人に送信する",
  /** 送信できたときの報告。画面側が順につないで1文にする */
  broadcastSentOne: "{{n}} 人にお知らせを送りました。",
  broadcastSent: "{{n}} 人にお知らせを送りました。",
  broadcastSentEmailOne:
    "そのうちメールを受け取る設定の {{n}} 人には、順にメールも届きます（送りきるまで{{eta}}ほどかかります）。",
  broadcastSentEmail:
    "そのうちメールを受け取る設定の {{n}} 人には、順にメールも届きます（送りきるまで{{eta}}ほどかかります）。",
  broadcastSentNoEmail: "メールの宛先はありませんでした。",
  broadcastTruncated:
    "なお、区分に当てはまる {{total}} 人のうち {{n}} 人までで打ち切りました。残りの人には届いていません。",
  broadcastPartial:
    "途中で失敗したため、{{n}} 人までにしかお知らせが届いていません。同じ内容をもう一度送ると、すでに届いている人には2通届きます。下の送信履歴で届いた人数を確かめてから、必要な場合だけ送り直してください。",
  /** 区分どうしが重なることの注意。日本語はもとの定数が source */
  segmentOverlapNote: BROADCAST_OVERLAP_NOTE,
  /** メールを送りきるまでの見積もり。単位は略記にしてあるので単数・複数を分けない
   *  （common.remainingHours と同じ書き方） */
  etaMinutes: "約{{n}}分",
  etaHours: "約{{n}}時間",
  etaHoursMinutes: "約{{h}}時間{{m}}分",

  /* ── 名札の印刷 (#304)。見出しは eventDetail.nameCards ──────── */
  nameCardStaffOnly: "この画面はイベントのスタッフだけが使えます。",
  nameCardLoadFailed: "名札の情報を取得できませんでした。",
  nameCardIntro:
    "A4に10面（91×55mm）で並べます。市販の名刺用紙や名札ケースに合う大きさです",
  nameCardNoMembers: "参加が確定しているメンバーがまだいません。",
  nameCardCountOneSheet: "{{selected}} 人 / {{all}} 人（A4 {{sheets}} 枚）",
  nameCardCount: "{{selected}} 人 / {{all}} 人（A4 {{sheets}} 枚）",
  nameCardSelectAll: "すべて選ぶ",
  nameCardClearAll: "すべて外す",
  nameCardPrint: "印刷する",
  nameCardBuilding: "カードを作成しています（{{done}} / {{total}}）",
  nameCardPeopleHeading: "印刷する人",
  nameCardPrintCheckbox: "{{name}} を印刷する",
  nameCardPreviewHeading: "刷り上がりのプレビュー",
  nameCardPreviewNote:
    "背景の色を出すには、印刷ダイアログで「背景のグラフィック」を有効にしてください",

  /* ── アクセス統計 (#152 / #154)。見出しは eventDetail.stats ──── */
  statsStaffOnly: "アクセス統計はスタッフ専用です。",
  statsLoadFailed: "統計を取得できませんでした。",
  statsRange7: "7日",
  statsRange30: "30日",
  statsRangeAll: "全期間",
  statsViews: "表示回数 (PV)",
  statsUniques: "ユニークビジター",
  statsJoins: "参加登録数",
  statsEmpty:
    "まだアクセスがありません。公開してシェアすると、ここに流入元や推移が表示されます。",
  statsSources: "流入元",
  statsCountries: "国・地域",
  statsDaily: "日別の推移",
  statsLegendJoins: "参加登録",
  statsDayTooltip:
    "{{day}}  PV:{{views}} / ユニーク:{{uniques}} / 参加:{{joins}}",
  statsNoData: "データなし",
  /** 流入元のうち、サイトが自分で付ける印。外部サイトの名前（X・Facebook 等）は
   *  どの言語でも同じ綴りなので画面側の表に残してある */
  sourceDirect: "直接アクセス",
  sourceInternal: "サイト内",
  sourceNotification: "通知",
  sourceFeed: "フィード",
  sourceEmail: "メール",
  sourceCard: "カード",
  /** 事前アンケートの回答一覧 */
  surveyTitle: "アンケート回答",
  surveyRemind: "未回答者にお願い通知",
  surveyRemindConfirm:
    "未回答の確定参加者に「アンケート回答のお願い」通知を送りますか？",
  surveyRemindedOne: "{{n}} 人に通知しました",
  surveyReminded: "{{n}} 人に通知しました",
  surveyRemindFailed: "送信に失敗しました",
  surveyCsv: "CSVダウンロード",
  surveyNote: "参加登録時のアンケート回答です（スタッフのみ閲覧できます）。",
  surveyEmpty: "まだ回答がありません。",
  surveyStatusColumn: "参加状態",
  /** 参加状態の残り1つ。確定・キャンセル待ち・抽選申込中・落選は
   *  eventDetail.status* と同じ文言なのでそちらを引く */
  surveyStatusCanceled: "キャンセル",
  surveyNotJoined: "未参加",
  /** 出会い数ランキング */
  meetRankingTitle: "出会いランキング",
  meetRankingNote:
    "「出会った！」の記録数です。参加者向けランキングの設定に依らず、スタッフはここで全順位を名前入りで見られます。景品の参考にどうぞ。",

  /* ── 出会いの景品の引き換えデスク (#431) ──────────────────
   * 実装の語を出さない。「交換済みにする」「1位を確定する」のように操作で書く */
  prizeDeskTitle: "景品の引き換え",
  prizeDeskStaffOnly: "景品の引き換えはスタッフ専用です。",
  prizeDeskLead:
    "参加者の達成画面と名前を突き合わせて、景品を渡したら「交換済みにする」を押してください。在庫は引き換えた順の早い者勝ちです。",
  prizeDeskEmpty: "景品がまだ登録されていません。イベント編集から追加できます。",
  prizeDeskStock: "在庫 残り{{left}}（全{{total}}）",
  prizeDeskAchieversCount: "達成 {{n}}人",
  prizeDeskNoAchievers: "まだ達成した人はいません。",
  prizeDeskSearch: "名前で絞り込み",
  prizeDeskRedeem: "交換済みにする",
  prizeDeskUnredeem: "交換を取り消す",
  prizeDeskUnredeemConfirm: "この交換の記録を取り消しますか？（在庫が1つ戻ります）",
  prizeDeskWinnersTitle: "ランキング1位",
  prizeDeskWinnersUndecided: "1位はまだ確定していません。",
  prizeDeskCloseWinners: "1位を確定する",
  prizeDeskRecloseWinners: "1位を締め直す",
  prizeDeskCloseConfirm:
    "いま締めると、この時点で最も多く出会った人（同数なら全員）が1位として確定します。締めた後の出会いは1位に影響しません。",
  prizeDeskClearWinners: "確定を取り消す",
  prizeDeskClearConfirm: "1位の確定を取り消して未確定に戻しますか？",
  prizeDeskNoMeets: "まだ誰も出会いを記録していないため、1位を確定できません。",
  /** 引き換えが断られた理由。窓口でその人に何を案内するかが分かる文言にする */
  prizeRedeemAlready: "この景品は交換済みです。",
  prizeRedeemOutOfStock: "在庫がありません。",
  prizeRedeemNotAchieved: "条件を満たしていません。",
  prizeRedeemNotConfirmed: "参加が確定していないため引き換えできません。",
  prizeRedeemFailed: "引き換えに失敗しました。",

  /* ── 数字ビンゴの抽選コントロール (#436) ────────────────── */
  bingoControlTitle: "ビンゴ抽選",
  bingoControlStaffOnly: "ビンゴの操作はスタッフ専用です。",
  bingoCreate: "ビンゴを準備する",
  bingoCreateNote: "準備すると参加者がカードを受け取れるようになります。",
  bingoStart: "抽選を開始する",
  bingoStartConfirm: "抽選を開始しますか？（開始後もカードは受け取れます）",
  bingoDraw: "次を引く",
  bingoUndoDraw: "直前の1個を取り消す",
  bingoUndoConfirm: "直前に引いた番号を取り消しますか？",
  bingoUndoHelp: "取り消した番号は、次を引くと同じ番号がもう一度出ます。",
  bingoEnd: "この回を終了する（結果を確定）",
  bingoEndConfirm:
    "抽選を締めて、この回の結果（順位）を確定・保存します。景品の引き換えは続けられます。終了後にリセットすれば2回戦ができます。",
  bingoReset: "リセット（カード再配布）",
  bingoResetConfirm:
    "リセットしますか？全員のカードが無効になり、達成も消えます。引き換え済みの景品はそのまま残ります。",
  bingoDelete: "ビンゴを削除する",
  bingoDeleteConfirm:
    "ビンゴのゲームを削除しますか？参加者からビンゴが見えなくなり、カードと抽選の記録も消えます（終了済みの回の成績は残ります）。",
  bingoExhausted: "すべての番号を引き切りました。",
  bingoOpFailed: "操作に失敗しました。",
  bingoAchieversTitle: "リーチ・ビンゴの一覧（読み上げ用）",
  bingoRankN: "ビンゴ {{rank}}番目",
  bingoNoRows: "カードを受け取った人はまだいません。",
  /* ── ビンゴ景品プール（デスク #436） ── */
  prizeDeskBingoTitle: "ビンゴ景品（選び取り）",
  prizeDeskBingoNote:
    "達成した順に、在庫が残っている景品から1つ選んでもらいます。同着の順番決めは現場で。",
  prizeDeskBingoNone: "ビンゴ達成者はまだいません。",
  prizeDeskBingoChoose: "この景品と交換",
  /* ── 引き換え履歴 (#441) ── */
  prizeLogTitle: "引き換え履歴",
  prizeLogEmpty: "まだ引き換えはありません。",
  prizeLogBy: "対応: {{name}}",

  /* ── 準備の段取り (#393) ────────────────────────────────
   * **実装上の語を出さない。**「待ち」「担当者が外れています」のように
   * 振る舞いで書く（`assigneeState` / `dep` / `blocked` は利用者の語彙ではない） */
  todoTitle: "準備TODO",
  todoStaffOnly: "準備TODOはスタッフ専用です。",
  /** 当日の段取り (#383) との線引き。TODO 側とタイムライン側の両方に出す */
  todoScopeNote:
    "日付だけで決める当日より前の仕事はここに。時刻があり当日の段取りになるものはタイムラインへ。",
  todoToTimetable: "当日のタイムラインへ",
  todoFromTimetable: "準備TODOへ",
  todoEmpty: "まだ登録がありません。",
  todoFilterNone: "この条件に合う仕事はありません。",
  /** 進み具合。百分率は持たず、この4つの数で見せる */
  todoCountOpen: "未完了 {{n}}",
  todoCountOverdue: "遅れ {{n}}",
  todoCountBlocked: "待ち {{n}}",
  todoCountDone: "完了 {{n}}",
  /** 絞り込みのチップ。集計チップ（「遅れ 3」）や行の印（「遅れ」）と
   * **同じ綴りにしない**。同じ画面に同じ言葉のものが3つ並ぶと、
   * どれを押すと何が起きるのかが読めない */
  todoFilterMine: "自分の担当",
  todoFilterUnassigned: "未割り当てのみ",
  todoFilterLeft: "担当者が外れた",
  todoFilterOverdue: "遅れだけ",
  todoFilterShowDone: "完了を含める",
  todoUnassigned: "未割り当て",
  /** 担当を外れた人の名前は**出さない**（退会が混ざるため） */
  todoAssigneeLeft: "担当者が外れています（要再割り当て）",
  todoBlockedChip: "待ち",
  todoOverdueChip: "遅れ",
  todoCycleChip: "先の仕事が輪になっています",
  todoNoDates: "日付未定",
  todoDependsOnChip: "⟵ {{title}}",
  todoDeleteConfirm: "「{{title}}」を削除しますか？",
  todoFieldTitle: "やること",
  todoFieldNote: "補足",
  todoFieldStartsOn: "開始日",
  todoFieldDueOn: "期限",
  todoFieldAssignee: "担当",
  todoDepsField: "先に終わらせる仕事",
  todoDepsHelp: "ここで選んだ仕事が終わるまで、この仕事は待ちになります。",
  todoGanttTitle: "日程",
  todoGanttEmpty: "開始日か期限を入れると、ここに帯が出ます。",
  todoGanttOutside: "この期間の外にある仕事が {{n}} 件あります（一覧には出ます）。",
  /** 全項目が窓より長いときのフォールバック。帯を窓の端で切ったことの注記 */
  todoGanttClipped: "予定が長すぎて描ききれない仕事が {{n}} 件あります（帯は途中まで）。",
  todoGanttToday: "今日",
  todoGanttSelectHint: "行を選ぶと、つながる仕事との線が出ます。",
  /** 目盛りの月。細い列のときは月だけを書く */
  todoGanttMonth: "{{n}}月",
  todoSaveFailed: "保存できませんでした。",
  todoLimitError: "このイベントに登録できる数の上限に達しています。",
  todoDepLimitError: "先に終わらせる仕事を、これ以上は選べません。",
  todoDepCycleError: "その組み合わせは、お互いを待ち合う輪になってしまいます。",
  todoAssigneeNotStaffError:
    "担当にできるのは、このイベントのスタッフとして参加が確定している人だけです。",
  todoBadRangeError: "開始日が期限より後になっています。",

  /* ── スタッフチャット (#382) ─────────────────────────────
   * **実装技術名（Nostr・暗号方式・リレー等）は出さない。** 振る舞い
   * （スタッフだけが読める・運営サービスには見える）だけを伝える */
  staffChatTitle: "スタッフチャット",
  staffChatStaffOnly: "スタッフチャットはこのイベントのスタッフ専用です。",
  staffChatNotice:
    "このチャットはスタッフだけが読めます。内容は暗号化されて外部サーバーに保存されます（運営サービスには内容が見えます）。",
  staffChatOpenFailed:
    "チャットを開けませんでした。ページを再読み込みしてもう一度お試しください。",

  /* ── 役割と持ち場 (#384) ────────────────────────────────
   * **実装上の語を出さない。** duty / slot / assignee は利用者の語彙ではないので
   * 「役割」「持ち場」「担当」で書く。タグ本体（「受付 1/2」）は名前と数字の
   * 組み立てなので辞書には持たない */
  dutyTitle: "役割と持ち場",
  dutyStaffOnly: "役割と持ち場はスタッフ専用です。",
  dutyPageNote:
    "時間帯ごとに「どの役割が何人要るか」を先に置き、あとから人を割り当てます。人数が先にあるので、埋まっていない持ち場が分かります。",
  dutyToTimetable: "当日のタイムラインへ",
  dutyDefsTitle: "役割",
  dutyDefsNote:
    "このイベントで使う役割（受付・司会・配信など）。イベントを複製すると名前ごとコピーされます。",
  dutyAddPlaceholder: "役割の名前（例: 受付）",
  dutyAddButton: "追加",
  dutyRenameTitle: "役割の名前を変える",
  /** 使っている持ち場ごと消えることを、消す前に必ず伝える */
  dutyDeleteConfirm:
    "「{{name}}」を削除しますか？ {{n}} か所の持ち場と、その割り当ても消えます。",
  dutyDeleteConfirmUnused: "「{{name}}」を削除しますか？",
  dutyUnfilledCount: "埋まっていない持ち場 {{n}}",
  dutyAllFilled: "すべての持ち場が埋まっています。",
  /** 絞り込みのチップ。集計チップ（上）と同じ綴りにしない（todoFilter と同じ理由） */
  dutyFilterShort: "不足のみ",
  dutyFilterMine: "自分の持ち場",
  dutyFilterNone: "この条件に合う時間帯はありません。",
  dutyNoItems:
    "タイムテーブルに時間帯がありません。先にタイムテーブルを作ってください。",
  dutyNoDuties: "まず役割を作ってください。",
  dutyNoSlots: "持ち場なし",
  dutyNoTime: "時刻未定",
  dutyEditSlots: "持ち場を編集",
  dutySlotsDialogTitle: "持ち場と割り当て",
  dutySlotAdd: "持ち場を足す",
  dutyRequiredLabel: "必要人数",
  dutySlotRemove: "外す",
  dutySlotRemoveConfirm:
    "「{{name}}」の持ち場を外しますか？ 割り当ても消えます。",
  dutyAssignLabel: "割り当てる人",
  dutyAssignButton: "割り当てる",
  /** 外れた担当の名前は**出さない**（退会が混ざるため。#393 と同じ規則） */
  dutyAssigneeLeft: "外れた割り当てがあります。外して再割り当てしてください。",
  dutyAssigneeLeftShort: "外れた担当",
  dutySaveFailed: "保存できませんでした。",
  dutyLimitError: "このイベントに作れる役割の数の上限に達しています。",
  dutyNameTakenError: "同じ名前の役割がすでにあります。",
  dutySlotLimitError: "この時間帯に置ける持ち場の数の上限に達しています。",
  dutyRequiredRangeError: "必要人数の指定が正しくありません。",
  dutyAssigneeNotStaffError:
    "割り当てられるのは、このイベントのスタッフとして参加が確定している人だけです。",
  dutyAssigneeLimitError: "この持ち場に割り当てられる人数の上限に達しています。",
  dutyAssigneeDupError: "その人はすでにこの持ち場に割り当てられています。",
} as const;

const en: Record<keyof typeof ja, string> = {
  backToEvent: "← Back to the event",
  backToEventLink: "Back to the event",
  loadFailed: "Could not load this.",
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

  slotAdminStaffOnly: "Managing applicants is for organizers only.",
  slotAdminTitle: "Applicants",
  slotAdminIntro:
    "These are the applicants for each participation slot. You can confirm people, move them to the waiting list, or mark them as not selected. This is also where you promote someone from the waiting list when a seat opens up on the day.",
  slotNone: "This event has no participation slots.",
  slotOverCapacity: "Over capacity",
  slotConfirmedOfCapacity: "Confirmed {{n}} / {{capacity}}",
  slotWonOfCapacity: "Selected {{n}} / {{capacity}}",
  slotApplicantCount: "{{n}} applicant",
  slotApplicantsCount: "{{n}} applicants",
  slotWaitlistCount: "{{n}} waitlisted",
  slotDrawAt: "Draw at {{date}}",
  slotDraw: "Run the lottery ({{applied}} applied → {{capacity}} seats)",
  slotNoApplicants: "No applicants yet.",
  statusWon: "Selected",
  statusFirstComeConfirmed: "Confirmed",
  statusApplying: "Applied",
  slotOverCapacityConfirm:
    "{{slot}} has {{capacity}} seats and {{confirmed}} people are already confirmed. Confirming {{name}} will go over capacity. Continue?",
  slotStatusChangeFailed:
    "Could not change the status for {{name}}. It may have changed while this page was open.",

  myInvitesTitle: "Organizer invitations",
  myInvitesIntro:
    "Once you accept, you can help prepare the event and run it on the day. You can also decline.",
  myInvitesEmpty: "You have no invitations waiting for a reply.",
  invitePreRelease: "Not published",
  inviteScheduleTbd: "The date is still being decided",
  inviteFrom: "Invitation from {{name}}",
  inviteDraftNotice:
    "This event is not published yet. Accepting lets you see it and help get it ready.",
  inviteSlotWarning:
    "You will lose the participation slot you signed up for. Organizers take part without using a slot, and stepping down later does not bring your sign-up back (on first-come slots, someone else moves up right away).",
  inviteSlotNote:
    "If you have already signed up, your slot is released and you take part as an organizer.",
  inviteAccept: "Accept and become an organizer",
  inviteDecline: "Decline",
  inviteDeclineConfirm: "Decline the invitation to help organize “{{title}}”?",

  inviteStaffTitle: "Invite organizers",
  inviteStaffIntro:
    "Invite someone by name. They become an organizer once they accept, and can then help you prepare even before the event is published. Until they accept, they are not an organizer.",
  inviteStaffField: "Invite by name or username",
  inviteStaffPlaceholder: "e.g. example_user",
  inviteStaffSend: "Invite",
  inviteStaffEmpty: "No invitations yet.",
  inviteStaffBy: "Invited by {{name}}",
  inviteStaffRevoke: "Revoke",
  inviteStaffRemoveRow: "Remove from the list",
  inviteCandidateMembers: "Taking part in this event",
  inviteCandidateFollowing: "People you follow",
  inviteErrorDefault: "Something went wrong. Please try again later.",

  broadcastStaffOnly: "Announcements are for organizers only.",
  broadcastIntro:
    "Choose who to reach and send them an announcement. In-app notifications arrive right away. Emails go out in batches at roughly {{perHour}} per hour, so a full run takes {{eta100}} for 100 people and {{eta300}} for 300. When other events have announcements queued at the same time, the queue is shared and it can take longer. For anything urgent, the in-app notification gets there first.",
  broadcastSegmentField: "Recipients",
  broadcastSegmentOption: "{{label}} ({{n}})",
  broadcastCountNote:
    "The number shown is how many people will actually receive it. You can read what you sent in the history on this page, so it is not sent to you.",
  broadcastTitleHelp: "This becomes the headline of the announcement.",
  broadcastBodyField: "Message",
  broadcastBodyHelp: "You cannot take this back once it is sent.",
  broadcastNoUndoWarning:
    "You cannot take this back once it is sent. Notifications and emails that have arrived cannot be deleted.",
  broadcastConfirmOpen: "Review before sending",
  broadcastRemaining:
    "{{today}} more today / {{total}} more in total for this event",
  broadcastLimitTotalNotice:
    "You have used up every announcement for this event. Waiting does not give you more.",
  broadcastLimitDayNotice:
    "You have reached the limit for the last 24 hours. You can send again once 24 hours have passed since your oldest announcement.",
  broadcastLimitTotalError:
    "You have used up every announcement for this event. Waiting does not give you more. If you really need another one, please contact support.",
  broadcastSendFailed: "Could not send this. Please try again later.",
  broadcastRetryFailed: "Could not resend these. Please try again later.",
  broadcastHistoryTitle: "Sent announcements",
  broadcastHistoryNote: "Only organizers can see this list.",
  broadcastHistoryEmpty: "You have not sent anything yet.",
  broadcastIncompleteChip: "Partly sent",
  broadcastSentToOne: "to {{n}} person",
  broadcastSentTo: "to {{n}} people",
  broadcastIncompleteNotice:
    "Sending failed part way through, so only this many people received it. If you send the same thing again, everyone who already got it will receive a second copy.",
  broadcastEmailNone: "No email recipients (in-app notifications only)",
  broadcastEmailPending: "Queued {{n}}",
  broadcastEmailSent: "Sent {{n}}",
  broadcastEmailFailed: "Failed {{n}}",
  broadcastEmailSkipped: "Skipped {{n}}",
  broadcastRetryOne: "Resend {{n}} failed email",
  broadcastRetry: "Resend {{n}} failed emails",
  broadcastRetryNote:
    "Resending never gives a second copy to anyone who already received it, and it does not use up another announcement.",
  broadcastConfirmTitle: "Send this announcement",
  broadcastConfirmWarning:
    "You cannot take this back once it is sent. Check who it goes to and how many people that is.",
  broadcastConfirmEmpty:
    "Nobody matches this group right now, so sending it would reach no one.",
  broadcastConfirmCancel: "Cancel",
  broadcastSendOne: "Send to {{n}} person",
  broadcastSend: "Send to {{n}} people",
  broadcastSentOne: "The announcement was sent to {{n}} person.",
  broadcastSent: "The announcement was sent to {{n}} people.",
  broadcastSentEmailOne:
    "{{n}} of them has email turned on and will get it by email as well (about {{eta}} to send them all).",
  broadcastSentEmail:
    "{{n}} of them have email turned on and will get it by email as well (about {{eta}} to send them all).",
  broadcastSentNoEmail: "There were no email recipients.",
  broadcastTruncated:
    "Note that {{total}} people matched this group, but sending stopped after {{n}}. The rest did not receive it.",
  broadcastPartial:
    "Sending failed part way through, so only {{n}} people received the announcement. If you send the same thing again, everyone who already got it will receive a second copy. Check how many people it reached in the history below, and only resend if you need to.",
  segmentOverlapNote:
    "The groups overlap: people selected in the lottery are also in “Confirmed”, and organizers, judges and viewers are also in “Checked in”. If you send to two groups one after the other, anyone in both receives two copies.",
  etaMinutes: "about {{n}} min",
  etaHours: "about {{n}} h",
  etaHoursMinutes: "about {{h}} h {{m}} min",

  nameCardStaffOnly: "This page is only for the organizers of this event.",
  nameCardLoadFailed: "Could not load the name card data.",
  nameCardIntro:
    "Ten cards per A4 sheet (91 × 55 mm), sized to fit off-the-shelf business card stock and badge holders",
  nameCardNoMembers: "Nobody has a confirmed registration yet.",
  nameCardCountOneSheet: "{{selected}} of {{all}} people ({{sheets}} A4 sheet)",
  nameCardCount: "{{selected}} of {{all}} people ({{sheets}} A4 sheets)",
  nameCardSelectAll: "Select everyone",
  nameCardClearAll: "Clear all",
  nameCardPrint: "Print",
  nameCardBuilding: "Building the cards ({{done}} / {{total}})",
  nameCardPeopleHeading: "Who to print",
  nameCardPrintCheckbox: "Print {{name}}",
  nameCardPreviewHeading: "Print preview",
  nameCardPreviewNote:
    "To print the background colours, turn on “Background graphics” in the print dialog.",

  statsStaffOnly: "Traffic stats are for organizers only.",
  statsLoadFailed: "Could not load the stats.",
  statsRange7: "7 days",
  statsRange30: "30 days",
  statsRangeAll: "All time",
  statsViews: "Page views",
  statsUniques: "Unique visitors",
  statsJoins: "Registrations",
  statsEmpty:
    "No visits yet. Once you publish this event and share it, you will see where people come from and how traffic changes over time.",
  statsSources: "Where people come from",
  statsCountries: "Countries and regions",
  statsDaily: "Day by day",
  statsLegendJoins: "Sign-ups",
  statsDayTooltip:
    "{{day}}  views: {{views}} / unique: {{uniques}} / sign-ups: {{joins}}",
  statsNoData: "No data",
  sourceDirect: "Direct",
  sourceInternal: "Within the site",
  sourceNotification: "Notification",
  sourceFeed: "Feed",
  sourceEmail: "Email",
  sourceCard: "Profile card",
  surveyTitle: "Survey answers",
  surveyRemind: "Remind people who have not answered",
  surveyRemindConfirm:
    "Send a “please answer the survey” notification to confirmed participants who have not answered yet?",
  surveyRemindedOne: "Notified {{n}} person",
  surveyReminded: "Notified {{n}} people",
  surveyRemindFailed: "Could not send the notifications.",
  surveyCsv: "Download CSV",
  surveyNote:
    "The answers people gave when they registered (organizers only).",
  surveyEmpty: "No answers yet.",
  surveyStatusColumn: "Status",
  surveyStatusCanceled: "Canceled",
  surveyNotJoined: "Not registered",
  meetRankingTitle: "Meet ranking",
  meetRankingNote:
    "How many meets each person recorded. Organizers always see every rank with names here, whatever the participant-facing ranking setting is. Handy when handing out prizes.",

  prizeDeskTitle: "Prize desk",
  prizeDeskStaffOnly: "The prize desk is for organizers only.",
  prizeDeskLead:
    "Match the participant's achievement screen with their name, hand over the prize, then press \"Mark redeemed\". Stock goes to whoever redeems first.",
  prizeDeskEmpty: "No prizes yet. Add them from the event edit page.",
  prizeDeskStock: "Stock: {{left}} of {{total}} left",
  prizeDeskAchieversCount: "Achieved: {{n}}",
  prizeDeskNoAchievers: "No one has achieved this yet.",
  prizeDeskSearch: "Filter by name",
  prizeDeskRedeem: "Mark redeemed",
  prizeDeskUnredeem: "Undo redemption",
  prizeDeskUnredeemConfirm: "Undo this redemption? (Returns one to stock.)",
  prizeDeskWinnersTitle: "Ranking winner",
  prizeDeskWinnersUndecided: "The winner has not been decided yet.",
  prizeDeskCloseWinners: "Decide the winner",
  prizeDeskRecloseWinners: "Decide the winner again",
  prizeDeskCloseConfirm:
    "Closing now locks in whoever has met the most people at this moment (everyone, if tied). Meets after closing do not change the winner.",
  prizeDeskClearWinners: "Undo the decision",
  prizeDeskClearConfirm: "Undo the winner decision and go back to undecided?",
  prizeDeskNoMeets: "No meets have been recorded yet, so the winner cannot be decided.",
  prizeRedeemAlready: "This prize has already been redeemed.",
  prizeRedeemOutOfStock: "Out of stock.",
  prizeRedeemNotAchieved: "The condition is not met.",
  prizeRedeemNotConfirmed: "Cannot redeem because participation is not confirmed.",
  prizeRedeemFailed: "Failed to redeem.",

  bingoControlTitle: "Bingo draw",
  bingoControlStaffOnly: "Bingo controls are for organizers only.",
  bingoCreate: "Set up bingo",
  bingoCreateNote: "Once set up, participants can get their cards.",
  bingoStart: "Start drawing",
  bingoStartConfirm: "Start drawing? (Cards can still be issued after starting.)",
  bingoDraw: "Draw next",
  bingoUndoDraw: "Undo last draw",
  bingoUndoConfirm: "Undo the last drawn number?",
  bingoUndoHelp: "An undone number comes up again on the next draw.",
  bingoEnd: "End this round (finalize results)",
  bingoEndConfirm:
    "Close the draw and finalize this round's results (ranks are saved). Prizes can still be redeemed. Reset afterwards to play another round.",
  bingoReset: "Reset (redeal cards)",
  bingoResetConfirm:
    "Reset? Everyone's cards are voided and achievements are cleared. Redeemed prizes remain.",
  bingoDelete: "Delete bingo",
  bingoDeleteConfirm:
    "Delete the bingo game? Participants will no longer see it, and cards and draw records are removed (results of finished rounds are kept).",
  bingoExhausted: "All numbers have been drawn.",
  bingoOpFailed: "The operation failed.",
  bingoAchieversTitle: "Reach & bingo list (for announcements)",
  bingoRankN: "Bingo #{{rank}}",
  bingoNoRows: "No one has taken a card yet.",
  prizeDeskBingoTitle: "Bingo prizes (pick one)",
  prizeDeskBingoNote:
    "Achievers pick one prize, in order, while stock lasts. Settle ties on the spot.",
  prizeDeskBingoNone: "No bingo achievers yet.",
  prizeDeskBingoChoose: "Redeem this prize",
  prizeLogTitle: "Redemption log",
  prizeLogEmpty: "No redemptions yet.",
  prizeLogBy: "By {{name}}",

  todoTitle: "Prep to-dos",
  todoStaffOnly: "Prep to-dos are for organizers only.",
  todoScopeNote:
    "Work that happens before the day, decided by date, belongs here. Anything with a time on the day itself belongs in the timetable.",
  todoToTimetable: "Go to the timetable",
  todoFromTimetable: "Go to prep to-dos",
  todoEmpty: "Nothing here yet.",
  todoFilterNone: "Nothing matches these filters.",
  todoCountOpen: "{{n}} to do",
  todoCountOverdue: "{{n}} late",
  todoCountBlocked: "{{n}} waiting",
  todoCountDone: "{{n}} done",
  todoFilterMine: "Assigned to me",
  todoFilterUnassigned: "Unassigned only",
  todoFilterLeft: "Owner stepped down",
  todoFilterOverdue: "Late only",
  todoFilterShowDone: "Include finished",
  todoUnassigned: "Nobody assigned",
  todoAssigneeLeft: "The person who owned this stepped down — assign someone.",
  todoBlockedChip: "Waiting",
  todoOverdueChip: "Late",
  todoCycleChip: "These jobs wait on each other in a loop",
  todoNoDates: "No dates yet",
  todoDependsOnChip: "⟵ {{title}}",
  todoDeleteConfirm: "Delete “{{title}}”?",
  todoFieldTitle: "What needs doing",
  todoFieldNote: "Notes",
  todoFieldStartsOn: "Start date",
  todoFieldDueOn: "Due date",
  todoFieldAssignee: "Owner",
  todoDepsField: "Finish these first",
  todoDepsHelp: "This job waits until everything you pick here is finished.",
  todoGanttTitle: "Dates",
  todoGanttEmpty: "Add a start or due date and a bar shows up here.",
  todoGanttOutside:
    "{{n}} job(s) fall outside this range (they are still in the list).",
  todoGanttClipped:
    "{{n}} job(s) run longer than the chart shows — their bars are cut off.",
  todoGanttToday: "Today",
  todoGanttSelectHint: "Pick a row to see the lines to the jobs it connects to.",
  todoGanttMonth: "M{{n}}",
  todoSaveFailed: "Could not save that.",
  todoLimitError: "This event has reached the limit for prep to-dos.",
  todoDepLimitError: "You cannot pick any more jobs to finish first.",
  todoDepCycleError: "That would leave these jobs waiting on each other forever.",
  todoAssigneeNotStaffError:
    "Only organizers whose place at this event is confirmed can own a job.",
  todoBadRangeError: "The start date is after the due date.",

  staffChatTitle: "Staff chat",
  staffChatStaffOnly: "The staff chat is only for this event's organizers.",
  staffChatNotice:
    "Only organizers can read this chat. Messages are encrypted and stored on an external server (the service operator can read them).",
  staffChatOpenFailed: "Could not open the chat. Reload the page and try again.",

  dutyTitle: "Roles & posts",
  dutyStaffOnly: "Roles and posts are for organizers only.",
  dutyPageNote:
    "First decide which roles each time slot needs and how many people, then assign people. Because the headcount comes first, you can see which posts are still unfilled.",
  dutyToTimetable: "Go to the timetable",
  dutyDefsTitle: "Roles",
  dutyDefsNote:
    "The roles this event uses (front desk, MC, streaming and so on). Duplicating the event copies them by name.",
  dutyAddPlaceholder: "Role name (e.g. Front desk)",
  dutyAddButton: "Add",
  dutyRenameTitle: "Rename this role",
  dutyDeleteConfirm:
    "Delete “{{name}}”? Its {{n}} post(s) and their assignments will be removed too.",
  dutyDeleteConfirmUnused: "Delete “{{name}}”?",
  dutyUnfilledCount: "{{n}} unfilled post(s)",
  dutyAllFilled: "Every post is filled.",
  dutyFilterShort: "Unfilled only",
  dutyFilterMine: "My posts",
  dutyFilterNone: "No time slots match these filters.",
  dutyNoItems:
    "The timetable has no time slots yet. Build the timetable first.",
  dutyNoDuties: "Create a role first.",
  dutyNoSlots: "No posts",
  dutyNoTime: "No time yet",
  dutyEditSlots: "Edit posts",
  dutySlotsDialogTitle: "Posts & assignments",
  dutySlotAdd: "Add a post",
  dutyRequiredLabel: "People needed",
  dutySlotRemove: "Remove",
  dutySlotRemoveConfirm:
    "Remove the “{{name}}” post? Its assignments will be removed too.",
  dutyAssignLabel: "Assign someone",
  dutyAssignButton: "Assign",
  dutyAssigneeLeft:
    "Someone assigned here has stepped down — remove them and assign someone else.",
  dutyAssigneeLeftShort: "Stepped down",
  dutySaveFailed: "Could not save that.",
  dutyLimitError: "This event has reached the limit for roles.",
  dutyNameTakenError: "A role with that name already exists.",
  dutySlotLimitError: "This time slot has reached its limit for posts.",
  dutyRequiredRangeError: "That number of people is not allowed.",
  dutyAssigneeNotStaffError:
    "Only organizers whose place at this event is confirmed can be assigned.",
  dutyAssigneeLimitError: "This post has reached its limit for assignments.",
  dutyAssigneeDupError: "That person is already assigned to this post.",
};

/**
 * 運営スタッフの招待が断られた理由 (#339)。サーバーのエラーコードで引く表なので
 * キーはコードそのもの。共通の `errors` より一歩踏み込んで、その場で直せる形で書く。
 *
 * ここに無いコードは `staffOps.inviteErrorDefault` に落ちる。
 * 「返事待ちに戻せるか」のような**文言でない属性は持たない**。
 */
const inviteErrorJa = {
  user_not_found:
    "そのユーザー名の人が見つかりませんでした。プロフィールのユーザー名を確認してください。",
  self_invite: "自分自身は招待できません。",
  already_staff: "その人はすでに運営です。",
  already_invited:
    "その人にはすでに招待を送っています。返事を待つか、取り消してから送り直してください。",
  inviter_not_staff:
    "招待した人は、このイベントの運営ではなくなりました。必要なら別の運営から招待し直してもらってください。",
  not_pending: "この招待はすでに返事が済んでいます。画面を更新してください。",
  not_found: "対象が見つかりませんでした。画面を更新してください。",
} as const;

const inviteErrorEn: Record<keyof typeof inviteErrorJa, string> = {
  user_not_found:
    "No one with that username was found. Check the username on their profile.",
  self_invite: "You cannot invite yourself.",
  already_staff: "They are already an organizer.",
  already_invited:
    "You have already invited them. Wait for their reply, or revoke the invitation and send it again.",
  inviter_not_staff:
    "The person who invited you is no longer an organizer of this event. If you still want to join, ask another organizer to invite you again.",
  not_pending: "This invitation has already been answered. Please reload.",
  not_found: "That was not found. Please reload the page.",
};

/** 招待の状態。日本語はもとの定数 (`STAFF_INVITE_STATUS_LABELS`) が source */
const inviteStatusEn: Record<StaffInviteStatus, string> = {
  pending: "Waiting for a reply",
  accepted: "Accepted",
  declined: "Declined",
  revoked: "Revoked",
};

/** 一斉連絡の送信先区分。日本語はもとの定数が source */
const segmentEn: Record<BroadcastSegment, string> = {
  all: "Everyone",
  confirmed: "Confirmed",
  waitlist: "Waiting list",
  lottery_won: "Selected in the lottery",
  lost: "Not selected",
  staff: "Organizers",
  judge: "Judges",
  observer: "Viewers",
  attended: "Checked in",
  not_attended: "Did not check in",
};

/** 区分が誰を指すかの補足。日本語はもとの定数が source */
const segmentNoteEn: Record<BroadcastSegment, string> = {
  all: "Everyone involved in this event except people who cancelled or were not selected. That includes organizers, judges and viewers, as well as anyone on the waiting list or waiting for the lottery.",
  confirmed:
    "Participants whose registration is confirmed, including everyone selected in the lottery. Organizers, judges and viewers are not included.",
  waitlist:
    "Participants on the waiting list because the first-come slot was full.",
  lottery_won:
    "Participants selected in a lottery slot. They are also part of “Confirmed”, so sending to both means two copies.",
  lost: "Participants who were not selected and are still not taking part. This also covers lottery slots you removed later, and people you marked as not selected on a first-come slot. They are not part of “Everyone”.",
  staff: "Organizers of this event (except those who stepped down).",
  judge: "Judges for this event (except those who stepped down).",
  observer: "Viewers of this event (except those who cancelled).",
  attended:
    "People checked in at the desk. Not only participants — organizers, judges and viewers who came through check-in are included too.",
  not_attended:
    "Participants who were confirmed but have no check-in record. At events that do not use check-in, every confirmed participant lands here.",
};

export const staffOps = { ja, en };
export const staffInviteError = { ja: inviteErrorJa, en: inviteErrorEn };
export const staffInviteStatus = {
  ja: STAFF_INVITE_STATUS_LABELS,
  en: inviteStatusEn,
};
export const broadcastSegment = {
  ja: BROADCAST_SEGMENT_LABELS,
  en: segmentEn,
};
export const broadcastSegmentNote = {
  ja: BROADCAST_SEGMENT_NOTES,
  en: segmentNoteEn,
};
