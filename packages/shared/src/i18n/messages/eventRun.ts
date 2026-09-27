/**
 * 当日の進行・採点・表彰の文言 (#363)。
 *
 * 進行コントロール（プレゼン→集計→表彰の切り替え）、採点画面と採点結果、
 * 採点項目の設定、表彰式と表彰の編集。
 *
 * イベント詳細から進行・採点・表彰へ入る導線の文言は `eventDetail.ts` が
 * すでに持っている（`scoring` `control` `awards` など）ので、ここに増やさない。
 * モード名も `modePresentation` `modeAggregation` `modeAwards` が向こうにある。
 * ここに置くのは向こうに無い `modeNormal` だけ。
 */
// 数の入れ替えは {{n}} を使う。i18next の `count` は複数形の仕組みを
// 起動してしまい、`_other` を用意していないキーで挙動が読みにくくなるため。
const ja = {
  operationsTitle: "コンテスト運営",
  preparationSection: "1 準備",
  scoringSection: "2 エントリー・採点",
  awardsSection: "3 賞・受賞者",
  ceremonySection: "4 表彰式",
  setupCriteria: "採点項目を設定",
  setupAwards: "賞・賞品を設定",
  entryProgress: "エントリー・採点状況を見る",
  scorePersonally: "自分で採点する",
  selfEntryHelp: "自分の作品を採点対象に含めます。他の作品の採点とは別の操作です。",
  mySubmissionLink: "自分の提出物へ",
  chooseFromSummary: "集計を見て受賞者を選ぶ",
  prepareCeremony: "表彰式の準備・進行へ",
  backToOperations: "コンテスト運営へ戻る",
  backToDetailOperations: "イベント詳細のコンテスト運営へ戻る",
  backToSummary: "採点の集計へ",
  entryCount: "エントリー {{n}} 件",
  noEntriesYet: "採点対象のエントリーはまだありません",
  awardsMoved: "賞・受賞者の設定はコンテスト運営で行います",
  saveEventForAwards: "イベントを保存すると設定できます",
  awardSaveHelp: "受賞者は選ぶと保存されます。賞名・内容は入力欄を離れると保存されます。",
  awardSaving: "保存中…",
  awardSaved: "保存済み",
  awardSaveFailed: "保存できませんでした。入力内容は未保存です。",
  awardUnconfirmed: "保存内容を確認できませんでした",
  retryAwardSave: "再試行",
  restoreAwards: "保存済みの内容に戻す",
  reloadAwards: "再読み込み",
  confirmBeforeCeremony: "保存を確認してから進めます",
  addAwardFirst: "まず賞を追加してください",
  unassignedAwardsHelp: "受賞者未設定の賞は「該当者なし」として表示されます",
  reviewWinners: "受賞者を確認・変更",
  awardsModeFailed: "表彰式に切り替えられませんでした。もう一度お試しください。",
  awardsModeActive: "表彰式に切替済み",
  switchParticipantsToAwards: "参加者の画面を表彰式に切り替える",
  switchBeforeOpening: "先に参加者の画面を表彰式に切り替えてください",
  openCeremony: "表彰式を開く",

  /* ── この範囲の画面をまたいで使うもの ─────────────────────── */
  /** 選択肢の先頭に置く「まだ選んでいない」項目（発表中のチーム・受賞チーム） */
  notSelected: "（未選択）",
  /** 集計の表の見出し（進行コントロール・採点結果） */
  teamColumn: "チーム",
  totalColumn: "合計",

  /* ── 進行コントロール ─────────────────────────────────── */
  controlStaffOnly: "進行コントロールはスタッフ専用です。",
  toScoring: "採点画面へ",
  modeHeading: "モード",
  /** プレゼン・集計・表彰は eventDetail が持っている。通常だけここに置く */
  modeNormal: "通常",
  presentingHeading: "発表中のチーム",

  /** 発表画面 (#215)。ScoringPanel とパネル開閉ボタンを埋め込むので、
   *  枠だけ日本語のまま残らないよう投影・配信グループ (#367) より先に拾った */
  presentModeChip: "プレゼンモード",
  presentNowLabel: "発表中",
  presentSlidesLabel: "資料:",
  presentCodeLabel: "コード:",
  presentWaiting: "発表チームの選択を待っています…",
  presentScoreWaiting: "発表チームが選択されると採点できます",
  presentScoreOthers: "他の発表も採点する（採点一覧）",

  /** 採点の締切。チップの色は画面側が持つ（文言だけここ） */
  scoringLockHeading: "採点の締切",
  scoringLockedChip: "締切済み",
  scoringOpenChip: "受付中",
  closeScoring: "採点を締め切る",
  reopenScoring: "採点を再開",
  scoringClosedNotice:
    "採点を締め切りました。受賞者を設定して表彰の準備をしましょう。",
  setWinnersAction: "受賞者を設定する",

  /** 採点進捗。立場のラベルは lib/format.ts の roleLabel が訳す */
  progressHeading: "採点者ごとの進捗",
  noJudges: "採点者がいません",
  judgeNameWithRole: "{{name}}（{{role}}）",

  summaryHeading: "エントリーごとの集計",

  /** 表彰の準備。説明文の ①②③ は下に並ぶチップと対応している */
  awardsSteps:
    "① 受賞者を設定 → ② 表彰モードに切替（参加者は自動で表彰画面へ）→ ③ 表彰式画面で1件ずつ発表します。",
  /** 賞の数。英語で "1 awards" にならないよう単数と複数でキーを分ける
   *  （どちらを使うかは総数だけで決まる。日本語はどちらも同じ綴り） */
  setWinnersCountOne: "受賞者を設定（{{n}}/{{total}} 賞）",
  setWinnersCount: "受賞者を設定（{{n}}/{{total}} 賞）",
  setWinners: "受賞者を設定",
  switchToAwardsMode: "表彰モードにする",
  /** ボタン名のうしろに続けて出る。英語では区切りの空白を先頭に入れる */
  currentModeSuffix: "（現在このモード）",
  runCeremony: "表彰式を進行（この画面が参加者にも映ります）",
  toCeremonyControls: "表彰式の操作へ",

  /* ── 採点 ─────────────────────────────────────────────── */
  scoringMembersOnly: "採点するにはイベントへの参加が必要です。",
  scoringLockedNotice: "採点は締め切られています。",
  /** 自分のチームの見出しに添える。英語では区切りの空白を先頭に入れる */
  selfEntrySuffix: "（自分）",
  scoringDisabledNote: "現在このエントリーは採点できません（自己採点制限または締切）",

  /* ── 採点結果 ─────────────────────────────────────────── */
  resultsTitle: "採点結果",
  resultsNotPublished:
    "採点結果はまだ公開されていません。採点の締切後、または開催終了後にこちらで公開されます。",
  resultsEmpty: "採点データがありません。",
  rankColumn: "順位",
  rankNth: "{{n}}位",

  /* ── 採点項目 ─────────────────────────────────────────── */
  criteriaStaffOnly: "採点項目の管理はスタッフ専用です。",
  criteriaTitle: "採点項目の管理",
  criterionName: "名称",
  criterionDescription: "説明",
  /** 一覧の中の狭い選択欄と、追加フォームの選択欄で言い方が違う */
  criterionLevel: "段階",
  criterionLevelCount: "段階数",
  criterionAddHeading: "項目を追加",

  /* ── 表彰式 ───────────────────────────────────────────── */
  ceremonySoon: "まもなく発表します…",
  awardKindSpecial: "特別賞",
  awardKindRank: "ランキング",
  drumroll: "受賞は…？",
  awardsRefreshFailed: "表彰結果を取得できませんでした。もう一度お試しください。",
  /** 点数。英語で "1 points" にならないよう単数と複数でキーを分ける */
  totalPointOne: "合計 {{n}} 点",
  totalPoints: "合計 {{n}} 点",
  revealProgress: "発表 {{n}} / {{total}}",
  revealReset: "発表を最初からに戻す",
  revealAllDone: "すべて発表済み",
  revealNext: "次を発表",
  revealedHeading: "発表済み",
  notifyWinners: "受賞者にアプリ内通知",
  notifyAfterAll: "（すべて発表後に通知できます）",
  /** 通知した人数。英語で "1 winners" にならないよう単数と複数で分ける */
  notifiedWinnerOne: "受賞者 {{n}} 人に通知しました",
  notifiedWinners: "受賞者 {{n}} 人に通知しました",
  /** 矢印つきの戻り導線。矢印も言語ごとに持つ */
  backToControl: "← 受賞者・表彰の準備に戻る",

  /* ── 賞・受賞者の編集（コンテスト運営） ───────────────────────── */
  awardsEditorTitle: "表彰（ランキング賞・特別枠）",
  rankAwardsHeading: "ランキング賞（ドラッグで並び替え・上が上位）",
  awardName: "賞の名前",
  awardContent: "賞の内容（任意）",
  awardWinner: "受賞者",
  rankAwardNamePlaceholder: "賞の名前（例: 最優秀賞）",
  addRankAward: "賞を追加",
  specialAwardsHeading: "特別枠（ランキング外）",
  specialAwardName: "特別枠の名前",
  specialAwardContent: "賞品・賞の内容（任意）",
  specialAwardNamePlaceholder: "特別枠の名前（例: オーディエンス賞）",
  addSpecialAward: "特別枠を追加",
} as const;

const en: Record<keyof typeof ja, string> = {
  operationsTitle: "Contest operations",
  preparationSection: "1 Preparation",
  scoringSection: "2 Entries and scoring",
  awardsSection: "3 Awards and winners",
  ceremonySection: "4 Ceremony",
  setupCriteria: "Set scoring criteria",
  setupAwards: "Set up awards and prizes",
  entryProgress: "View entries and scoring progress",
  scorePersonally: "Score entries yourself",
  selfEntryHelp: "Include your own work as an entry. This is separate from scoring other entries.",
  mySubmissionLink: "Go to your submission",
  chooseFromSummary: "Review scores and choose winners",
  prepareCeremony: "Prepare and run the ceremony",
  backToOperations: "Back to contest operations",
  backToDetailOperations: "Back to contest operations on the event page",
  backToSummary: "Back to the score summary",
  entryCount: "Entries: {{n}}",
  noEntriesYet: "There are no entries to score yet.",
  awardsMoved: "Set up awards and winners in contest operations.",
  saveEventForAwards: "Save the event first to set up awards.",
  awardSaveHelp: "Winners save when selected. Award names and contents save when you leave the field.",
  awardSaving: "Saving…",
  awardSaved: "Saved",
  awardSaveFailed: "Could not save. Your changes are not saved.",
  awardUnconfirmed: "Could not confirm saved contents.",
  retryAwardSave: "Retry",
  restoreAwards: "Restore saved contents",
  reloadAwards: "Reload",
  confirmBeforeCeremony: "Confirm saved changes before proceeding.",
  addAwardFirst: "Add an award first.",
  unassignedAwardsHelp: "Awards without a winner are shown as “No recipient”.",
  reviewWinners: "Review or change winners",
  awardsModeFailed: "Could not switch to the ceremony. Please try again.",
  awardsModeActive: "Ceremony mode is active",
  switchParticipantsToAwards: "Switch participants to the ceremony",
  switchBeforeOpening: "Switch participants to the ceremony before opening it.",
  openCeremony: "Open the ceremony",

  notSelected: "(none selected)",
  teamColumn: "Team",
  totalColumn: "Total",

  controlStaffOnly: "Only organizers can run the event.",
  toScoring: "Go to scoring",
  modeHeading: "Mode",
  modeNormal: "Normal",
  presentingHeading: "Team presenting now",

  presentModeChip: "Presentation mode",
  presentNowLabel: "Presenting now",
  presentSlidesLabel: "Slides:",
  presentCodeLabel: "Code:",
  presentWaiting: "Waiting for a team to be selected…",
  presentScoreWaiting: "You can score once a team is selected",
  presentScoreOthers: "Score the other teams (all entries)",

  scoringLockHeading: "Scoring window",
  scoringLockedChip: "Closed",
  scoringOpenChip: "Open",
  closeScoring: "Close scoring",
  reopenScoring: "Reopen scoring",
  scoringClosedNotice:
    "Scoring is closed. Set the winners and get ready for the ceremony.",
  setWinnersAction: "Set the winners",

  progressHeading: "Progress by scorer",
  noJudges: "Nobody is scoring yet",
  judgeNameWithRole: "{{name}} ({{role}})",

  summaryHeading: "Scores by entry",

  awardsSteps:
    "① Set the winners → ② switch to awards mode, which sends everyone to the ceremony view → ③ reveal the awards one by one from the ceremony screen.",
  setWinnersCountOne: "Set the winners ({{n}} of {{total}} award)",
  setWinnersCount: "Set the winners ({{n}} of {{total}} awards)",
  setWinners: "Set the winners",
  switchToAwardsMode: "Switch to awards mode",
  currentModeSuffix: " (this is the current mode)",
  runCeremony: "Run the ceremony. Participants see this screen too.",
  toCeremonyControls: "Go to the ceremony controls",

  scoringMembersOnly: "You need to join this event before you can score.",
  scoringLockedNotice: "Scoring is closed.",
  selfEntrySuffix: " (yours)",
  scoringDisabledNote:
    "You cannot score this entry right now, because self-scoring is off or scoring has closed.",

  resultsTitle: "Scores",
  resultsNotPublished:
    "The scores are not public yet. They appear here once scoring closes, or after the event ends.",
  resultsEmpty: "There are no scores yet.",
  rankColumn: "Rank",
  rankNth: "#{{n}}",

  criteriaStaffOnly: "Only organizers can manage the scoring criteria.",
  criteriaTitle: "Scoring criteria",
  criterionName: "Name",
  criterionDescription: "Description",
  criterionLevel: "Levels",
  criterionLevelCount: "Number of levels",
  criterionAddHeading: "Add a criterion",

  ceremonySoon: "The results are coming up…",
  awardKindSpecial: "Special award",
  awardKindRank: "Ranking",
  drumroll: "And the winner is…",
  awardsRefreshFailed: "Could not load the award results. Please try again.",
  totalPointOne: "{{n}} point in total",
  totalPoints: "{{n}} points in total",
  revealProgress: "{{n}} of {{total}} revealed",
  revealReset: "Restart the reveals",
  revealAllDone: "Everything is revealed",
  revealNext: "Reveal the next one",
  revealedHeading: "Already revealed",
  notifyWinners: "Notify the winners in the app",
  notifyAfterAll: "(You can notify them once everything is revealed)",
  notifiedWinnerOne: "Notified {{n}} winner",
  notifiedWinners: "Notified {{n}} winners",
  backToControl: "← Back to winners and ceremony preparation",

  awardsEditorTitle: "Awards (ranked awards and special awards)",
  rankAwardsHeading:
    "Ranked awards. Drag to reorder; the top one is the highest.",
  awardName: "Award name",
  awardContent: "What the award includes (optional)",
  awardWinner: "Winner",
  rankAwardNamePlaceholder: "Award name (e.g. Grand Prize)",
  addRankAward: "Add an award",
  specialAwardsHeading: "Special awards (outside the ranking)",
  specialAwardName: "Special award name",
  specialAwardContent: "Prize or what the award includes (optional)",
  specialAwardNamePlaceholder: "Special award name (e.g. Audience Choice)",
  addSpecialAward: "Add a special award",
};

export const eventRun = { ja, en };
