/**
 * 景品の引き換えデスク (#431)、数字ビンゴの抽選コントロール (#436)、
 * 引き換え履歴 (#441)。
 */
const ja = {
  /* ── 景品の引き換えデスク (#431) ──────────────────
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
  bingoFirstDrawHint: "「次を引く」で1個目を引きます。",
  bingoUndoDraw: "直前の1個を取り消す",
  bingoUndoConfirm: "直前に引いた番号を取り消しますか？",
  bingoUndoHelp: "取り消した番号は、次を引くと同じ番号がもう一度出ます。",
  bingoEnd: "この回を終了する（結果を確定）",
  bingoEndConfirm:
    "抽選を締めて、この回の結果（順位）を確定・保存します。景品の引き換えは続けられます。終了後にリセットすれば2回戦ができます。",
  bingoReset: "リセット（カード再配布）",
  bingoResetConfirm:
    "リセットしますか？全員のカードが無効になり、達成も消えます。引き換え済みの景品と保存済みの成績はそのまま残ります。",
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
  prizeLogDeletedUser: "退会したユーザー",
} as const;

const en: Record<keyof typeof ja, string> = {
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
  bingoFirstDrawHint: "Press \"Draw next\" to draw the first number.",
  bingoUndoDraw: "Undo last draw",
  bingoUndoConfirm: "Undo the last drawn number?",
  bingoUndoHelp: "An undone number comes up again on the next draw.",
  bingoEnd: "End this round (finalize results)",
  bingoEndConfirm:
    "Close the draw and finalize this round's results (ranks are saved). Prizes can still be redeemed. Reset afterwards to play another round.",
  bingoReset: "Reset (redeal cards)",
  bingoResetConfirm:
    "Reset? Everyone's cards are voided and achievements are cleared. Redeemed prizes and saved results remain.",
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
  prizeLogDeletedUser: "Deleted user",
};

export const prizes = { ja, en };
