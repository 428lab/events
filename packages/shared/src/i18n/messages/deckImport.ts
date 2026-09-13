const ja = {
  title: "LLMで作る／取り込む", intro: "仕様入りプロンプトを普段のLLMへ渡し、返ったJSONを取り込めます。APIキーやサービス連携は不要です。",
  spec: "仕様を読む", downloadSpec: "仕様をダウンロード", prompt: "生成プロンプトをコピー", sampleTitle: "表紙サンプル", sampleBullets: "箇条書きサンプル", sampleComparison: "比較サンプル",
  raw: "スライドJSON", file: "JSONファイルを選ぶ", validate: "検証してプレビュー", validating: "検証中…", cancelValidation: "検証を中止", edit: "入力を直す", repair: "LLMへの修正依頼をコピー", download: "JSONをダウンロード",
  replace: "現在の入力を置き換えますか？", discard: "入力を破棄して一覧へ", discardConfirm: "このタブの取り込み記録を破棄しますか？保存済みのスライドは削除されません。",
  storage: "再読み込み用の保存領域を使えません。JSONをダウンロードし、利用可能なブラウザで再開してください。保存は送信していません（既に送信済みの場合、その結果は未確認のままです）。",
  recovery: "原稿の復旧はこのタブ内だけです。タブを閉じたり保存領域を失った場合は復旧できません。結果が不明なら新規保存せず、まずスライド一覧を確認してください。",
  wrongOwner: "別のアカウントの取り込み記録です。原稿は表示しません。元のアカウントでログインするか、このタブの記録を破棄してください。",
  bind: "この原稿を現在ログイン中のアカウントに結び付ける", bindConfirm: "現在のアカウントでこの原稿の保存を準備しますか？",
  signOutConfirm: "現在のアカウントからログアウトして、元のアカウントでログインし直しますか？原稿と保存キーはこのタブに保持します。",
  login: "ログインして保存", reviewed: "全ページを確認しました", publicCheck: "公開範囲の説明を確認し、同意します",
  publicNotice: "保存すると、URLを知る人はログインせず閲覧できます。編集途中や画像が空枠のページも閲覧できます。機密情報・個人情報をLLMやスライドに入れないでください。",
  save: "新規スライドとして保存", saving: "保存処理中。画面を閉じても保存されることがあります", pending: "結果未確認。入力と保存キーを保持しています。新規作成せず同じ保存を確認してください。",
  retry: "同じ保存を確認／再試行", open: "編集を開く", success: "保存しました。画像枠を選んで「画像を差し替え」できます。編集保存の成功後に発表してください。", restart: "別デッキとして取り込む", restartConfirm: "競合・削除済みの結果を確認しましたか？明示的に別の保存操作を開始します。",
  unavailable: "取り込みを利用できません。記録は保持しています。", conflict: "このキーで別の原稿が保存済みです。既存の編集画面を開いて確認してください。", deleted: "作成先は削除済みです。この操作で復活させることはありません。",
  forbidden: "権限またはOriginを確認してください。別キーでの自動再送はしません。", unauthorized: "同じアカウントで再ログインしてから、同じ保存を再試行してください。", quota: "日次上限です。{{n}}秒後に同じ保存を再試行できます。", rejected: "保存されませんでした（HTTP {{status}}）。入力・サイズ・形式を修正し再検証してください。",
  failure: "処理できませんでした。入力は保持しています。", syntax: "JSONオブジェクトだけを入力してください。説明・コードフェンス・末尾カンマ・重複キーを取り除いてください。", position: "{{line}}行 {{column}}列", encoding: "BOMのない正しいUTF-8を使い、不正なUnicode文字を取り除いてください。", tooLarge: "UTF-8で1,048,576 bytes以下に減らしてください。", fileType: "拡張子.jsonのファイルを1つ選んでください。", truncated: "先頭50件です。修正して再検証してください。",
  page: "{{n}}ページ目", element: "{{n}}番目の要素", previous: "前のページ", next: "次のページ", manual: "全ページを実際に確認してください。文字幅は端末により異なります。重なり・コントラスト・事実の正しさは自動判定しません。警告で自動修正はしません。",
  overflow: "文字が枠からあふれる可能性があります。文章を短くするか枠を広げてください。", empty: "空のページです。", whitespace: "空白だけの文章です。", placeholder: "画像の空枠です。保存後に画像を差し替えてください。", measureFailed: "文字の収まりを自動確認できません。手動で確認してください。",
  leave: "未保存の変更、または結果未確認の操作があります。この画面を離れますか？",
  unsaved: "未保存", editorSaving: "保存中", editorFailed: "保存失敗。再ログインが必要な場合はログイン後に再試行してください。", editorSaved: "保存済み", editorRetry: "保存を再試行", tabs: "同じスライドを複数タブで同時に編集しないでください。最新の変更の保存成功まで発表はできません。",
  repairIntro: "先ほどのevents-lab-deck version 1のJSONを修正してください。次の制約を満たし、説明や差分ではなく、必須キーを省略しない完全なJSONだけを再出力してください。",
  constraint: "指定の型・範囲・必須キーを仕様で確認してください。座標はx+w≤960、y+h≤540、寸法は20以上の整数です。例: x=800ならw≤160。",
};
const en: Record<keyof typeof ja, string> = {
  title: "Create with an LLM / import", intro: "Give the self-contained prompt to your usual LLM, then import its JSON. No API key or service connection is needed.",
  spec: "Read specification", downloadSpec: "Download specification", prompt: "Copy generation prompt", sampleTitle: "Title sample", sampleBullets: "Bullet sample", sampleComparison: "Comparison sample",
  raw: "Slide JSON", file: "Choose JSON file", validate: "Validate and preview", validating: "Validating…", cancelValidation: "Stop validation", edit: "Edit input", repair: "Copy repair request for LLM", download: "Download JSON",
  replace: "Replace the current input?", discard: "Discard input and return to list", discardConfirm: "Discard this tab's import record? Saved decks will not be deleted.",
  storage: "Reload storage is unavailable. Download the JSON and resume in a browser with storage available. No new save was sent (a previously sent operation remains unconfirmed).",
  recovery: "Recovery is limited to this tab. Closing it or losing storage may lose the draft. If a save result is unknown, check the deck list first; do not start another save.",
  wrongOwner: "This import belongs to another account. Its source is hidden. Sign in as the original account or discard this tab's record.", bind: "Associate this draft with the signed-in account", bindConfirm: "Prepare to save this draft using the current account?",
  signOutConfirm: "Sign out of the current account and sign in again as the original owner? This tab retains the source and save key.",
  login: "Sign in to save", reviewed: "I have checked every page", publicCheck: "I understand and accept the public visibility",
  publicNotice: "Once saved, anyone with the URL can view this deck without signing in, including unfinished pages and empty image frames. Do not put confidential or personal information in the LLM or slides.",
  save: "Save as a new deck", saving: "Saving. It may complete even if you close this page.", pending: "Result unconfirmed. The source and save key are fixed. Check the same save instead of creating another deck.", retry: "Check / retry the same save", open: "Open editor", success: "Saved. Select an image frame and replace its image. Present only after editing changes are acknowledged.", restart: "Import as a separate deck", restartConfirm: "Have you checked the conflict or deleted result? This explicitly starts a separate save operation.",
  unavailable: "Import is unavailable. Your record is retained.", conflict: "Different source was already saved with this key. Open the existing deck to check.", deleted: "The imported deck was deleted. This operation will not recreate it.", forbidden: "Check your permissions and Origin. A new key will not be generated automatically.", unauthorized: "Sign in again as the same account, then retry the same save.", quota: "Daily limit reached. Retry the same save in {{n}} seconds.", rejected: "Not saved (HTTP {{status}}). Correct the input, size or format and validate again.",
  failure: "Could not complete this operation. Your input is retained.", syntax: "Enter only one JSON object. Remove explanations, code fences, trailing commas and duplicate keys.", position: "Line {{line}}, column {{column}}", encoding: "Use valid UTF-8 without a BOM or invalid Unicode characters.", tooLarge: "Reduce the UTF-8 input to at most 1,048,576 bytes.", fileType: "Choose one file with a .json extension.", truncated: "First 50 issues shown. Correct them and validate again.",
  page: "Page {{n}}", element: "Element {{n}}", previous: "Previous page", next: "Next page", manual: "Check every page visually. Text width differs by device. Overlap, contrast and factual accuracy are not automatically judged. Warnings do not alter your content.", overflow: "Text may overflow. Shorten it or enlarge its box.", empty: "This page is empty.", whitespace: "This text contains only whitespace.", placeholder: "Empty image frame. Replace its image after saving.", measureFailed: "Text fit could not be checked automatically. Please check manually.",
  leave: "There are unsaved changes or an unconfirmed operation. Leave this page?", unsaved: "Unsaved", editorSaving: "Saving", editorFailed: "Save failed. If your session expired, sign in again before retrying.", editorSaved: "Saved", editorRetry: "Retry saving", tabs: "Avoid editing the same deck in multiple tabs. Present only after the latest changes are saved.", repairIntro: "Fix the previous events-lab-deck version 1 JSON using these constraints. Return the complete JSON with every required key, not explanations or a diff.", constraint: "Check the required keys, types and ranges in the specification. Coordinates require x+w≤960 and y+h≤540; sizes are integers ≥20. Example: when x=800, w≤160.",
};
const jaIssue = {
  required: "このキーは必須です。", unknown: "この未知のキーを削除してください。", type: "値の型を確認してください。数値・真偽値を引用符で囲まず、nullを使わないでください。",
  literal: "formatはevents-lab-deck、versionは数値1にしてください。", enum: "書体はdefault/serif/monospace、配置はleft/center/rightです。要素型はtext/image-placeholderです。",
  count: "ページは1〜60、各ページの要素は0〜50個にしてください。", elements: "全ページ合計1,000要素以下にしてください。", bounds: "右端x+wは960以下、下端y+hは540以下。例: x=800ならwは160以下にしてください。",
  range: "整数を使ってください。x:0〜940、y:0〜520、w:20〜960、h:20〜540、fontSize:12〜160。", unicode: "孤立サロゲートを含まない正しいUnicodeを使ってください。",
  length: "タイトルは1〜120、本文は1〜10,000 UTF-16単位です。絵文字の多くは2単位です。", color: "色は#172B24のような6桁RGBだけを使ってください。", titleRule: "タイトルの前後の空白・制御文字を取り除いてください。",
  textRule: "本文の制御文字は改行LFだけ許可します。タブ・CR・DEL等を取り除いてください。", totalText: "全text合計を100,000 UTF-16単位以下にしてください。", converted: "変換後の本文が1MiBを超えます。要素や文章を減らしてください。",
};
const enIssue: Record<keyof typeof jaIssue, string> = {
  required: "This key is required.", unknown: "Remove this unknown key.", type: "Check the value type. Do not quote numbers or booleans or use null.", literal: "Use format events-lab-deck and numeric version 1.", enum: "Fonts: default/serif/monospace; alignment: left/center/right; element types: text/image-placeholder.",
  count: "Use 1–60 slides and 0–50 elements per slide.", elements: "Use at most 1,000 elements in total.", bounds: "x+w must be ≤960 and y+h ≤540. Example: if x=800, w must be ≤160.", range: "Use integers: x 0–940; y 0–520; w 20–960; h 20–540; fontSize 12–160.", unicode: "Use valid Unicode without lone surrogates.", length: "Title: 1–120 UTF-16 units; text: 1–10,000. Most emoji count as two units.", color: "Use six-digit RGB colors such as #172B24.", titleRule: "Remove surrounding whitespace and control characters from the title.", textRule: "Only LF is allowed among control characters. Remove tabs, CR and DEL.", totalText: "Reduce all text to at most 100,000 UTF-16 units.", converted: "Converted content exceeds 1MiB. Reduce elements or text.",
};
const jaField = { x: "横位置", y: "縦位置", w: "幅", h: "高さ", text: "本文", fontSize: "文字サイズ", font: "書体", color: "文字色", background: "背景色", title: "タイトル", align: "配置", bold: "太字", italic: "斜体", type: "要素型", version: "版", format: "形式", slides: "ページ", elements: "要素" };
const enField: Record<keyof typeof jaField, string> = { x: "X position", y: "Y position", w: "Width", h: "Height", text: "Text", fontSize: "Font size", font: "Font", color: "Text color", background: "Background", title: "Title", align: "Alignment", bold: "Bold", italic: "Italic", type: "Element type", version: "Version", format: "Format", slides: "Slides", elements: "Elements" };
export const deckImport = { ja, en };
export const deckImportIssue = { ja: jaIssue, en: enIssue };
export const deckImportField = { ja: jaField, en: enField };
