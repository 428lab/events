/**
 * スライドと配信の文言 (#367)。
 *
 * 対象はスライドの一覧・編集・公開ビューア、配信セットの一覧・編集、
 * 配信コントロール、配信画面（OBS がウィンドウキャプチャする完成画面）。
 *
 * **スライドと配信でキャンバス編集の枠が同じ**（要素の追加・整列・重なり順・
 * Undo/Redo・自動保存）なので、2つに分けず1つの名前空間にまとめてある。
 * 分けると同じ文言が2か所に増える。
 *
 * ここに置かないもの:
 * - 見出しの「スライド」は `nav.decks`。ヘッダーの項目と同じ綴り・同じ意味
 * - 「削除」「読み込み中…」「背景」「フォント」「アップロード中…」
 *   「コピーしました」は `common.*`
 * - 「日程調整中」は `events.tabScheduling`
 * - 参加人数の並べ方は `common.participants`（配信画面のイベント情報も同じ）
 * - 発表画面（投影）は `eventRun.present*`、登壇者パネルは `eventSocial.panel*`。
 *   このグループの範囲だが #363 の2本目で先に拾ってある
 *
 * **スライド・シーンの中身は利用者が作ったデータなので訳さない。**
 * 訳すのは画面の枠だけ。新しいシーンの名前や「〜のコピー」のように
 * **保存される文字列**は #364 で方針を決めるまでコードに日本語のまま残す。
 *
 * 数の入れ替えは {{n}} を使う（`count` は i18next の複数形の仕組みを起動するため）。
 */
const ja = {
  /* ── スライドと配信で共通のキャンバス編集 ─────────────── */
  /** 編集画面から一覧へ戻る。スライドと配信セットで同じ綴り。矢印も辞書が持つ */
  backToList: "← 一覧",
  undoTip: "元に戻す (Ctrl/⌘+Z)",
  redoTip: "やり直す (Ctrl/⌘+Shift+Z)",
  saving: "保存中…",
  autoSaved: "自動保存",
  duplicate: "複製",
  /** サムネイル下の並べ替え。**英語は `common.moveUp` / `moveDown` と同じ**だが、
   *  日本語が「上へ移動」ではなく「上へ」なので寄せられない。善意で統合されると
   *  日本語が変わるので、`dictionary.test.ts` で分かれていることを固定してある */
  moveUpShort: "上へ",
  moveDownShort: "下へ",

  /** 要素の種類。追加ボタン・レイヤー一覧・プロパティの見出し・
   *  配信画面のプレースホルダーが同じ呼び名を使う */
  elementText: "テキスト",
  elementImage: "画像",
  elementCamera: "カメラ",
  elementDeck: "スライド",
  elementEventInfo: "イベント情報",

  textContent: "内容",
  /** 数と一緒に出るので1つの文言にする（全角コロンを画面側に書かない） */
  fontSizeValue: "文字サイズ：{{n}}",
  color: "色",
  alignLeft: "左",
  alignCenter: "中",
  alignRight: "右",
  replaceImage: "画像を差し替え",
  imageUrlLabel: "画像URL（直接指定）",
  imageUploadFailed: "画像のアップロードに失敗しました（6MBまで）",

  zOrder: "重なり順",
  toFront: "最前面",
  forward: "前面へ",
  backward: "背面へ",
  toBack: "最背面",
  deleteElement: "この要素を削除",

  /** 組み込みフォントの呼び名。欧文のフォント名（Noto Sans など）は訳さない */
  fontDefault: "標準ゴシック",
  fontSerif: "明朝（システム）",
  fontMono: "等幅",

  /* ── スライド（デッキ）─────────────────────────────── */
  /** 見出しは `nav.decks`。ここは1つのスライドを指すので英語が単数になる */
  newDeck: "新しいスライド",
  untitledDeck: "無題のスライド",
  /** 案内文はボタンの名前を差し込む。同じ文言を2か所に置かない */
  decksEmpty: "まだスライドがありません。「{{action}}」から作成できます。",
  deckTitlePlaceholder: "スライドのタイトル",
  deckNotFound: "スライドが見つかりません。",
  deckPublicViewer: "公開ビューア",
  deckNoPages: "このスライドにはまだページがありません。",
  deckFullscreen: "フルスクリーン",
  /** 利用者が作る数なので 1 もありうる（英語の単数用キーが要る） */
  pageCountOne: "{{n}} ページ",
  pageCount: "{{n}} ページ",
  /** 一覧の更新時刻。**スライドは「更新 {{time}}」、配信セットは
   *  「{{time}} 更新」**と元から並びが違う。日本語の綴りを変えないので
   *  キーを分けてある（英語はどちらも "Updated …"） */
  updatedAt: "更新 {{time}}",
  updatedAtSuffix: "{{time}} 更新",

  addPage: "＋ ページ追加",
  layersHeading: "レイヤー（前面が上）",
  layersEmpty: "要素なし",
  multiSelect: "複数選択",
  group: "グループ化",
  ungroup: "グループ解除",
  /** 英語も "1 selected" / "3 selected" で綴りが変わらないので単数用キーは無い */
  selectedCount: "{{n}}個を選択中",
  /** 呼び出し側が n > 1 のときだけ出す（1つのときは `deleteElement`）ので
   *  単数用キーは無い */
  deleteSelectedCount: "{{n}}個を削除",
  deckEditorHint:
    "要素を選ぶと編集できます。「{{text}}」「{{image}}」から追加し、ドラッグで移動・隅でリサイズ。Shift+クリックで複数選択。",
  /** 画像要素に URL が入っていないときのキャンバス表示 */
  imageUrlUnset: "画像URL未設定",

  /* ── 配信セット ─────────────────────────────────────── */
  /** 一覧の見出し。**英語だけ複数形**になるので、選択欄のラベル
   *  `liveSet`（単数）とはキーを分けてある */
  liveSets: "配信セット",
  liveSet: "配信セット",
  liveSetsLead:
    "配信画面のシーン一式（待機画面・OP・スライド＋カメラなど）を作って、イベントの配信で使い回せます。",
  newLiveSet: "新しい配信セット",
  untitledLiveSet: "無題の配信セット",
  liveSetsEmpty:
    "まだ配信セットがありません。「{{action}}」を押すと、待機画面・OP・スライド＋カメラなどの定番シーン入りで作成されます。",
  liveSetDuplicate: "このセットをベースに新規作成",
  /** 消す前の確認。配信セットと BGM の曲で同じ綴り */
  deleteConfirm: "「{{name}}」を削除しますか？",
  liveSetNotFound: "配信セットが見つかりません。",
  liveSetNamePlaceholder: "配信セット名",
  /** 利用者が作る数なので 1 もありうる（英語の単数用キーが要る） */
  sceneCountOne: "{{n}} シーン",
  sceneCount: "{{n}} シーン",

  addScene: "＋ シーン追加",
  sceneName: "シーン名",
  bgPreset: "プリセット",
  bgNightSky: "夜空",
  bgBlack: "黒",
  bgFestivalGradient: "夜祭グラデ",
  bgDuskGradient: "宵グラデ",
  bgWhite: "白",
  sceneBgm: "このシーンのBGM",
  sceneBgmHelp: "シーン切替時に自動で反映",
  sceneBgmKeep: "変更しない",
  sceneBgmStop: "BGMを停止",
  infoFieldLabel: "表示する情報",
  /** イベント情報の項目。編集画面の選択肢と、キャンバス上の見本を兼ねる */
  infoFieldTitle: "イベントタイトル",
  infoFieldDatetime: "開催日時",
  infoFieldParticipants: "参加人数",
  infoFieldCommunity: "コミュニティ名",
  /** キャンバス上の日時の見本。実際の日時は配信画面が差し込む */
  infoSampleDatetime: "2026/1/1 19:00 〜 21:00",
  cameraFitCover: "枠いっぱい",
  cameraFitContain: "全体表示",
  cameraRadiusValue: "角丸：{{n}}",
  cameraHint: "カメラ映像は配信画面タブで流し込まれます。",
  deckElementHint:
    "イベントで選択したスライドがここに表示されます。ページ送りはコントロール画面から。",
  liveEditorHint:
    "要素を選ぶと編集できます。上のボタンから追加し、ドラッグで移動・隅でリサイズ。カメラ・スライドの中身は配信画面で自動的に流し込まれます。",
  /** 画像要素に画像が入っていないときのキャンバス表示 */
  imageUnset: "画像未設定",

  /* ── 配信コントロール ───────────────────────────────── */
  controlHeading: "配信コントロール",
  controlStaffOnly: "この画面はスタッフ専用です。",
  openLiveScreen: "配信画面を開く",
  /** 案内文はボタンの名前を差し込む */
  obsHint:
    "「{{action}}」で出る画面を OBS の「ウィンドウキャプチャ」で取り込んでください（音声はデスクトップ音声）。シーンを切り替えると配信画面に約1秒で反映されます。",
  liveSetDefault: "デフォルト（ビルトイン）",
  editLiveSet: "セットを編集",
  allLiveSets: "セット一覧",
  scenesEmpty: "配信セットにシーンがありません。「{{action}}」から追加してください。",
  /** 選ばない選択肢。映すスライドと BGM の両方から引く */
  noneOption: "（なし）",
  deckToShow: "配信で映すスライド",

  bgmHeading: "BGM",
  bgmTrack: "曲",
  bgmStop: "停止",
  bgmPlay: "再生",
  bgmAdd: "曲を追加",
  bgmDelete: "この曲を削除",
  bgmVolume: "音量",
  bgmCopyCredit: "クレジットをコピー",
  bgmNote:
    "BGMは配信画面タブ側で鳴ります（OBSのデスクトップ音声が拾います）。クレジットは YouTube 概要欄に貼ってください。",
  bgmNamePrompt: "曲名（コントロールに表示されます）",
  bgmCreditPrompt: "クレジット表記（YouTube概要欄に貼る出典・ライセンス。省略可）",
  bgmUploadFailed:
    "アップロードに失敗しました（対応形式: mp3/m4a/ogg/wav、8MBまで）",

  /* ── 配信画面（本番で大写しになる画面）───────────────── */
  liveSetLoading: "配信セットを読み込み中…",
  deckUnselected: "スライド未選択（コントロール画面で選べます）",
  /** 日程未定のイベントの「開催日時」。`events.tabScheduling` と同じ綴りだが
   *  **あちらは一覧のタブ名**で、タブの言い方を変えたときに本番で大写しになる
   *  この画面が一緒に変わってはいけないので、わざと別に持つ (#367) */
  datetimeTbd: "日程調整中",
  bgmUnblock: "クリックして BGM を有効化",
  cameraDefault: "既定のカメラ",
  cameraWaiting: "カメラ待機中…",
} as const;

const en: Record<keyof typeof ja, string> = {
  backToList: "← Back to list",
  undoTip: "Undo (Ctrl/⌘+Z)",
  redoTip: "Redo (Ctrl/⌘+Shift+Z)",
  saving: "Saving…",
  autoSaved: "Autosaved",
  duplicate: "Duplicate",
  moveUpShort: "Move up",
  moveDownShort: "Move down",

  elementText: "Text",
  elementImage: "Image",
  elementCamera: "Camera",
  elementDeck: "Slide deck",
  elementEventInfo: "Event info",

  textContent: "Content",
  fontSizeValue: "Text size: {{n}}",
  color: "Color",
  alignLeft: "Left",
  alignCenter: "Center",
  alignRight: "Right",
  replaceImage: "Replace image",
  imageUrlLabel: "Image URL (enter directly)",
  imageUploadFailed: "Couldn't upload the image (up to 6 MB).",

  zOrder: "Layer order",
  toFront: "Bring to front",
  forward: "Forward",
  backward: "Backward",
  toBack: "Send to back",
  deleteElement: "Delete this element",

  fontDefault: "Default sans serif",
  fontSerif: "Serif (system)",
  fontMono: "Monospace",

  newDeck: "New slide deck",
  untitledDeck: "Untitled slide deck",
  decksEmpty: "You don't have any slide decks yet. Create one from “{{action}}”.",
  deckTitlePlaceholder: "Slide deck title",
  deckNotFound: "This slide deck was not found.",
  deckPublicViewer: "Public viewer",
  deckNoPages: "This slide deck has no pages yet.",
  deckFullscreen: "Full screen",
  pageCountOne: "{{n}} page",
  pageCount: "{{n}} pages",
  updatedAt: "Updated {{time}}",
  updatedAtSuffix: "Updated {{time}}",

  addPage: "+ Add page",
  layersHeading: "Layers (front on top)",
  layersEmpty: "No elements",
  multiSelect: "Multi-select",
  group: "Group",
  ungroup: "Ungroup",
  selectedCount: "{{n}} selected",
  deleteSelectedCount: "Delete {{n}} elements",
  deckEditorHint:
    "Select an element to edit it. Add one with “{{text}}” or “{{image}}”, drag to move it, and resize from the corners. Shift-click to select several.",
  imageUrlUnset: "No image URL set",

  liveSets: "Broadcast sets",
  liveSet: "Broadcast set",
  liveSetsLead:
    "Build a set of broadcast scenes (standby, opening, slides with camera, and so on) and reuse it across your events.",
  newLiveSet: "New broadcast set",
  untitledLiveSet: "Untitled broadcast set",
  liveSetsEmpty:
    "You don't have any broadcast sets yet. “{{action}}” creates one that already has the usual scenes: standby, opening, slides with camera, and more.",
  liveSetDuplicate: "Create a new set based on this one",
  deleteConfirm: "Delete “{{name}}”?",
  liveSetNotFound: "This broadcast set was not found.",
  liveSetNamePlaceholder: "Broadcast set name",
  sceneCountOne: "{{n}} scene",
  sceneCount: "{{n}} scenes",

  addScene: "+ Add scene",
  sceneName: "Scene name",
  bgPreset: "Preset",
  bgNightSky: "Night sky",
  bgBlack: "Black",
  bgFestivalGradient: "Festival gradient",
  bgDuskGradient: "Dusk gradient",
  bgWhite: "White",
  sceneBgm: "Background music for this scene",
  sceneBgmHelp: "Applied automatically when you switch to this scene",
  sceneBgmKeep: "Leave unchanged",
  sceneBgmStop: "Stop the music",
  infoFieldLabel: "Information to show",
  infoFieldTitle: "Event title",
  infoFieldDatetime: "Date and time",
  infoFieldParticipants: "Number of participants",
  infoFieldCommunity: "Community name",
  infoSampleDatetime: "1/1/2026, 07:00 PM – 09:00 PM",
  cameraFitCover: "Fill the frame",
  cameraFitContain: "Show all",
  cameraRadiusValue: "Corner radius: {{n}}",
  cameraHint: "The camera feed is filled in on the broadcast screen tab.",
  deckElementHint:
    "The slide deck picked for the event shows up here. Change pages from the control screen.",
  liveEditorHint:
    "Select an element to edit it. Add one from the buttons above, drag to move it, and resize from the corners. Camera and slide contents are filled in automatically on the broadcast screen.",
  imageUnset: "No image set",

  controlHeading: "Broadcast control",
  controlStaffOnly: "This screen is for organizers only.",
  openLiveScreen: "Open the broadcast screen",
  obsHint:
    "Capture the window that “{{action}}” opens with OBS Window Capture (take the sound from desktop audio). Switching scenes reaches the broadcast screen in about a second.",
  liveSetDefault: "Default (built-in)",
  editLiveSet: "Edit this set",
  allLiveSets: "All sets",
  scenesEmpty: "This broadcast set has no scenes. Add one from “{{action}}”.",
  noneOption: "(None)",
  deckToShow: "Slide deck to show",

  bgmHeading: "Background music",
  bgmTrack: "Track",
  bgmStop: "Stop",
  bgmPlay: "Play",
  bgmAdd: "Add a track",
  bgmDelete: "Delete this track",
  bgmVolume: "Volume",
  bgmCopyCredit: "Copy the credit line",
  bgmNote:
    "The music plays on the broadcast screen tab, so OBS picks it up from desktop audio. Paste the credit line into your YouTube description.",
  bgmNamePrompt: "Track name (shown on the control screen)",
  bgmCreditPrompt:
    "Credit line (source and license to paste into a YouTube description; optional)",
  bgmUploadFailed:
    "Couldn't upload the file (mp3/m4a/ogg/wav, up to 8 MB).",

  liveSetLoading: "Loading the broadcast set…",
  deckUnselected: "No slide deck selected (pick one on the control screen)",
  datetimeTbd: "Date TBD",
  bgmUnblock: "Click to enable the music",
  cameraDefault: "Default camera",
  cameraWaiting: "Waiting for the camera…",
};

export const studio = { ja, en };
