# スライドJSONの仕様

events labに取り込める960×540の公開スライドJSON仕様です。保存したスライドはURLを知る人ならログインせず閲覧できます。機密情報・個人情報や秘密入り画像URLをLLMやスライドに入れないでください。

## 入力と上限

- BOMなしUTF-8のJSONオブジェクト1個のみ。貼付／ファイルの空白も含む原稿全体は1,048,576 bytes以下。説明文、コードフェンス、コメント、末尾カンマ、重複キー、不正UTF-8・孤立サロゲートは禁止。前後のJSON空白は許可します。最大コンテナ深度は6。未知キー・省略・null・値の型変換・自動補完を許可しません。
- rootは`format:"events-lab-deck"`, 数値の`version:2`, `title`, `slides`の4キーのみ。titleは1〜120 UTF-16コード単位、前後の空白と制御文字U+0000〜001F・U+007Fは禁止。slidesは1〜60ページ、各ページには`background`と`elements`だけが必須。背景色と文字色は`#RRGGBB`の6桁。elementsは0〜50個／ページ、合計1,000個以下。配列の後ろが前面です。
- 座標は960×540上の有限整数px。`x:0〜940`, `y:0〜520`, `w:20〜960`, `h:20〜540`、`x+w≤960`, `y+h≤540`。要素は次の3種類だけで、すべて記載したキーを必須とし、追加キー（`alt`等）を許可しません。文字列長はUTF-16コード単位（絵文字の多くは2）。数値の`1.0`等は整数なら許可します。

| 要素 | 必須キー・値 |
| --- | --- |
| text | `type:"text",x,y,w,h,text,fontSize,font,color,bold,italic,align`。textは1〜10,000単位、全text合計100,000以下。改行LF以外のU+0000〜001FとU+007Fは禁止。空白だけの文字は警告。fontSizeは整数12〜160、fontは`default`/`serif`/`monospace`、colorは6桁RGB、bold/italicはboolean、alignは`left`/`center`/`right`。プレーンテキストのみ。 |
| 未設定画像 | `type:"image-placeholder",x,y,w,h`のみ。src不可。保存後に本人が編集画面で画像をアップロードできます。 |
| URL画像 | `type:"image-url",x,y,w,h,src`のみ。srcは空でない最大500 UTF-16単位のHTTPS絶対URL。孤立サロゲート、U+0000〜001F・U+007F〜009F、URLの認証情報を禁止。baseなしのWHATWG URLとして解析しprotocolが`https:`、username/passwordが空であること。`http:`/`data:`/`blob:`/相対パスは不可。 |

URLは元の表記のまま保存・表示します。大文字host、国際化ドメイン、IP、明示port、fragment、URLパーサーが扱う空白を一律に拒否・正規化しません。query/fragmentも文字数に含みます。ブラウザとサーバーは同じvalidatorで検証し、元原稿／URL／queryをエラーや修正指示に反射しません。

[schema.json](schema.json) はDraft 2020-12ですが、SchemaのmaxLengthはコードポイント単位です。URLのHTTPS・認証情報・制御文字判定、UTF-16長、文字・要素の総数、UTF-8 bytes、座標和、重複キーと深度はschema単体では保証できません。この仕様と共通validatorが正です。[プロンプト](prompt.txt)と[画像付き紹介サンプル](sample-events-lab-intro.json)を利用できます。

## 保存・表示と画像の注意

image-urlは`src`を持つ既存のimage要素へ投影、空枠はsrc無しのimageへ投影します。内部IDを採番し、変換後のdeck本文もUTF-8 1MiB以下である必要があります。ブラウザで全ページと画像を確認し、公開同意の上ログインして保存します。保存は原子的で同一キー再送は同じdeckへ戻ります。URL画像はプレビュー・編集・公開閲覧のたびに閲覧者のブラウザから画像ホストへ直接GETします。画像ホストにアクセス元IP・時刻等が知られ得ます。外部画像を使いたくない場合は未設定枠にして保存後に自分でアップロードしてください。サーバーは外部画像を取りに行かず画像の永続性や内容を保証しません。期限切れやHotlink制限等で読み込めなければ枠内に失敗を表示しますがsrcを消さず、保存を止めません。画像が読み込み中なら手動確認してから保存してください。すでに自分が公開しているHTTPS画像URLだけを原稿のsrcへ入れ、架空URLや秘密入りURLを使わないでください。
