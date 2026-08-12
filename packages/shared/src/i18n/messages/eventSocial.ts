/**
 * イベントページで参加者が書き込む場所の文言 (#363)。
 *
 * チャット・Q&A・コメント・感想・写真。**利用者が書いた文章そのものは
 * 訳さない**（ここが持つのは画面の枠の文言だけ）。
 *
 * どれも「参加が確定した人だけが使える」という同じ性質なので、その断り書きは
 * 1か所にまとめてある（機能ごとに言い回しを増やさない）。
 *
 * 立場の名前（スタッフ・参加者）はここに持たない。`role` の表
 * （messages/labels.ts）が source なので、画面はそちらを引く。
 */
// 数の入れ替えは {{n}} を使う。i18next の `count` は複数形の仕組みを
// 起動してしまい、`_other` を用意していないキーで挙動が読みにくくなるため。
const ja = {
  /* ===== チャット (#199 / #215 投影用 / #283 締め出し / #332 鍵の選択) ===== */

  /** 見出しと接続状態 */
  chatHeading: "チャット",
  chatConnected: "接続中",
  chatOffline: "オフライン",
  chatOpenInPage: "チャット画面で開く",

  /** 繋がせない状態 (#283)。理由は書かないが嘘も書かない。
   *  表示と参加ボタンの失敗で同じ文言を出すので1キーにまとめてある */
  chatUnavailable: "このイベントのチャットに接続できません。",

  /** 部屋（チャンネル）の開設まわり */
  chatRoomNotOpenYet:
    "チャットの部屋はまだ開設されていません。スタッフが開設すると参加できます。",
  chatRoomNotOpenStaff:
    "チャットの部屋はまだありません。参加すると部屋が開設され、参加者もチャットできるようになります。",
  chatChannelCreateRejected:
    "チャンネルの作成に失敗しました（リレーに接続できないか、kind:40 が拒否されました）。",
  chatChannelCreateNoServiceKey:
    "公式鍵が未設定のためチャンネルを作成できません（運営に連絡してください）。",
  chatChannelCreateFailed: "チャンネルの作成に失敗しました。",
  chatResetChannel: "チャンネルを作り直す",
  chatResetChannelConfirm:
    "チャンネルを作り直しますか？（リレー上に部屋が無い場合の復旧用。過去のメッセージは新しい部屋には表示されません）",

  /** 参加（発言に使う鍵を決める） */
  chatKeyModeEphemeral: "イベント用の一時鍵で発言",
  chatKeyModeNip07: "Nostrアカウントで発言",
  chatNip07Notice:
    "本アカウントでの発言は events lab の外の Nostr クライアントからも見えます。",
  chatPublicNotice: "チャットの内容は公開されます。",
  chatJoin: "チャットに参加する",

  /** 参加が断られた理由。次に何をすればよいかまで書く */
  chatJoinKeyTaken:
    "この鍵は同じイベントの別のユーザーが使用中です。別の鍵を選んでください。",
  chatJoinKeyNotLinked:
    "この鍵はあなたのアカウントに登録されていません。同じ鍵でサインインしてアカウントに登録するか、イベント用の一時鍵で参加してください。",
  chatJoinTooManyKeys:
    "このイベントで使える鍵の数の上限に達しました。イベント用の一時鍵で参加してください。",
  chatJoinNotConfirmed: "参加が確定しているメンバーのみチャットを利用できます。",
  chatJoinFailedRetry: "チャットへの参加に失敗しました。もう一度お試しください。",
  chatJoinFailed: "チャットへの参加に失敗しました。",

  /** メッセージ一覧と入力欄 */
  chatEmpty: "まだメッセージはありません。",
  /** 投影用 (#215)。読むだけの画面なので言い方を変えている */
  chatEmptyDisplay: "まだ表示できるメッセージがありません。",
  chatInputPlaceholder: "メッセージを入力…",
  chatInputClosedPlaceholder: "書き込みはイベント開催時間の前後のみ",
  chatSendUrlNotAllowed: "URLの投稿はこのイベントでは許可されていません。",
  chatSendFailedOffline: "送信に失敗しました（リレーに接続できません）。",
  chatSendFailed: "送信に失敗しました。",

  /** スタッフの操作 */
  chatHideMessage: "このメッセージを非表示にする",
  chatHideMessageConfirm: "このメッセージを参加者の画面から非表示にしますか？",

  /* ===== チャット専用ページ (#215) ===== */
  /** `events.notFound` と日英とも同じ綴りだが、**意図して別のキー**にしている
   *  （理由は `events.notFound` のコメント）。`common` へ寄せた語との違いは、
   *  こちらが「どの領域からも使う語」ではないこと */
  chatEventNotFound: "イベントが見つかりません。",
  chatPageBackToEvent: "イベントページへ戻る",
  chatPageScreenView: "投影用画面",
  chatPageUnavailable:
    "このイベントのチャットは利用できません（参加確定メンバーのみ・チャット有効なイベントのみ）。",

  /** 投影用画面と登壇者サイドパネル (#215)。どちらもこの中のチャット・Q&A を
   *  埋め込むので、枠の文言だけ日本語のまま残らないよう、投影・配信グループ
   *  (#367) より先にここで拾っている */
  screenMembersOnly: "この画面は参加が確定しているメンバーのみ表示できます。",
  screenChatUnavailable: "このイベントではチャットを表示できません。",
  screenTextSmaller: "文字を小さく",
  screenTextLarger: "文字を大きく",
  screenBackToChat: "チャット画面に戻る",
  /** 「チャット・Q&A」＋「を開く / を閉じる」の連結だった。日本語の語順に
   *  合わせた足し算なので英語では組み立て直せない。1つの文言として持つ */
  panelToggleOpen: "チャット・Q&Aを開く",
  panelToggleClose: "チャット・Q&Aを閉じる",
  panelHeading: "会場の反応",
  panelClose: "パネルを閉じる",
  panelMembersOnly: "参加が確定しているメンバーのみ利用できます。",
  panelChatUnavailable: "このイベントではチャットは使えません。",

  /* ===== Q&A (#216) ===== */

  /** 見出しと案内。案内は3つ並べて出すので、英語は続きに空白を入れる */
  qaHeading: "Q&A（{{n}}）",
  qaIntro:
    "聞きたいことを投稿し、聞きたい質問に投票できます。票の多い質問が上に並びます。",
  qaAnonAll: "このイベントの質問は匿名で投稿されます。",
  qaRealAll: "このイベントの質問は名前つきで投稿されます。",

  /** 投稿 */
  qaPlaceholder: "質問を書く…",
  qaSubmit: "質問する",
  qaAnonToggle: "匿名で投稿する（運営には投稿者が分かります）",
  qaWillBeAnon: "この質問は匿名で投稿されます（運営には投稿者が分かります）",
  qaWillBeReal: "この質問は名前つきで投稿されます",
  qaAnonWarning: "参加者が少ないイベントでは、誰の質問か推測されることがあります。",

  /** 投稿が断られた理由。上限は件数まで出す（何度も押させない）。
   *  上限は固定の定数（20件・200件）なので、英語の単数用キーは要らない */
  qaClosed: "このイベントの Q&A は現在受け付けていません。",
  qaPostFailed: "質問の投稿に失敗しました。",
  qaLimit: "このイベントの質問は{{n}}件までです。",
  qaUserLimit:
    "1人が投稿できる質問は{{n}}件までです。自分の質問を取り消すと投稿できます。",
  qaPickFailed: "「いまこの質問」の変更に失敗しました。",

  /** 一覧 */
  qaEmpty: "まだ質問はありません。",
  qaAnsweredCount: "回答済み（{{n}}）",
  /** 票は1票でも出るので、英語は単数用のキーを分ける */
  qaVoteOne: "{{n}} 票",
  qaVotes: "{{n}} 票",
  qaVote: "この質問に投票する",
  qaUnvote: "投票を取り消す",

  /** 投稿者の行 */
  qaAnonymous: "匿名",
  qaAnonWithAuthor: "匿名（{{name}}）",
  /** 匿名投稿でも荒らし対応のためスタッフには投稿者が届く */
  qaAuthorStaffOnly: "スタッフにだけ表示されています",
  qaAuthorUnknown: "不明",
  qaMine: "自分",

  /** 状態のチップとスタッフの操作 */
  qaPicked: "いまこの質問",
  qaPick: "いまこの質問にする",
  qaUnpick: "ピックアップを解除",
  qaAnswered: "回答済み",
  qaMarkAnswered: "回答済みにする",
  qaMarkUnanswered: "未回答に戻す",
  qaHidden: "非表示",
  qaHide: "非表示にする",
  qaUnhide: "非表示を解除",
  qaDeleteMine: "自分の質問を取り消す",
  qaDeleteConfirm: "この質問を取り消しますか？（投票も一緒に消えます。元に戻せません）",

  /* ===== コメント ===== */
  commentsHeading: "コメント（{{n}}）",
  commentsEmpty: "まだコメントはありません。",
  commentPlaceholder: "コメントを追加…（Markdown が使えます）",
  commentDelete: "コメントを削除",
  commentDeleteConfirm: "このコメントを削除しますか？",
  commentPostFailed: "コメントの投稿に失敗しました。",
  /** 上限は固定の定数（200件）なので英語の単数用キーは要らない */
  commentLimit: "コメントは1イベントにつき{{n}}件までです。",
  commentMembersOnly: "コメントするにはこのイベントへの参加確定が必要です。",

  /* ===== 感想（いいね） (#155) ===== */
  feedbackHeading: "フィードバック",
  feedbackIntro:
    "よかった相手に「いいね」を送れます（参加者にのみ表示・誰が押したかは伝わりません）。",
  likeOn: "いいねする",
  likeOff: "いいねを取り消す",
  likeSelfDisabled: "自分にはいいねできません",
  /** いいねの対象の説明。スタッフ・参加者は `role` の表を引くのでここには無い。
   *  `likeCaptionCommunity` は `events.filterCommunity` と綴りが同じだが、
   *  **1つの部品に並ぶ3つで1組**なので、1つだけ他所を指すと読めなくなる。
   *  意図して同文のまま置いている */
  likeCaptionEvent: "このイベント",
  likeCaptionHost: "主催者",
  likeCaptionCommunity: "コミュニティ",

  /* ===== 写真 ===== */
  photoAdd: "写真を追加",
  photoUploading: "アップロード中… 残り{{n}}",
  photoUploadFailed: "アップロードに失敗しました。",
  /** 上限は固定の定数（50枚・100件）なので英語の単数用キーは要らない */
  photoLimit: "写真は1イベント{{n}}枚までです。",
  /** 公開範囲の案内。続けて出す補足は、英語では先頭に空白を入れる */
  photosPublicNotice: "この写真は誰でも見られます。",
  photosMembersNotice: "このイベントの参加者だけが見られます。",
  photosDropHint: " ドラッグ&ドロップや貼り付け（Ctrl/⌘+V）でも追加できます。",
  photosPublicToggle: "参加者以外にも写真を公開する",
  photosEmpty: "まだ写真がありません。",
  photosEmptyHint: "「写真を追加」やドラッグ&ドロップで共有しましょう。",
  photoDelete: "写真を削除",
  photoCommentDelete: "このコメントを削除",
  photoCommentPlaceholder: "コメントを追加…",
  photoCommentLimit: "コメントは1枚につき{{n}}件までです。",
  photoCommentMembersOnly:
    "コメントするにはこのイベントの参加者である必要があります。",
} as const;

const en: Record<keyof typeof ja, string> = {
  chatHeading: "Chat",
  chatConnected: "Connected",
  chatOffline: "Offline",
  chatOpenInPage: "Open the chat page",

  chatUnavailable: "You cannot connect to the chat for this event.",

  chatRoomNotOpenYet:
    "The chat room is not open yet. You can join once an organizer opens it.",
  chatRoomNotOpenStaff:
    "There is no chat room yet. Joining opens the room, and participants can chat too.",
  chatChannelCreateRejected:
    "Could not create the chat room (either the connection failed, or the room was rejected).",
  chatChannelCreateNoServiceKey:
    "The service key is not set up, so the chat room cannot be created. Please contact the site operators.",
  chatChannelCreateFailed: "Could not create the chat room.",
  chatResetChannel: "Recreate the room",
  chatResetChannelConfirm:
    "Recreate the chat room? This is for recovering when the room no longer exists. Past messages will not appear in the new room.",

  chatKeyModeEphemeral: "Post with a temporary key for this event",
  chatKeyModeNip07: "Post with your Nostr account",
  chatNip07Notice:
    "Posts from that account are also visible from Nostr clients outside events lab.",
  chatPublicNotice: "Everything you post in the chat is public.",
  chatJoin: "Join the chat",

  chatJoinKeyTaken:
    "Another person in this event is already using this key. Please choose a different one.",
  chatJoinKeyNotLinked:
    "This key is not registered to your account. Either sign in with the same key to register it, or join with a temporary key for this event.",
  chatJoinTooManyKeys:
    "You have reached the limit on keys for this event. Please join with a temporary key for this event.",
  chatJoinNotConfirmed: "Only confirmed participants can use the chat.",
  chatJoinFailedRetry: "Could not join the chat. Please try again.",
  chatJoinFailed: "Could not join the chat.",

  chatEmpty: "No messages yet.",
  chatEmptyDisplay: "There are no messages to show yet.",
  chatInputPlaceholder: "Write a message…",
  chatInputClosedPlaceholder: "You can only post around the time of the event",
  chatSendUrlNotAllowed: "This event does not allow posting URLs.",
  chatSendFailedOffline: "Could not send your message (not connected).",
  chatSendFailed: "Could not send your message.",

  chatHideMessage: "Hide this message",
  chatHideMessageConfirm: "Hide this message from the participants' view?",

  chatEventNotFound: "This event could not be found.",
  chatPageBackToEvent: "Back to the event page",
  chatPageScreenView: "Projector view",
  chatPageUnavailable:
    "The chat for this event is not available. It is open to confirmed participants, and only on events that have chat turned on.",

  screenMembersOnly: "Only confirmed participants can open this view.",
  screenChatUnavailable: "Chat cannot be shown for this event.",
  screenTextSmaller: "Smaller text",
  screenTextLarger: "Larger text",
  screenBackToChat: "Back to the chat page",
  panelToggleOpen: "Show chat and Q&A",
  panelToggleClose: "Hide chat and Q&A",
  panelHeading: "From the room",
  panelClose: "Close the panel",
  panelMembersOnly: "Only confirmed participants can use this.",
  panelChatUnavailable: "Chat is not available for this event.",

  qaHeading: "Q&A ({{n}})",
  qaIntro:
    "Ask what you want to know, and upvote the questions you want answered. The most upvoted questions come first.",
  // 案内のあとに続けて差し込むので、英語では区切りの空白を先頭に入れる
  qaAnonAll: " Questions at this event are posted anonymously.",
  qaRealAll: " Questions at this event are posted with your name.",

  qaPlaceholder: "Ask a question…",
  qaSubmit: "Ask",
  qaAnonToggle: "Post anonymously (organizers can still see who asked)",
  qaWillBeAnon:
    "This question will be posted anonymously (organizers can still see who asked)",
  qaWillBeReal: "This question will be posted with your name",
  qaAnonWarning:
    "At a small event, people may still be able to guess who asked.",

  qaClosed: "Q&A is not open for this event right now.",
  qaPostFailed: "Could not post your question.",
  qaLimit: "This event can have at most {{n}} questions.",
  qaUserLimit:
    "You can post at most {{n}} questions. Withdraw one of yours to make room.",
  qaPickFailed: "Could not change which question is on now.",

  qaEmpty: "No questions yet.",
  qaAnsweredCount: "Answered ({{n}})",
  qaVoteOne: "{{n}} vote",
  qaVotes: "{{n}} votes",
  qaVote: "Upvote this question",
  qaUnvote: "Remove your vote",

  qaAnonymous: "Anonymous",
  qaAnonWithAuthor: "Anonymous ({{name}})",
  qaAuthorStaffOnly: "Only organizers can see this",
  qaAuthorUnknown: "Unknown",
  qaMine: "You",

  qaPicked: "On now",
  qaPick: "Put this question on now",
  qaUnpick: "Clear the question on now",
  qaAnswered: "Answered",
  qaMarkAnswered: "Mark as answered",
  qaMarkUnanswered: "Mark as unanswered",
  qaHidden: "Hidden",
  qaHide: "Hide",
  qaUnhide: "Unhide",
  qaDeleteMine: "Withdraw your question",
  qaDeleteConfirm:
    "Withdraw this question? Its votes go with it, and this cannot be undone.",

  commentsHeading: "Comments ({{n}})",
  commentsEmpty: "No comments yet.",
  commentPlaceholder: "Add a comment… (Markdown is supported)",
  commentDelete: "Delete this comment",
  commentDeleteConfirm: "Delete this comment?",
  commentPostFailed: "Could not post your comment.",
  commentLimit: "An event can have at most {{n}} comments.",
  commentMembersOnly:
    "You need a confirmed registration for this event to comment.",

  feedbackHeading: "Feedback",
  feedbackIntro:
    "Send a like to anyone who made the event good. Only participants see this, and nobody is told who liked what.",
  likeOn: "Like",
  likeOff: "Remove your like",
  likeSelfDisabled: "You cannot like yourself",
  likeCaptionEvent: "This event",
  likeCaptionHost: "Host",
  likeCaptionCommunity: "Community",

  photoAdd: "Add photos",
  photoUploading: "Uploading… {{n}} left",
  photoUploadFailed: "Could not upload.",
  photoLimit: "An event can have at most {{n}} photos.",
  photosPublicNotice: "Anyone can see these photos.",
  photosMembersNotice: "Only people at this event can see these.",
  // 案内のあとに続けて差し込むので、英語でも先頭の空白を保つ
  photosDropHint: " You can also drag and drop, or paste (Ctrl/⌘+V).",
  photosPublicToggle: "Show the photos to people outside the event",
  photosEmpty: "No photos yet.",
  photosEmptyHint: " Use “Add photos”, or drag and drop, to share some.",
  photoDelete: "Delete this photo",
  photoCommentDelete: "Delete this comment",
  photoCommentPlaceholder: "Add a comment…",
  photoCommentLimit: "A photo can have at most {{n}} comments.",
  photoCommentMembersOnly: "You need to be at this event to comment.",
};

export const eventSocial = { ja, en };
