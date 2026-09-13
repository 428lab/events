# events-lab-deck version 1

960×540の公開スライドJSON仕様。保存するとURLを知る人はログインせず閲覧できます。機密情報・個人情報をLLMやスライドに入れないでください。画像は保存後に人が差し替えます。

### 解析と共通規則 解析と共通規則

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


## JSON Schemaとの関係

[schema.json](schema.json) はDraft 2020-12です。Schema単体の合格は保存可能の保証ではありません。UTF-8総量、UTF-16計数（SchemaのmaxLengthはコードポイント計数）、合計文字数・要素数、座標和、重複キー、不正Unicode、深度は共通バリデーターと本仕様で追加検証します。v1の受理範囲や意味は拡張しません。

[prompt.txt](prompt.txt)・[表紙](sample-title.json)・[箇条書き](sample-bullets.json)・[比較](sample-comparison.json)

## 表示と変換

文字はプレーンテキスト、縦中央、line-height 1.3、pre-wrap、break-word、overflow hidden。自動縮小はありません。fontはdefault→標準書体、serif→serif、monospace→monospace。画像空枠はsrc無しのimageとなり灰色の枠で表示されます。位置・色・順序・文字は補正しません。保存時にサーバーがIDを採番します。変換後の内部本文もUTF-8 1MiB以下である必要があります。
