# LLM生成スライドのJSON取り込み設計（#523）

- 状態: **設計レビュー待ち。実装・配備・mainマージの承認ではない。**
- Issue: https://github.com/428lab/events/issues/523
- 正本: `design/lab-llm-slides-523` ブランチの本Markdown。Issue・PRにはリンクだけを置き、本文を複製しない。
- 今回の成果は設計のみ。以下の「採用」「追加」は将来の実装契約であり、現行機能との区別を各節で示す。

## 1. 最短の利用者体験（採用）

1. `/decks` の既存「新規作成」の隣の **「LLMで作る／取り込む」** → `/decks/import`。
2. 「生成プロンプトをコピー」で、仕様込みの日本語プロンプトを普段のLLMへ渡し、テーマ等を埋める。アプリへのAPIキー登録も課金接続も不要。
3. LLMから返ったJSONを貼り付けるか `.json` を1ファイル選び、「検証してプレビュー」。この時点ではサーバー保存しない。
4. 全ページのサムネイル・拡大表示と修正エラー／警告を確認する。入力に戻るか、LLMへ修正指示をコピーできる。
5. 「全ページを確認しました」と公開範囲の確認をチェックして **「新規スライドとして保存」**。成功後だけ既存の `/decks/:id/edit` に移動。
6. 文章・位置を直す。画像枠を選択して「画像を差し替え」→手元の画像をアップロード。編集内容の保存成功を確認し、`/d/:slug` を開いてページ送り・全画面で発表。

保存確認の文言: **「保存すると、URLを知る人はログインせず閲覧できます。編集途中や画像が空枠のページも閲覧できます。機密情報・個人情報をLLMやスライドに入れないでください。」** 公開承認チェックは説明への同意であり、非公開／公開フラグではない。通知メール・外部投稿は行わない。

## 2. 現行の根拠と差分

確認基準: `origin/main` **`734d78f12133b9c3c8a31e0e754f1560bbbef1ab`**。ソース確認であり稼働環境の操作確認ではない。下記パスはこのコミットに対するもの。

| 現行ソース | 確認した事実 | この設計での扱い |
| --- | --- | --- |
| `packages/shared/src/decks.ts` | 960×540。`DeckContent={slides}`、ページはid/background/elements、要素はtext/image。300ページ・200要素/ページ・textは10,000 UTF-16コード単位まで。座標の範囲制限やstrictな未知項目拒否はない | 内部schemaを公開入力に流用せず、より狭いstrict v1から変換する |
| `apps/server/src/routes/decks.ts` | `/api/decks` はrequireAuth。POSTはtitleだけ、PATCHはowner限定 | 新規取り込み専用POSTを認証境界内に追加。既存POST/PATCH契約を変えない |
| `apps/server/src/db/repositories/decks.ts`、`migrations/0013_decks.sql` | createは空要素の1ページをINSERT後に取得。slugは10桁hex、unique。本文はTEXT。公開状態列なし | 完成本文と再試行記録を一つの原子的batchで作る。空デッキ作成→PATCHは使わない |
| `apps/server/src/db/client.ts` | D1 `batch` を原子的な複数文実行として提供 | これを再利用。独自ジョブ基盤・外部ストアなし |
| `apps/server/src/routes/public.ts` | `/api/public/decks/:slug` は認証不要でDeckを返す | 作成成功の瞬間から公開閲覧可能。既存の公開応答は変更しない |
| `apps/server/src/worker.ts` | 全API共通bodyLimitは通常8MiB、動画だけ別枠。門は一枚という制約 | 取り込みPOSTのときだけ1MiBに分岐。ルートにbodyLimitを重ねない |
| `apps/web/src/pages/DecksPage.tsx`、`App.tsx`、`api/deckHooks.ts` | 一覧から通常の空デッキ作成。取り込み入口なし | 専用画面・専用hookを追加 |
| `DeckEditorPage.tsx`、`lib/editor/useAutoSave.ts` | 読込直後は保存せず、変更800ms後にPATCH。現行表示はisPendingでなければautoSavedで、失敗表示とは区別されていない | プレビューでエディタをマウントしない。発表前に成功を確認できるよう、deck編集側の保存状態だけ必要最小限修正（§6） |
| `components/SlideStage.tsx` | React文字列描画、中央縦揃え、line-height 1.3、pre-wrap、break-word、overflow hidden。配列後方が前面。srcのないimageは灰色の空枠 | 描画を再利用。空枠用の新要素型／画像ファイル不要 |
| `components/DeckElementPanel.tsx`、`lib/editor/useImagePicker.tsx`、`routes/deckImages.ts` | imageを選べばsrcなしでも差し替え可能。アップロード成功後にsrcだけpatch。owner限定、画像6MiB。手入力の外部画像URL欄も既存機能として存在 | 空枠差し替えをそのまま使う。取り込み由来の外部取得禁止と、人が保存後に使う既存URL入力は別の境界 |
| `lib/deckFonts.ts` | 空文字/serif/monospaceはensureDeckFontで外部取得しない。それ以外は外部フォントCSSを追加 | v1はこの3値への写像のみ。アプリ全体の既存フォント通信禁止を意味しない |
| `DeckViewerPage.tsx`、`docs/slide-editor.md` | 既存描画でページ送り・全画面。編集は画面と純関数／共通hookを責務分割済み | 発表・編集の作り直し、配信セット側への取り込み抽象化をしない |

## 3. 公開JSON v1契約（採用・規範）

### 3.1 解析と共通規則

- UTF-8のJSONオブジェクト1個だけ。BOM、不正UTF-8、コメント、末尾カンマ、Markdownコードフェンス、前後の説明文、重複オブジェクトキーを拒否。前後のJSON空白（SP/TAB/LF/CR）は許可。
- 貼り付けとファイルとも元のUTF-8総量 **1,048,576 bytes（1MiB）以下**。空入力はエラー。解析前に計測。ファイルは`File.size`確認後、fatal UTF-8 decoderを使う。貼り付けは孤立サロゲートを先に拒否してからTextEncoderで計測。
- デコードした全文字列にも孤立サロゲートを許可しない。文字数はJavaScript `.length` と同じUTF-16コード単位（絵文字の多くは2）。Unicode正規化・trim・改行置換はしない。
- 各オブジェクトは以下に列挙したキーが**すべて必須**。任意キーはない。未知キーはネスト内も拒否。省略時の既定値補完、null、文字列から数値／真偽への変換、無言の削除は行わない。
- 数値はJSON numberで有限の整数。`1.0`や`1e2`も数学的に整数なら許可。NaN/Infinityや`1e309`は拒否。`-0`は0として扱う。配列順がページ順・背面から前面への描画順。
- 解析時に最大コンテナ深度を **6**（root object=1、slides array=2、slide=3、elements array=4、element=5）に制限し、未知キーに巨大な深い値がある場合も早期拒否。重複キー・不正文字列・深度の検出は両環境共通の上限付きJSONパーサーで行い、単なるJSON.parseのlast-key-winsに頼らない。

### 3.2 キー一覧

| オブジェクト | 必須キーと値 |
| --- | --- |
| root | `format`:文字列`"events-lab-deck"`のみ、`version`:数値`1`のみ、`title`:下記文字列、`slides`:ページ配列 |
| slide | `background`:色、`elements`:要素配列 |
| text要素 | `type`:文字列`"text"`、`x`,`y`,`w`,`h`:座標寸法、`text`:本文、`fontSize`:文字サイズ、`font`:書体、`color`:色、`bold`,`italic`:boolean、`align`:配置 |
| 画像空枠要素 | `type`:文字列`"image-placeholder"`、`x`,`y`,`w`,`h`:座標寸法だけ |

| 値／件数 | 厳密な範囲 |
| --- | --- |
| title | 1〜120コード単位。U+0000〜001F、U+007Fを禁止。前後にECMAScript `trim()`対象の空白を含めない（含む場合エラー）。空白だけも不可 |
| text | 1〜10,000コード単位、かつ全text合計100,000以下。U+0000〜001FはLF（U+000A）のみ許可、U+007F禁止。空白だけも許可（警告）。箇条書きは`・`等の文字と`\n`。Markdown/HTMLの意味解釈なし |
| 色（background/color） | 正規表現 `^#[0-9A-Fa-f]{6}$`。RGB 6桁のみ。大小文字とも保持。透明色、色名、3/8桁hex、rgb()、url()、グラデーション不可 |
| font | `"default"` / `"serif"` / `"monospace"` のみ。任意CSS／URL／フォント名不可 |
| fontSize | 整数12〜160、960×540座標系でのCSS px。ptではない |
| align | `"left"` / `"center"` / `"right"` のみ。縦揃えは既存の中央固定 |
| x,y,w,h | 整数。`0 ≤ x ≤ 940`、`0 ≤ y ≤ 520`、`20 ≤ w ≤ 960`、`20 ≤ h ≤ 540`、かつ `x+w ≤ 960`、`y+h ≤ 540`。回転なし |
| slides | 1〜60ページ |
| elements | 各ページ0〜50要素、全ページ合計1,000要素以下。空ページは許可するが警告 |

上限を現行300×200より絞る理由は、対話型LLMの短い発表原稿を保存前に全ページ確認でき、DOM・検証・本文サイズを抑えるため。100,000コード単位上限と1,000要素上限は両方適用する。1MiBに収まっていても件数超過は拒否。1MiBは入力の整形空白や日本語UTF-8を含めた余裕であり、巨大デッキの一括移行用途ではない。

特に `id` / `ownerId` / `slug` / `createdAt` / `updatedAt` / `content` / `src` / `url` / `fontFamily` / `rotation` / `groupId` / `notes` / `layout` / `alt` は受け取らない。外部画像・data URL・base64・メディアIDの埋め込み経路はない。本文にURLやHTMLらしい文字があっても文字としてのみ表示し、リンク化・取得・実行しない。

### 3.3 公開配布物

実装時に匿名で取得できる固定パス `/deck-import/v1/spec.md`、`schema.json`、`prompt.txt`、`sample-title.json`、`sample-bullets.json`、`sample-comparison.json` を同じ版の一組として配信する（これらのファイルは今回は作らない）。UIにも仕様リンク・仕様ダウンロード・プロンプトコピー・サンプル選択を置く。プロンプトは仕様リンクが読めないLLMにも渡せる自己完結型とする。

JSON SchemaはDraft 2020-12、全objectでadditionalProperties=false、required全列挙、要素oneOfを使用。サイズ合算・UTF-16計数・座標和・UTF-8総量・重複キー等はSchemaだけでは保証できないので、specと共通バリデーターの追加制約も必須と明記する。SchemaのmaxLengthはコードポイント計数のためUTF-16上限の代替ではない。配布Schema単体の合格を保存可能の保証とはしない。将来実装時は同じ共通定義から配布物を照合する。v1の受理範囲や意味を後から拡張せず、新機能は別version。未知versionは拒否する。

### 3.4 完全な小さい有効JSON例（表紙＋画像枠）

```json
{
  "format": "events-lab-deck",
  "version": 1,
  "title": "地域勉強会のはじめ方",
  "slides": [
    {
      "background": "#FFFFFF",
      "elements": [
        {
          "type": "text",
          "x": 48,
          "y": 48,
          "w": 864,
          "h": 96,
          "text": "地域勉強会のはじめ方",
          "fontSize": 44,
          "font": "default",
          "color": "#172B24",
          "bold": true,
          "italic": false,
          "align": "left"
        },
        {
          "type": "text",
          "x": 48,
          "y": 180,
          "w": 424,
          "h": 240,
          "text": "・テーマを一つ決める\n・小さく集まる\n・次の予定を決める",
          "fontSize": 28,
          "font": "default",
          "color": "#172B24",
          "bold": false,
          "italic": false,
          "align": "left"
        },
        {
          "type": "image-placeholder",
          "x": 520,
          "y": 180,
          "w": 392,
          "h": 240
        }
      ]
    }
  ]
}
```

これはレイアウト名ではなく座標の雛形。表紙用サンプルは見出し＋副題、箇条書き用は見出し＋本文、比較用は見出し＋左右text＋空枠の計3種類を将来同じ契約で配布する。例の余白・色はサンプル内容であり、アプリのテーマ変更ではない。

### 3.5 コピペ可能な日本語LLMプロンプト

```text
あなたはevents labへ取り込むスライドJSONの原稿作成者です。
以下の【依頼】を編集して使います。特定LLMのAPIや外部サービス連携は不要です。
【依頼】
テーマ: 地域勉強会のはじめ方
対象者: 初めて主催する人
発表時間: 5分
ページ数: 3
伝えたいこと: 小さく始めて継続する

【出力】
説明、Markdownコードフェンス、コメントを付けず、JSONオブジェクト1個だけ返してください。
rootのキーはformat,version,title,slidesだけで全部必須。
formatは"events-lab-deck"、versionは数値1。
titleは1〜120 UTF-16コード単位、前後の空白と制御文字は禁止。
slidesは1〜60個。各ページのキーはbackground,elementsだけで両方必須。
backgroundと文字colorは#RRGGBBの6桁RGB色（大小文字可）。
elementsは各ページ0〜50個、全体で1,000個以下。配列の後ろが前面。
キャンバスは960×540。全座標・寸法・文字サイズは有限の整数px。
xは0〜940、yは0〜520、wは20〜960、hは20〜540、必ずx+w<=960、y+h<=540。
要素は次の2種類だけ。各種類のキーは全て必須、他のキーは一切禁止。
1) text: type,x,y,w,h,text,fontSize,font,color,bold,italic,align
   type="text"、textは1〜10,000 UTF-16コード単位（全text合計100,000以下）。
   fontSizeは12〜160。fontは"default","serif","monospace"のいずれか。
   boldとitalicはJSONのtrue/false。alignは"left","center","right"のいずれか。
   textでは改行LFだけ許可し、その他U+0000〜001FとU+007Fの制御文字は禁止。
   箇条書きは「・」とJSONの\nを使ったプレーンテキスト。HTMLやMarkdown装飾は使わない。
2) 画像空枠: type,x,y,w,hのみ。type="image-placeholder"。
   画像は人が保存後に差し替えるのでsrc,url,alt,base64等を追加しない。
未知キー、null、内部ID、所有者、slug、時刻、fontFamily、回転、groupId、ノート、
レイアウト名、図形、外部画像・フォント・CSS・data URL・メディアIDを生成しない。
数値やbooleanを引用符で囲まない。キーの重複、末尾カンマ、不正Unicode、BOMは禁止。
空白込みのUTF-8出力全体を1,048,576 bytes以下にする。
UTF-16では絵文字の多くは2単位。ページ数は依頼の数を守り、上限を超える依頼は上限内に収める。

【読みやすさ】
短い文章と余白を優先し、見出し36〜48px、本文24〜32px程度を使う。
文字は枠内で縦中央、行の高さはfontSize×1.3、長い語は折り返される。
自動縮小されず、はみ出しは隠れるため、十分なw,hを確保する。
背景と文字のコントラストを確保し、意図のない重なりを避ける。
秘密・個人情報を含めず、数値や事実を捏造しない。不確かな内容は省く。
保存するとURLを知る人に公開される原稿であることに注意する。
最後に全必須キー、型、座標和、件数、文字量、外部アセット不使用を自己確認し、JSONだけ出力する。
```

## 4. 内部DeckContentへの変換と画像

- 変換器を`packages/shared/src/deckImport.ts`（新規予定）に置く。入力検証後のv1型だけを引数とし、titleは別、contentは`{slides:[...]}`として出す。内部Deck丸ごとのmerge／object spreadで未知項目を混入させない。
- 各slideはid/background/elements。textはtype=`text`、x/y/w/h/text/fontSize/color/bold/italic/alignをそのまま、fontを `default→fontFamily:""`、`serif→"serif"`、`monospace→"monospace"` に写す。rotation=0、groupIdは省略。
- image-placeholderは **`{id,type:"image",x,y,w,h,rotation:0}`** に変換、srcはキーごと省略。ラベルは現在の `studio.imageUrlUnset` 描画で、入力由来の説明文字は保存しない。これは既存schemaが許す状態であり、新しい内部型・画像素材・移行は不要。
- IDは入力不可。保存時にサーバーがdeck・各slide・各elementへ`crypto.randomUUID()`、slugは現行同様10桁hexを採番。previewのみ`preview-slide-1`、`preview-element-1-1`等の決定的な仮ID（1起算）を使い、保存APIに渡さない。採番関数を変換器へ注入し、それ以外は同じ変換にする。
- 座標・順序・文字・色の自動補正／レイアウト再計算はしない。変換後に既存deckContentSchemaでも再検証し、`JSON.stringify(content)`のUTF-8が1MiB以内であることをサーバーでも検証。万一超える場合は422 `converted_too_large`、要素や本文を減らすよう案内する。
- 保存後は空枠をキャンバスまたはレイヤー一覧で選ぶ→既存の「画像を差し替え」→画像アップロード成功後に同じelement.idのsrcだけ変更。座標・寸法・順序を維持しobjectFit=containで表示。選択取消／アップロード失敗ではsrcを変えず、再選択できる。本文PATCHの成功まで画像が保存されたとは表示しない。未差し替え枠は公開ビューアでも灰色の枠のまま。
- italicは現行描画・データにあるが編集パネルに切替UIはない。v1では保持する。斜体切替UIの追加は対象外で、必要なら原稿でfalseに直す。文章／位置／サイズ／色／太字／書体／画像は既存操作で編集可能。

## 5. 画面・検証・状態遷移

### 5.1 画面構成と未保存領域

`/decks/import` は匿名でも仕様コピー・入力・検証・previewまで使える。保存にはログインを要求する。上から①仕様とプロンプト、②貼付textarea／ファイル選択、③検証結果、④全ページ一覧と選択ページ拡大、⑤確認と保存。狭い画面は同じ順の縦積み、既存MUI・辞書（日英）を使い新テーマは導入しない。

ファイル選択は`.json`の1個（拡張子は大文字小文字不問、MIMEは参考のみ）。複数／違う拡張子／大きすぎるファイル／不正UTF-8は元の入力を残しエラーにする。読み込み成功時にtextareaを置換して同じ検証経路へ進む。元入力があれば置換前に確認。ユーザー入力に対する自動検証・自動アップロード・自動保存はない。

| 状態 | 操作／遷移と制約 |
| --- | --- |
| 入力中 | 生成物の貼付、ファイル、サンプル読み込み。「検証」で入力revisionを固定し検証中へ。空入力では無効 |
| 検証中 | 保存不可。連打無効。中止／入力変更で結果revisionを無効にし、古い結果を表示しない。検証は上限付きworkerで行い主スレッドを占有しない |
| 修正が必要 | 保存不可。エラー概要へfocus。原文は保持。「入力を直す」「LLMへの修正依頼をコピー」「JSONをダウンロード」が使える |
| プレビュー | 全ページ番号付きサムネイル（遅延描画）と拡大表示、警告一覧。前後キー・ページ選択可能。全文編集・画像選択はここでは不可。入力を変えるとpreviewと確認チェックを破棄して再検証 |
| 保存準備 | エラー0かつpreview全ページが選択可能になったら、全ページ確認と公開範囲の2チェックを有効化。閲覧履歴による強制ページ踏破はしない。匿名なら「ログインして保存」から認証後同じ画面へ戻り、チェックをやり直す |
| 保存中 | 入力・確認・保存・取消を無効化。スピナー＋「保存処理中。画面を閉じても保存されることがあります」。同時要求は1本。20秒でUI待機を打ち切り「結果未確認」へ（サーバー取消を意味しない） |
| 結果未確認 | 入力と保存キーを固定して保持。「同じ保存を確認／再試行」だけを許す。新規キーへの切替・入力修正・二重作成はさせない。離脱は警告付きで可能、次回同じタブで復旧する |
| 保存成功 | idを確認して一覧queryをinvalidate、原稿をブラウザ領域から削除しreceiptだけ保持、editorへreplace遷移。成功画面を戻る操作で再送しても同じreceiptの「編集を開く」になる |
| 保存拒否が確定 | 400/413/415/422は原稿保持して修正へ。401は同じ所有者で再ログインし同じキー再試行。429は待機し同じキー。403は権限／Origin案内で保存不可。409/410は§7の対応。通信失敗・5xxは必ず結果未確認 |

保存前の取消は「入力を破棄して一覧へ」で確認し、メモリ／sessionStorageを消す。永続deck/R2は変わらない（通常のログイン・アクセス計測は別）。保存中／結果未確認では「保存の取消」は提供せず、離脱だけを案内。後からサーバー成功を削除で補償しない。

### 5.2 再読み込み・認証・重複タブ

- 原稿は送信前から**タブ単位のsessionStorage**に1件だけ保存（raw JSON、入力revision、認証後のownerId、送信時のkey、状態）。ログやURL、localStorage、サーバー下書きに置かない。送信前に書込／読戻し確認できなければ保存を止め、「再読み込み用の保存領域を使えません。JSONをダウンロードし、利用可能なブラウザで再開」と示す。保存されないまま送信するフォールバックはない。
- 再読み込み後、未送信原稿は入力状態で復元し、検証と確認を再実行。送信済み／未確認は送信前に永続化した同じrawとkeyで復元し、自動POSTせず確認／再試行ボタンを出す。成功receiptがあれば新規作成せず既存editorへ進む。
- ownerIdが現在のユーザーと違えば元原稿を画面に出さず、元ユーザーでログインするかローカル記録を破棄する。別アカウントへ同じ保存操作を引き継がない。認証前原稿は認証後のユーザーへ明示確認の上で結び付ける。
- タブ複製が送信済みsessionStorageをコピーした場合は同一keyなので同一deckへ収束する。独立タブ／未送信タブでそれぞれ新規保存を明示した場合は別操作＝別deck。本文ハッシュだけで意図した複製を禁止しない。
- タブを閉じた／ブラウザがsessionStorageを失った場合の原稿復旧は保証しない。画面にその旨とJSONダウンロード導線を常設。結果未確認で領域を失った場合は**まずスライド一覧を確認**し、結果不明のまま新規保存しないよう案内する。ブラウザ状態喪失後の同一性推測・自動重複削除は対象外。

### 5.3 修正できるエラーとpreview警告

構文エラーは1件、byte位置から求めた1起算の行・列（列はUTF-16単位）と「JSONだけを貼る」「末尾カンマを消す」等を表示。構造エラーは決定的な入力順で最大50件、`truncated:true`なら「先頭50件。直して再検証」を表示。パスは0起算の`slides[2].elements[1].w`、UIは「3ページ目／2番目の要素／幅」。未知キーも同じ経路。値そのものをHTML表示・ログ送信しない。

例: `slides[2].elements[1].w` / `out_of_bounds` / 「右端が960を超えます。x=800ならwは160以下にしてください」。修正依頼ボタンは版、エラーのパス・制約・修正例だけをコピーする（原稿やユーザー情報は自動コピーしない）。原稿は利用者が自分のLLM会話に既に渡したものを使う。

```text
先ほどのevents-lab-deck version 1のJSONを修正してください。
エラー: slides[2].elements[1].w（3ページ目、2番目の要素の幅）
制約: x+wは960以下、wは20以上の整数。例: xが800ならwを160以下にする。
このエラーと関連配置を直し、他の内容はなるべく保ち、全体を再検証してください。
差分や説明でなく、必須キーを省略しない完全なJSONだけを再出力してください。
```

previewは`SlideStage`を使用し、editor/history/useAutoSaveを一切マウントしない。全ページを小分けに測定し、寸法は960×540基準。文字あふれ判定は同じfont/weight/style/width/lineHeight/whiteSpace/wordBreakを持つ非表示の測定用textブロックを高さautoで置き、自然高>h+1pxまたはscrollWidth>w+1pxを警告する（単なる既存overflow hidden要素のscrollHeight頼みにはしない）。空ページ、空白だけtext、画像空枠も警告。検出不能／測定失敗は「文字の収まりを自動確認できません」と表示し手動確認を求める。

警告は保存を妨げず、自動縮小・切捨てはしない。重なり・低コントラスト・事実誤りは自動合否判定しない。OS／ブラウザ／font fallbackにより文字幅が異なるため、全ページを実際に見て確認する案内を残す。サーバーは構造検証のみで、ブラウザの警告・チェック値をセキュリティ判断に使わない。

## 6. 保存後の編集と発表の境界

保存APIの成功後、既存GETでサーバーのDeckを読み、既存editorの初回ロード抑制を使う。取り込みrawやpreview IDでeditorのcontentを上書きしない。編集は通常のowner限定PATCHで、v1の狭い制約を既存編集データ全体へ後付けしない。

「自動保存済み」が失敗でも出る現状のままでは最短体験の最後を保証できないため、**deck編集画面の保存表示・再試行だけを本機能に必要な変更として含める**。配信エディタや全アプリの保存基盤改修はしない。

- deck側でcontent/titleの編集revisionと最後にACKされたrevisionを持つ。未保存／保存中／保存失敗／保存済みを区別し、初回GET内容は保存済み。
- PATCHは同じタブで常に1本、送信中の後続編集は最新snapshot1件に集約。成功したrevisionだけをACKし、後続があれば次を送る。失敗時は自動無限再試行せず最新snapshotを保持、「保存を再試行」を表示。同じsnapshotの再PATCHは同一deckの更新で新規作成しない。
- 最新revisionのACKまで発表ボタンを無効化し、失敗／未保存離脱時は警告する。認証切れは再ログイン後の再試行。画像アップロード成功だけではACKとしない。
- 複数タブ間の通常編集は現行のlast-write-winsを維持し、同時編集は避ける旨を案内。新しい汎用楽観ロックは対象外。取り込み再試行は保存後の編集を巻き戻さない（§7）。既に開かれた配信／公開画面の再取得問題は#374のまま。

## 7. 新規保存API・原子性・再試行（採用）

### 7.1 選択理由

| 案 | 評価 |
| --- | --- |
| 既存POST→PATCH＋失敗時DELETE | 空デッキが一時公開され、DELETEも失敗し得る。POST応答喪失ではidが分からず重複。採用しない |
| 既存POSTにcontentを追加するだけ | 空デッキ問題は消せるが応答喪失・連打の重複を解決しない。通常作成契約まで広げる必要もない |
| **専用POST＋完成本文の原子作成＋owner内idempotency記録** | 最小の追加APIと小さな追加テーブルで、ブラウザ再読込・並行送信を含め同じ保存を一意にできる。採用 |

既存デッキの上書き・追記・mergeは一切ない。再生成の新規保存は別keyを使う別deckであり、以前のdeckは変更しない。

### 7.2 HTTP契約

**`POST /api/decks/import`**。既存deckRoutesのrequireAuth配下、`/:id`系より先に明示登録。

- セッションcookie、`Content-Type: application/json`（charsetは省略またはutf-8のみ）、`X-Deck-Import-Key: <小文字canonical UUID v4>`。keyはUIが初回保存クリック時に一度だけ採番する内部の操作識別子で、LLM入力ではない。
- bodyは§3の**元UTF-8 JSONそのもの**。envelope、DeckContent、ユーザー指定IDは送らない。JSON.stringifyで再整形しない。§3.4の例をそのままbodyとして使用できる。
- same-origin UI専用。OriginはリクエストURLと同じoriginを必須とし、不在／null／不一致は403 `forbidden_origin`。CORS許可を追加しない。CSRF対策をCookie SameSiteだけに依存しない。公開仕様を配ることは書込APIの匿名開放ではない。
- 新規作成成功 **201**、同一操作の再送 **200**。両方とも `{ "id": "<deck UUID>", "slug": "<10桁hex>", "replayed": false }`（再送はtrue）。Locationは`/api/decks/<id>`。タイトル・本文・ownerIdを応答に複製しない。editorは既存GETで最新内容を読む。成功応答はサーバー検証・原子保存の完了を意味する。
- 応答はCache-Control: no-store。クライアントは20秒timeout・自動mutation retryなし。ユーザー操作の再試行で同じraw/keyを送る。API hookはraw/headerが必要なので取り込み専用fetchで既存ApiError/NetworkErrorへ変換し、共通JSON APIを全体改造しない。

エラーの基本形は既存と同じ`{error: string}`。検証用は追加で`issues:[{path,code,message,example?}]`、`truncated:boolean`、構文用は`line,column`、容量用は`maxBytes`を付ける。issuesは最大50、messageは固定テンプレート、unknown key表示は80コード単位で打ち切り、応答全体64KiB以下。原稿・認証情報を返さない。bodyLimitの既存簡易413もUIで同じ容量エラーへ解釈する。

| HTTP / error | 意味とクライアント対応 |
| --- | --- |
| 400 `invalid_json` / `invalid_encoding` / `invalid_import_key` | 構文・UTF-8・BOM・重複キー・深度またはkey不正。保存されない。原稿修正／key不正ならクライアント不整合を案内 |
| 401 `unauthorized` | 未認証・失効・退会申請中。保存しない。同じownerで認証し再試行 |
| 403 `forbidden_origin` / `forbidden` | Origin不正／記録のdeck所有者不一致。自動で別keyを生成せず止める |
| 413 `too_large` | 元bodyが1MiB超過。減量して再検証 |
| 415 `unsupported_media_type` | Content-TypeやContent-Encoding不正。圧縮bodyは許可しない（identity/未指定のみ） |
| 422 `invalid_deck_import` | version、未知項目、型、制約違反。path別修正経路へ。変換後上限はissue code `converted_too_large` |
| 409 `import_key_conflict` | 同ownerの同keyが別bodyで既に成功。既存内容は更新しない。保存済みid/slugを返し「既存を開く」へ。別デッキとして保存するにはこの競合を確認し明示的に新しい取り込みを開始 |
| 410 `import_target_deleted` | 同keyの作成先がその後削除済み。復活・再作成しない。「削除済み。別デッキとして取り込む」を明示した場合だけ新規操作へ |
| 429 `import_daily_limit` | §7.3の日次作成上限。Retry-After秒を表示、raw/key保持 |
| 503 `import_unavailable` | DB障害、採番衝突の再試行上限等。結果未確認、同keyで再試行。一般5xx・ネットワーク断・不正成功応答も同様 |

### 7.3 サーバー処理と資源制限

1. 共通bodyLimitに`POST /api/decks/import`完全一致の1MiB分岐を追加。Content-Lengthを信用せずストリーム累積でも拒否する。圧縮は受け付けない。既存の8MiB等を全ルートで狭めない。
2. 認証・Origin・ヘッダーを確認後、受理サイズ内のraw bytesをSHA-256。まずowner/keyの既存receiptを照会。成功済みならhash一致で同じ結果、相違で409、対象消失なら410を返す。既存deck内容は再変換もPATCHもしない。再送は以前サーバー検証済みの同一bytesとの照合であり、ブラウザ判定の信頼ではない。
3. 初回keyは両環境共通パーサーとstrict v1 validatorで**サーバー再検証必須**。全入力制約・合計数・変換後制約まで検証し、合格前のSQL作成/R2操作はゼロ。previewの合否やチェック値は送らせない。
4. UUIDとslugを採番し、完成本文を構成。下記receipt挿入とdeck INSERTをD1 batchで原子的に実行。INSERT前の存在確認だけで並行性を保証しない。
5. owner/key unique競合ならbatch全体をrollbackして既存receiptを再読込し、所有者・hash・対象deckを通常の再送と同じ契約で照合して200/409/410（所有者不一致は403）。batchの変更行数が両方0の場合も、429を返す前に同owner/keyのreceiptを再照会し、存在すれば同じ照合経路へ進む。再照会でreceiptが存在しない場合だけ429とし、再照会のDB障害は503。slugまたは採番したdeck ID unique競合だけなら新しく採番して最大3回までbatchを試す（raw/keyは固定）。他DB障害を「重複」として握りつぶさず503にする。
6. 原子commit後だけ201を返す。応答喪失でも同じkeyで同一idへ収束。commitと後続取得の間に削除された場合は410。公開GETから観測できるのは未存在または完成した全本文で、取り込み由来の空deck／途中ページは存在しない。

追加テーブル **`deck_import_receipt`**（追加migration1本、実装時の次の番号）:

| 列／制約 | 契約 |
| --- | --- |
| owner_id | TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE |
| import_key | TEXT NOT NULL、owner_idとの複合PRIMARY KEY |
| payload_sha256 | TEXT NOT NULL、元bytesのSHA-256小文字64hex |
| deck_id | TEXT NOT NULL UNIQUE。**deckへのFKは付けない**（削除後もtombstoneとして残す） |
| created_at | INTEGER NOT NULL、サーバーepoch ms |
| index | `(owner_id, created_at)`。日次制限照会に使用 |

receiptは原稿／本文／slugを複製せず、成功操作だけ1件保持。期限切れにして同じ古いキーで再作成する事故を避けるため、アカウント存続中は削除しない。deck削除後も再送は410、アカウントの実削除時のみcascade。既存deck削除SQLは変更不要。

**新規成功は1アカウントあたりUTC暦日100件まで**。重複再送は数えず上限後も照会可能。日次上限はreceiptのcreated_atから求める（UTC翌日までの秒をRetry-After）。別のrate-limitサービス・cron・定期削除は追加しない。receipt増加は最大100件/日/owner、本文の1回上限は1MiB、応答は小型、検証issueは50件、preview描画は遅延とし、無制限の展開を避ける。通常の空deck作成への全体quota追加は本Issueの範囲外。

日次quota判定も競合しないよう、同じbatchの第1文を「ownerの日次COUNT<100のときだけreceiptをINSERTするINSERT…SELECT」、第2文を「その新しいdeck_idに対応するreceiptが存在するときだけ完成deckをINSERTするINSERT…SELECT」とする。batchの変更行数が両方1なら成功。両方0なら手順5のreceipt再照会を必ず行い、未存在と確認できた場合だけ429とする。部分結果は契約違反として失敗扱い。D1の同一batch原子性によりreceiptだけが残る状態を作らない。並行同keyはPK違反になる場合に加え、先行要求が日次上限の最後の枠を使うと後続のINSERTが両方0になる場合があるため、両経路を同じ再送照合に収束させる。並行別keyの日次判定は書込transaction内で直列化される。

SQLは全値bind、ログにはraw/text/title/キー/本文hashを出さない。記録するのは固定エラーコード・bytes・ページ数・要素数など必要最小限。入力指定のネットワーク取得・HTML評価・eval・CSS注入・R2書込はこのAPIで一切行わない。公開仕様GETと保存APIは別の権限境界。

## 8. 互換性・移行・復旧

- 今回はMarkdownだけなので移行・環境操作は**実施しない**。将来実装はreceiptテーブル追加migrationが必要。既存deckの本文・ID・slug・公開範囲・GET/PATCH契約は変えず、既存データ書換／backfillは不要。
- 内部画像空枠は既存image/src省略であり、旧editor/viewerでも開ける。狭いv1 validatorを通常PATCHや旧deck読込へ適用しない。既存フォント・外部画像URLの全アプリ禁止も行わない。
- 将来配備時は追加migration→対応サーバー→UI／配布仕様の順（同一Workerの配信構成ならmigration後に対応版を配備）。実機確認と配備承認は別途。schema未適用でAPIを公開しない。
- 切戻しは前のアプリ版へ戻し入口とAPIを停止、receiptテーブル・作成済みdeckは保持。旧コードは追加テーブルを参照しない。DROPや新規deck削除をロールバックに含めない。再導入は既存receiptを再利用する。
- 古いクライアントから停止済みAPIへの404/405は「取り込みを利用できません」と表示し、通常POST→PATCHへフォールバックしない。未確認操作のraw/keyを残し、再導入後に同じkeyで確認する。公開仕様v1の意味を変えて復旧しない。

## 9. 変更予定箇所（今回コードは変更しない）

| 対象 | 将来の最小変更 |
| --- | --- |
| `packages/shared/src/deckImport.ts`、exports | strict v1型・制限・検証・変換・構造エラー。上限付きJSON解析は専用小モジュールに分離。既存decks.tsの入力制約は変更しない |
| `apps/web/public/deck-import/v1/` | 同一版の公開仕様・Schema・プロンプト・3サンプル |
| `apps/web/src/pages/DeckImportPage.tsx`、専用preview／入力部品とvalidator worker | 入力・状態・全ページpreview・警告・sessionStorage復旧。editor共通hookへ画面固有コードを入れない |
| `App.tsx`、`DecksPage.tsx`、共有i18n辞書 | ルート・入口・日英文言。仕様取得／previewは未認証でも到達可能にする |
| `apps/web/src/api/deckHooks.ts`（または隣のdeckImport hook） | raw/header送信・error変換・成功時一覧更新。通常create hookは流用しない |
| `DeckEditorPage.tsx`、deck専用保存状態hook | §6の単一タブ送信直列化・最新revision ACK表示・再試行・発表前gate。共通useAutoSaveと配信側の契約は変更しない |
| `apps/server/src/worker.ts` | 一枚のbodyLimitに取り込み専用サイズ分岐 |
| `apps/server/src/routes/decks.ts`、隣の`deckImport.ts` | 認証内専用POST、Origin、raw検証、応答。JSON zValidatorだけに丸投げしない |
| `apps/server/src/db/repositories/decks.ts`、receipt repository、追加migration | 完成本体＋receiptのbatch、所有者付き再送照合・quota。既存create/updateは維持 |

## 10. 将来実装の受入条件

テストの作成・実行は今回はしない。以下は実装承認後に利用者価値と事故防止を確認する観点であり、今通過したという報告ではない。

1. **最短経路**: 匿名で版固定仕様・プロンプト・Schema・3サンプルを取得。仕様を読めないLLMにもプロンプトのみで依頼できる。サンプルを貼付／ファイルで同じ順序・座標・装飾・空枠の全ページpreviewにできる。依存LLM契約なし。
2. **修正可能**: 構文、未知version/キー、型、null、重複キー、Unicode、負数／0寸法／端越え、font/色、外部アセット指定、各境界値と+1、UTF-8総量超過を両環境で照合。ブラウザを迂回した直接POSTでも不正データを作らず、page/element/pathと直し方で修正→再previewできる。
3. **未保存の安全**: プレビュー・取消・検証失敗でdeck/receipt/R2の書込ゼロ。HTML/JS/CSSらしい本文は文字のまま、srcやfont URLを取得しない。全ページ確認・公開通知が保存より先に出る。
4. **実際の発表**: 小さい表紙、箇条書き、比較＋空枠の3サンプルで全ページ目視。狭い画面でも拡大確認でき、意図的な長文にはあふれ警告。保存→editor→画像差替→最新編集ACK→再読込→公開ビューアのページ送り／全画面が通る。未差替枠も予告通り表示。
5. **原子性**: receipt INSERT後／deck INSERT時の失敗を注入して両方rollback。公開GETから空deckや一部本文を観測しない。commit直後の応答喪失を再送し、deck1件・同じidとなる。
6. **重複・削除・競合**: 同owner/key/bodyの並行送信と再読込で201+200、同key別bodyは409で上書きゼロ。削除後は410で復活ゼロ。再送前にeditorで変更した内容を再送が巻き戻さない。別ownerは照合結果を漏らさない。別keyの日次境界並行実行でも100件を超えず、重複照会はquotaに含まれない。特に当日99件で同owner/keyの要求A・Bがともに事前照会で未存在を読み、Aが100件目をcommit、Bのbatchが両方0になる順序を確認する。同bodyなら201+200で同じid、別bodyならBは409、Bの再照会前に作成先を削除した場合は410となり、成功済み操作を429へ誤分類しない。両方0の後にreceiptが未存在なら429、再照会が失敗したら503で結果未確認となる。
7. **権限と復旧**: 未認証401、Origin不正403、body上限413、日次上限429、DB障害503。保存中連打、20秒timeout、同一タブreload、storage失敗、アカウント切替、削除、API停止それぞれ§5/7/8の状態に戻り、無断新規保存しない。
8. **編集保存**: PATCH失敗を保存済みと表示しない。送信中の後続編集は最新revisionまで順に保存され、ACK前は発表できない。再試行は既存deckだけを更新する。旧deck編集／閲覧と通常空deck作成は維持する。
9. **互換性**: 追加migrationだけで旧deck無変更。旧アプリ版で新しい空枠deckを表示でき、切戻し・再導入でreceiptによる同一性が失われない。

## 11. 対象外・承認境界・自己確認

### 設計レビュー指摘への対応

- 初版`fdb36a9`への独立レビューは **BLOCK（P1 1件）**。日次99件から同keyの並行要求が100件目を作ると、後続のbatchはPK違反ではなく両方0になり、保存成功済みでも429に誤分類する欠陥が指摘された。
- §7.3を修正し、両方0でも429の前に同owner/keyのreceiptを再照会して通常の所有者・hash・削除照合へ収束することを決定。§10の受入条件に、この境界での同body／別body／削除済み／再照会失敗を追加した。API・テーブル・機能の追加はない。
- この修正の独立再レビューは未完了。初版のBLOCKを自己判断で解除せず、修正版のレビュー結果を待つ。実装・配備・mainマージの承認は引き続き含まない。

### 対象外と承認境界

対象外: アプリ内LLM呼出、APIキー／課金／新外部サービス、MCP/直接LLM書込、PPTX/PDF/Googleスライド変換、画像生成／自動取得、Markdown取り込み、発表者ノート、図形／表／チャート、新レイアウトエンジン、既存deckの上書き・追記・merge、非公開下書き、共同編集ロック、配信同期#10、開いたビューア更新#374、全アプリのフォント／URL入力規制、全アプリ保存基盤改修。PPTX skillの適用条件は確認したが、PPTXを読む／作るタスクではなく成果物も生成しない。

この設計でIssueの未決だったv1範囲・総量・あふれ警告・保存の原子性／再試行を決定した。実装承認前のレビュー対象は、狭いv1上限、公開保存、追加receipt migrationと日次100件制限、deck編集の保存表示修正を含む本設計一式。**設計レビューで未決や不整合が残れば、その部分は実装GOではない。** 本PRが作成されたこと、CI成功、設計のmain取込みだけでアプリ実装・配備が承認されたとは扱わない。

自己確認（設計時、アプリテスト／画面描画は未実施）: §3.4はroot/slide/text/空枠の全必須キーだけを持ち、1ページ3要素、文字総量・UTF-8総量とも上限内。最大右端912、最大下端420、最小寸法96、文字サイズ44/28、6桁色、font=default、src/内部IDなし。§3.5プロンプトは同じ版・キー・範囲・文字計数・全量を指定する。既存schemaが空枠のsrc省略を許し、編集／ビューアがそれを扱うことをソースと照合した。実ブラウザでの文字あふれ・OS差、D1失敗注入・並行性、LLM出力品質は未確認であり、§10の将来受入で確認する。

## 12. D-523-IMG: 実画像を含む取り込み

この節は上記v1契約を改訂しない。version 2の画像URL取り込みは実装ブランチに存在し、D-523-IMG-SAMPLEは同じ選択URLを改稿する。v1の「外部画像不可」「画像は保存後に差し替え」は**version 1に限る**。実装・テストは配備やオーナーの画面受入を意味しない。

### 12.1 使う人の流れと公開サンプル（D-523-IMG-SAMPLE 実装原稿）

**変更理由と境界。** 旧3ページは画像付きimportの動作例としては成立するが、初見の人へevents labのイベント運営体験を伝えきれない。本提案は**同じ**`/deck-import/v2/sample-events-lab-intro.json`の内容を10ページの紹介デッキに置き換える。新しいサンプル選択肢、JSON version、API、認可、DB、画面、テンプレート種別は増やさない。表紙・箇条書き・比較のv1サンプルとv2仕様・prompt・schemaは不変。既に利用者が取り込んで保存したdeckには遡及変更しない。既存原稿の上書き確認を保ち、匿名でサンプルを選択→「検証してプレビュー」→10ページ確認→公開同意→ログインして新規保存→editorで空枠へ本人の画像をアップロード→保存ACK→`/d/:slug`で発表する。保存前previewにアップロードを追加しない。URLを知る人が閲覧できる契約と外部画像ホストへのブラウザ通信の注意は§1・§12.3のまま。

**事実の基準（ソース確認のみ）。** `origin/main` `b433cc9` の`README.md`「ロードマップ / 実装状況」および`apps/web/src/App.tsx`の実ルートを照合。実在するイベント作成・公開・日程調整・参加登録（`/events/new`, `/events/:id`）、スタッフ準備（`/events/:id/todos`, `/events/:id/staffing`）、受付（`/events/:id/checkin`）、タイムテーブル・プレゼン・採点・結果・表彰（`/events/:id/timetable`, `present`, `scoring`, `results`, `awards`）、配信セット／配信画面（`/live-sets`, `/events/:id/live/screen`）、deck編集／公開発表（`/decks`, `/d/:slug`）のみを具体例とする。参加はイベント設定・公開状態・ログイン等に従い、採点は審査員だけでなく**参加者全員ができる**。配信はOBSが画面をキャプチャする方式であり、アプリ単独のブラウザ配信／リモート視聴は将来項目。スライドとイベント進行の自動同期、チーム参加、ネイティブアプリ、参加履歴ポートフォリオを現行機能として描かない。これらはREADMEの「これから」／構想であり、紹介デッキにロードマップとしても混ぜない。

**アートディレクションと制作契約。** `DESIGN.md`のNatsumatsuriに揃え、16:9の夜空`#0E1426`、面`#1A2238`、本文`#EAF0F7`、補足`#97A3BC`、操作のティール`#2DD4BF`、祝祭のアンバー`#FB923C`を役割で使い分ける。表紙・表彰だけ暖色を強め、本文の上に画像を重ねず、暗い舞台に灯りが順につくように①始まり→②主催の準備→③当日→④発表・共有→⑤自分の番を連続させる。イラストは図形・光・匿名シルエットによる**概念図**で、実在のイベント画面や実ユーザー・写真・人数・成果／売上グラフを捏造しない。PNGの中に機能名／細字／ボタンを焼き込まず、意味を持つ文字はv2の`text`要素に置く。画像は装飾であり、読み込み失敗時も本文だけで話の筋が通る。アプリのロゴを利用する1ページ目は既存`og-default.png`（内部に`events lab`と「募集から配信まで全部やる。」がある）を**文字入りポスターとして1回だけ**使用し、同じ文字をtextで重ねない。10ページ目は既存`icon-512.png`を小さなブランド署名として使う。

- 制作後に追加する静的画像はfirst-partyの**8点の透過PNG**。固定公開パス`/deck-import/v2/intro-{journey,publish,calendar,crew,checkin,stage,awards,stream}.png`、JSON内srcはそれぞれ`https://events.kojira.io`を冠したHTTPS絶対URL。ベクターで作図しPNGへ2倍以上で書き出し、最大表示領域でジャギーが出ないことを確認。外部画像検索、生成AIの人物写真、実画面スクリーンショット、機密データ不要。小型化し、透明ピクセル込みの画像サイズ・色・文字コントラストを実機で確認する。新規画像はサンプルにだけ使い、UIのテーマやブランド素材そのものは変更しない。
- 各画像の中身: `journey`=散らばった5灯が一本の道につながる、`publish`=告知カードと開いた扉、`calendar`=カレンダーの候補日と匿名の参加マーク、`crew`=段取りカードと持ち場の灯、`checkin`=受付ゲートと抽象的QR模様（**読み取れない装飾**）、`stage`=舞台・発言の灯と投票札（実際の点数なし）、`awards`=光る表彰台と紙吹雪（順位や受賞名なし）、`stream`=舞台画面を別の枠へ映す矢印（カメラ配信／アプリ内遠隔視聴を暗示しない）。画像ごとに1つの主題、細線の最小幅を2倍書出しで4px以上、薄すぎる小物を避ける。8点は内容の異なる再利用可能な図版で、各ページが同じロゴ＋文字だけになるのを避ける。画像が占める領域を過度に大きくせず、textを主役にする。
- 表紙以外の基準配置は960×540、左右セーフマージン56、上下36以上。共通の章ラベル（「01 / はじめる」等）を左上`(56,36,480,38)`・20px、見出し`(56,88,848,70)`・40px、本文は左`(56,176,438,246)`・26〜30px／短い2〜4行、右画像`(544,155,360,296)`（contain）。最下段の結びは`(56,472,848,32)`・20px。いずれもtext/image/placeholderのみ、単色背景のみ、回転・画像overlay・CSS・複雑な図形レイアウトを要求しない。画像領域と本文は50px離し、見出しの下に十分な余白を残す。実際の文言が折れる場合は座標内で文字量／フォント／高さを調整し、文字切れの自動縮小に頼らない。章ラベル・結びは小画面サムネで読めなくても、40px見出しと大きな画像シルエットでページの違いが分かるようにする。画像由来の文字は表紙だけ。

**完成原稿のページ割り（オーナーの「本気で紹介して」要請を反映した実装原稿）。** §12.1 の初稿は機能を順に数える説明に寄っていたため、最初の思いつき→出会う→支え合う→当日を分かち合う→自分の番という語りへ改稿した。以下は実際のJSONの表示文言と順序。機能の根拠、10ページ構成、画像パス、空枠の役割、表紙の既存OG利用は変えない。章番号01〜09は表紙を除く章番号であり、架空のユーザー・成果を示さない。

| 頁 / 絵 | 章・見出し | 本文／結び |
| --- | --- | --- |
| 1 / OG | 画像内に既存の「events lab」「募集から配信まで全部やる。」等（§13.3）。重複textなし | 既存OGを(68,57,824,433)にcontain |
| 2 / journey | 01 / ひらく ・「やりたい」を、一日に変えよう。 | 告知から当日の舞台まで。／主催する人も、参加する人も、／同じイベントで出会える。／その一日は、ひとつの思いつきから。 |
| 3 / publish | 02 / 告知 ・その思いつきに、入口を。 | イベントを作り、内容を公開。／まだ会ったことのない誰かにも、／参加のきっかけを届ける。／まずは、見つけてもらうところから。 |
| 4 / calendar | 03 / 集まる ・「行ける日」から、一緒に。 | 候補日を聞いて日程を決める。／参加登録まで、同じイベントで。／集まる前から、もう始まっている。 |
| 5 / crew | 04 / 支える ・当日は、ひとりで抱えない。 | TODOとスタッフの持ち場を整え、／タイムテーブルを共有する。／準備が見えると、舞台が近づく。 |
| 6 / checkin | 05 / 迎える ・いよいよ、会場で会おう。 | QRでチェックイン。／準備してきた一日が、動き出す。／ここから、同じ時間を過ごす。 |
| 7 / stage | 06 / 分かち合う ・聞くだけで、終わらせない。 | 発表を進め、参加者が採点。／みんなの視点が、結果につながる。／参加した声も、この日の一部。 |
| 8 / awards | 07 / たたえる ・拍手の行き先を、つくろう。 | 結果を確かめて、表彰へ。／発表した一日を、祝う一日に。／主役を照らす、最後のひと幕。 |
| 9 / stream | 08 / 届ける ・会場の景色を、配信画面にも。 | 配信セットと画面を組み、／OBSでキャプチャして届ける。／画面の向こうへ渡す、もう一つの舞台。 |
| 10 / icon＋空枠 | 09 / あなたへ ・次は、あなたのイベントへ。 | この空の画像枠を、／あなたの一枚に。／保存後、編集画面で／画像をアップロードできます。 |

2〜9ページは章(56,36)・見出し(56,88)・結び(56,472)というセーフ領域を守る。通常の本文(56,176)・絵(544,155)に対し、8ページの祝祭は本文を(56,191,416,208)・32px太字、絵を(526,180,378,290)にして暖色のクライマックスをつくる。表紙と10ページはそれぞれ画像ポスターと画像空枠＋明示的な差替指示に変化させる。コピーは操作上の確約ではなく、既存のイベント作成／日程回答／スタッフ準備／QR受付／参加者採点／表彰／OBSキャプチャに対応する。

本文が長い8・9ページなどは共通の余白を守り、実ブラウザの文字あふれ測定で調整する。各頁は意味のあるtextと画像を最小数だけ持ち、40px程度の見出しを優先。v2にないノート、図形、リッチテキスト、字間／縦揃え操作、カスタムフォントは使わない。1ページ目OG画像の外側には自前の重複ロゴや新しいBETA表記を置かない。10ページ目だけは未設定枠が意図した学習体験であり、閲覧者にも枠が見えることを保存前に案内する。

**資産の所在・互換性。** 新PNGは`apps/web/public/deck-import/v2/`に、更新JSONと同じ公開静的パス群として置く（本設計段階では作らない）。既存`apps/web/public/og-default.png`と`icon-512.png`を再利用。JSONの全URLは従来の公開production origin固定で、stagingからもproductionへの画像GETが生じる。相対化やproxy、サーバーによる取込はしない。新PNGを更新JSONと同じリリースに含め、JSONが参照する全10画像URL（既存2点＋新8点）の到達性・内容を、リリース前の静的成果物と許可された確認環境で確かめる。stagingの固定URLはproduction画像を指すため、productionで新PNGを公開する前にstagingで新8点を実際に表示することはできない。この間はstagingで文字・レイアウト・空枠と既存2画像を検証し、新8画像の実URL表示は明示的なproduction GO後の最終ゲートとする。production GO前に画像を先行配備しない。既存サンプルURLは同じためキャッシュ中の3ページ原稿が一時残り得る。選択時に既存サンプルと区別できるようUI説明文だけ「events lab の紹介（画像付き・10ページ）」へ更新し、アセットの版・内容を配備／復旧時に確認する。既存保存済み3ページdeckは不変。切戻しは旧JSON／選択肢説明を戻し、新PNGは未参照でも急いで消さない（作成済みdeckが絶対URLで参照し続ける）。既存/新画像のURL安定性を保てない運用なら本デザインを実装GOとせず、先に画像の永続パスを決める。

### 12.2 公開JSON version 2の厳密な差分

- rootは`format:"events-lab-deck"`, `version:2`, `title`, `slides`。slide/text/空枠の全必須キー、型、座標、件数、UTF-8 1MiB／合計text 100,000、エラー上限、UTF-16・重複キー・深度・未知キー拒否は§3と同じ。versionは整数の数値で`1`か`2`だけ受理し、**version 1で`image-url`や`src`は引き続き422**。version 2でも`image-placeholder`は`type,x,y,w,h`のみ、`src`不可。`alt`等の追加キーも不可。
- version 2のみ第3要素: `{"type":"image-url","x":48,"y":180,"w":392,"h":240,"src":"https://events.kojira.io/og-default.png"}`。全6キー必須。座標は§3と同じ。`src`は空でない文字列、最大**500 UTF-16コード単位**（既存`DeckElement.src`の上限）。孤立サロゲート（§3共通）とU+0000〜001F・U+007F〜009Fの制御文字を拒否し、baseなしのWHATWG `new URL(src)`で解析でき、`url.protocol === "https:"`かつ`url.username === ""`・`url.password === ""`であることをbrowser/server共通で確認する。相対パス、`http:`/`data:`/`blob:`、認証情報付きURL、解析不能な文字列は拒否する。不正な`src`は該当要素の`slides[n].elements[m].src`に固定エラー（例:「画像URLは500 UTF-16コード単位以内のHTTPS絶対URLにしてください。制御文字・認証情報は使えません」）を示し、入力URLやqueryを応答に反射しない。大文字のhost、国際化ドメイン、IP、明示port、fragment、URLパーサーが扱える空白等を独自のDNS・canonical・ASCIIルールで追加拒否しない。`url.href === src`は要求せず、入力した利用可能な`src`をそのまま保存・描画する（パーサーによる書換えはしない）。queryやfragmentも500単位に含む。URLの有効期限・コンテンツの存続・実画像であることを構造バリデーターは保証しない。ブラウザはuser-supplied URLを**自分の通信先として読み込む**ためHTTPSの入口検証は画像の到達性・通信先の安全性の証明ではない。全スライド共通の1,000要素上限を画像にも適用し、別途画像数枠は設けない。
- 同一版の厳密なバリデーターをbrowser workerと認証済み`POST /api/decks/import`で使い、サーバーはrawを再検証し、変換後の既存deckContentSchema＋UTF-8 1MiBも確認する。v2 `image-url`は内部`{id,type:"image",x,y,w,h,rotation:0,src}`へ**明示投影**し、空枠は今まで通りsrc無し。preview仮ID／保存時のサーバー採番、同一key再送・原子保存・public GET・編集時のowner権限は§4〜§8のまま。`src`は通常のdeck本文TEXTに保持し、画像bytes・外部応答・新しいメディアIDは保存しない。既存APIや過去deckへのv2 validator適用はしない。v1の配布物・受理範囲・既存サンプルは不変。
- 公開配布物は新しい`/deck-import/v2/{spec.md,schema.json,prompt.txt,sample-events-lab-intro.json}`に固定し、UIにv1とv2の版がわかる仕様リンク／プロンプトコピー／サンプル選択を表示。v2 spec・自己完結プロンプト・Draft 2020-12 schemaのoneOfにtext/placeholder/image-urlと全required/additionalProperties=falseを反映する。`src`のschema `maxLength`はコードポイント計数なのでUTF-16上限の保証ではない。URLパーサーによるHTTPS・認証情報・制御文字の判定や総数等はschema単体では保証できずspecと共通validatorを正とする。修正指示にはversion 2と`slides[n].elements[m].src`の制約を含め、元URL／queryをコピー・ログ・エラー応答に出さない。未知versionは従来通り拒否する。

### 12.3 画像の表示、失敗と境界

- `SlideStage`はすでに`el.src`を`<img src={el.src} alt="">`で`objectFit:contain`表示し、src無しを灰色の空枠にする。v2でも同じpreview/editor/viewerで描く。URL画像はpreview表示の時点で**閲覧者のブラウザから**送信先へGETされ、保存後は編集者と公開viewerも読み込む。URL、IP、アクセス時刻等が画像ホストに知られ得る（IP等から閲覧環境を推測され得る）。既定のcross-origin Refererポリシーは`strict-origin-when-cross-origin`であり、公開deckのslug漏えいが現状で確認されたわけではない。追加のプライバシー強化として画像要素に`referrerPolicy="no-referrer"`を付けてもよいが、既存R2画像への影響や外部ホストのHotlink制限を確認する。実装時は本番とstagingのContent-Security-Policy `img-src`設定がある場合このUXと整合するか確認し、勝手に全ホスト許可を加えない。CORS許可は単純な`<img>`表示には不要、canvasへ読み出す設計ではない。CSP、ホストのHotlink制限、期限切れ署名、認証必須、リダイレクト、ネットワーク遮断は**GETを失敗させ得る**。ブラウザから見えない外部画像の事前検証をサーバーはしない。ブラウザが後続redirectで別URLを取得する可能性までは入口URLのHTTPS検証では保証できない。
- URL画像は読み込み前に要素領域へ「画像を読み込み中」、`onError`／読み込み不能時は「画像を表示できません。URLを確認し、保存後なら差し替えてください」と画像枠内に表示（バイト列やURLを画面に反射しない）。`src`変更時は状態を初期化。画面側の状態であり、**失敗で画像要素を削除・空枠型へ変換・`src`を消去しない**。画像失敗は警告（どのページ・要素か）で保存は可能、実画像の表示を確認してから保存するよう促す。ブラウザの`load`は当該環境での一時的成功であり将来の可用性保証ではない。読み込みが遅い間は通常の読み込み枠のままにし、画像が表示されない場合は手動確認を求める案内を残す。load/errorは現行srcに限って成功／失敗へ更新し、プレビュー／保存を停止させない。`image-placeholder`はこれと区別して従来の空枠／差替案内を出す。公開viewerで画像が後日消えた場合も壊れたアイコンのみで放置せず同じ失敗枠を描画する。HTML/JS実行、fetchしてdata URL化、R2への自動転送はしない。
- 保存APIはURLへHEAD/GET/redirect追跡を一切せず、プレビュー時以外もサーバーから外部画像を取得しない。新規upload endpoint、外部画像proxy、事前コピー、CORS設定追加、既存画像の一括移行は不要。URLそのものは公開deckのGETレスポンスに含まれるためsecret付きURLを貼らないよう保存前にも説明する。公開viewerから画像ホストへの直接通信を避けたい場合は**ホストURLでなく、保存後に本人が既存uploadを使う**。

### 12.4 実装対象・検証と運用ゲート（§13の配信・読解条件を優先）

実装承認後の対象は`packages/shared/src/deckImport.ts`（版別型・schema・validator・変換）、`apps/web/public/deck-import/v2/`、`DeckImportPage.tsx`（版表示と紹介サンプル）、`DeckImportPreview.tsx`（画像失敗警告）、`SlideStage.tsx`（読込／失敗枠。referrer指定は任意）、必要な日英文言と該当テスト。既存`deckImportJson.ts`の1MiB/解析、保存APIの所有者・原子性・receipt、画像アップロードの`deckImages.ts`は変更しない。**migrationなし**。v2を理解しないサーバーにv2 UIを先行配信しない。切戻しはv2入口／配布物を止めて前版へ戻すが、作成済みのURL付きdeckは旧SlideStageで画像自体を描画可能（旧版には今回の失敗枠だけがない）。receiptと既存deckは消さず、v1と通常編集は保つ。

受入証拠は、v1全サンプルが同じraw/意味で合格し`version:1`+`image-url`がbrowser/serverとも拒否、更新した**同じv2紹介サンプルURL**が10ページ・画像URL10点（既存2＋新8）・空枠1点を返し、browser/serverのstrict v2 validatorと変換後content上限を満たすこと。10ページそれぞれについて表のコピー・順序・画像参照と既存README／ルートの機能の突合、PNGが文字・架空人数・ユーザー／イベント実データを含まないことを確認する。選択肢に10ページと明記され、v1サンプルは変更されず、既存の保存済みdeckも変わらない。更新原稿のpreview→全ページ確認→原子保存→editorで最後の空枠をownerが既存アップロード→最新PATCHの成功→reload→公開viewerのページ送り／全画面で画像と差替画像を目視し、同一key再送が同一deckになることを確認する。既存3ページの導線と同じ権限・公開警告を維持する。stagingではログイン済みブラウザでviewerを目視し、匿名`/d/:slug`はローカル、または明示的な本番GO後のproductionで検証する。v2ではURL長500/501（UTF-16）、http/data/blob/相対・制御文字・userinfo・解析不能URLを拒否し、大文字host・非canonicalな表記・国際化ドメイン・明示port・fragment等の有効なHTTPS URLは元の`src`を保持して受理する。未知キー・src省略/型違い・座標越え・1MiB越え・変換後1MiB越えもbrowser/serverで対照。URLを壊した画像／hotlink拒否はURLを保ってページ別に失敗を表示、元原稿・個人情報をログ・修正指示へ流さず、アクセス拒否・保存通信失敗は従来の未確認key復旧を維持する。遅い読み込み（タイマーなしの読み込み枠と手動確認案内）／画像切替競合／小画面をブラウザで確認する。`no-referrer`を採用する場合のみ外部画像宛のRefererとHotlink挙動を確認する。旧2画像はstaging実ブラウザでも確認する。新8画像は§12.1どおりproduction絶対URL固定のため、本番GO前のstagingではロード失敗になる。ローカル／stagingの**実ブラウザ**（最低320pxと390pxのモバイル幅、およびデスクトップ幅）で、PNGのGETだけを同一bytesのstaging／ローカル静的成果物へブラウザのテスト用ルーティングで差し替え、原稿・保存API・表示コードは変更せず、10ページすべてのサムネイルと拡大preview、viewerをスクリーンショットで記録する。差し替え使用の画像を明記し、これはproduction URLの到達性の証拠と**混同しない**。表紙文字、見出し、本文、空枠案内が切れず、縮小時も絵と大見出しで頁を識別できること、画像load/errorの両状態を確認する。productionの10URLの最終表示確認は別途本番GO後直ちに行う受入ゲートとし、未達なら完了とせず既存の切戻し手順に従う（公開中の一時的な画像欠落リスクは残る）。コードのassertionはURL受理／変換／失敗表示の条件を1か所変えて対応テストが落ちることも確認する。staging反映後オーナーが目視で原稿・実画像・空枠差替・公開viewer・外部URLの注意表示を受け入れ、**明示的な本番GO**までproductionには出さない。設計レビュー・実装承認、mainマージ、staging配備、本番GOはそれぞれ別のゲート。

## 13. D-523-IMG-SAMPLE: §12の配信・読解アメンドメント

独立設計レビューのP1二件・P2一件を反映。§12.1の10ページ原稿、画像8点のパス、v2のURL入力／保存契約、既存deckを変更しない境界は維持する。§12.1の「全URLがproduction固定」「staging新8画像は本番GO前に表示不能」という配信上の記述、§12.4のブラウザ画像GET差替を必須証拠とする記述は**この節の限定された配信・受入条件で置換**する。実装対象も§12.4の列挙に加え、指定サンプルだけの環境別応答を担う`apps/server/src/worker.ts`と、拡大読解モードを担う`apps/web/src/pages/DeckViewerPage.tsx`を含む。§13.2のpreview読解モードは既存`DeckImportPreview.tsx`に加える。ローカル実装と独立レビュー、staging、本番の各GOは別々。

### 13.1 P1: 指定サンプルだけ環境別画像URLを配信する

- バンドルした**正確な** `GET /deck-import/v2/sample-events-lab-intro.json` だけを対象に、staging認証ゲートの**後**、汎用`ASSETS.fetch` fallbackの**前**に配信分岐を置く。別メソッド、末尾スラッシュ、別パス、v1仕様／サンプル、任意のimport POST、通常のユーザー入力URL、保存済みdeck、公開deck GET、validatorは書き換えない。クエリで別モードを選ばせない。両環境とも同じバンドルのサンプルJSONを基にする。
- 新規8 PNGの`image-url.src`が、§12.1のproduction origin `https://events.kojira.io` と列挙済みの `/deck-import/v2/intro-{journey,publish,calendar,crew,checkin,stage,awards,stream}.png` の**完全一致する8 URL**であることを確認してから、staging応答ではその8件のoriginだけを `env.appBaseUrl`（現行staging: `https://eventer-staging.kojiran.workers.dev`）へ置き換える。production応答ではproduction originのまま。既存 `og-default.png` と `icon-512.png` の2 URLはproduction参照を維持（stagingのログイン済み実ブラウザでもGETを確認）。未知のsrc、query/fragment付きURL、同名パスの外部ホスト、ユーザーの任意の `image-url`、その他フィールドは**一切変換しない**。バンドルされたサンプルの全UTF-8 bytesのSHA-256と形・8件の一意性がレビュー済み原稿から外れたら、誤ったサンプルを配信せず非キャッシュの明示的エラーとする。原稿を意図して変更する際は期待digestも更新しテストで確認する。参照PNGの欠落・内容不一致も配備前の検証ゲートを止める。stagingの保存済みdeckはstaging originをそのまま保持し、productionへdeckを昇格・同期・後で自動変換しない。productionで新規に同じサンプルを取り込む場合だけproduction URLになる。
- JSON応答は有効なUTF-8 JSONと `application/json; charset=utf-8` を維持する。変換後に元アセットの `Content-Length` / `ETag` / `Last-Modified` / 304を流用しない。サンプル応答は両環境で `Cache-Control: no-store` とし、新旧3/10ページ原稿がブラウザ・CDNキャッシュで混ざらないか実配信で確認する。stale cacheが残る場合は実URLで10ページを取得できるよう是正するまでオーナーQCに進まない。PNGは同じ版の静的bundleに含め、stagingで8 GETが`200`、`Content-Type: image/png`、PNG署名・実bytes一致（SPA HTML/認証ゲート本文や404でない）を確認する。productionでもGO後同様に確認し、URL永続性・切戻し時の参照維持は§12.1に従う。外部画像のproxy、サーバー側取得や認可緩和はしない。
- stagingでは有効なログインセッションを持つ同一originのサンプルGET／`<img>` GET／viewerを通常ブラウザで通す。匿名のstaging PNG GET・サンプルGET・`/d/:slug`は現行stagingゲートに従い閲覧不可（画像GETはHTMLの403を返し得る）。これは公開viewerの匿名閲覧をstagingで証明しない。ログイン済みstagingで保存→再読込→editor／viewerの画像参照がstaging URLのまま有効なことを確認し、匿名公開viewerはローカルのゲートなし構成または明示的な本番GO後productionで確認する。productionの匿名viewerはproduction originの画像を取得する。stagingの保存済みdeckをproductionの匿名公開deckとして扱わない。

### 13.2 P1: 縦持ちスマートフォンの本文を読めるpreview経路

サムネイルの識別と**本文の読解は別条件**。960×540の26〜30px本文を320pxへ均等縮小すると約8.7〜10pxになるため、見出し／画像だけ見えることを合格にしない。10ページの全ページpreviewに明示的な「拡大して読む」操作を設け、縦持ちの幅320px・390pxでも固定960px幅（等倍・本文26〜30 CSS px、slide 10の指示30px）を横スクロール・必要なら縦スクロールで端まで読める専用領域を開く。現在ページと横スクロール可能であることを表示し、スクロールでページ送りしない。ページ選択／前後操作は別の押せるコントロールに置き、拡大領域は閉じてサムネイル一覧へ戻れる。viewerにも同じ「拡大して読む」導線とスクロール領域を設け、拡大中はスライド面タップで次頁に進ませない（前後は専用コントロール）。§12.4の「全画面」は対応環境の任意の発表操作に限り、iOS SafariのFullscreen APIやピンチズーム成功を読解の必須経路にしない。エディタの960×540内容や通常の縮小表示は変えず、読解用の表示だけ追加する。表紙の焼き込み文字も等倍で読めるか目視し、不可なら画像構図を再検討してオーナーに再提示する。

### 13.3 P2: 既存表紙を使う場合の全コピー確認

表紙は引き続き既存 `apps/web/public/og-default.png` の**文字入りオリジナル画像**を使う。§12.1の表で列挙した `events lab`・「募集から配信まで全部やる。」に加え、ラスターに焼き込まれた `BETA`・「告知」「参加」「プレゼン」「配信」・`events.kojira.io` とボタンに見える装飾も、制作・コピー審査の対象とする。これらはv2 text要素や実際の操作ボタンではない。BETA表記・各機能名・装飾が現在の公開体験と矛盾しないか、10ページ表紙を見たオーナーが意図して採用する。合意が得られなければ表紙だけ目的に合った新規の文字入りアートへ変更する**別の設計判断**を先に承認し、実装時に無断で置換しない。

### 13.4 修正後の受入証拠と境界

実装承認後に限り、配信分岐のstaging/production別テストで正確なサンプルGETの10ページ、既存2＋新8の全src、8件だけの環境別origin、正しいJSON MIME/キャッシュヘッダ、無関係のJSON・任意の外部ユーザーURL・保存済みdeckへの非介入を確認する。stagingの認証済みサンプル→実画像10 GET（既存2はproduction）→全10ページのサムネイル・拡大preview→保存→editor／reload→viewerを**画像リクエストのinterceptやmockなし**で記録し、8 PNGの応答ステータス/MIME/bytesと保存deckのstaging srcを照合する。画像GETがゲートHTMLや404を返せば不合格。匿名stagingでゲートが残ることと、ゲートなしの匿名public viewer経路を上記条件で別々に確認する。デスクトップと実ブラウザの縦持ち320px／390pxで、全ページの欠け・サムネイル識別だけでなく、等倍読解経路で**実際の本文・10ページ目の空枠差替指示・表紙文字を人が読める**こと、横方向末尾まで操作可能なことをオーナーが確認する。実機iOSでもFullscreen非対応に依存せず読めることを確認する。production GOはstagingでの実画像・読解・公開境界の承認後に別途取得し、GO後はproduction全10 URLと匿名viewerを実GETで確認する。これらは将来の受入条件であり、現時点でテスト／配備済みという意味ではない。
