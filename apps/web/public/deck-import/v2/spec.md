# スライドJSONの仕様

events labに取り込める960×540の公開スライドJSON仕様です。保存したスライドはURLを知る人ならログインせず閲覧できます。機密情報・個人情報や秘密入り画像URLをLLMやスライドに入れないでください。

## 入力と上限

- BOMなしUTF-8のJSONオブジェクト1個のみ。貼付／ファイルの空白も含む原稿全体は1,048,576 bytes以下。説明文、コードフェンス、コメント、末尾カンマ、重複キー、不正UTF-8・孤立サロゲートは禁止。前後のJSON空白は許可します。最大コンテナ深度は6。未知キー・省略・null・値の型変換・自動補完を許可しません。
- rootは`format:"events-lab-deck"`, 数値の`version:2`, `title`, `slides`の4キーのみ。titleは0〜120 UTF-16コード単位、前後の空白と制御文字U+0000〜001F・U+007Fは禁止。slidesは1〜60ページ、各ページには`background`と`elements`だけが必須。背景色と文字色は`#RRGGBB`の6桁。elementsは0〜50個／ページ、合計1,000個以下。配列の後ろが前面です。
- 座標は960×540上のpxで、有限の数（小数も可）。`x`・`y`は負やスライドの外も可（はみ出した位置もそのまま保存します）、`w`・`h`は0以上。要素は次の3種類だけで、必須キーと任意キーのほかは許可しません（`alt`等）。文字列長はUTF-16コード単位（絵文字の多くは2）。
- どの要素にも任意で`rotation`（度。有限の数。省略は0）と`group`（1〜64単位の文字列。同じ値の要素は編集画面でまとめて選択・移動されます。省略はグループなし）を付けられます。

| 要素 | 必須キー・値 |
| --- | --- |
| text | 必須は`type:"text",x,y,w,h,text`。textは0〜10,000単位（空も可）、全text合計100,000以下。プレーンテキストのみ。任意で`fontSize`（0以上の数）、`font`、`color`（6桁RGB）、`bold`/`italic`（boolean）、`align`（`left`/`center`/`right`）。省略したものは表示の既定（28px・既定の書体・#0F172A・太字なし・斜体なし・左揃え）になります。fontは`default`/`Plus Jakarta Sans`/`serif`/`monospace`と、編集画面で選べるGoogle Fontsの書体名（[schema.json](schema.json)の`font`の一覧。例: `Noto Sans JP`, `M PLUS Rounded 1c`, `Noto Serif JP`）。 |
| 未設定画像 | `type:"image-placeholder",x,y,w,h`のみ。src不可。保存後に本人が編集画面で画像をアップロードできます。 |
| URL画像 | `type:"image-url",x,y,w,h,src`のみ。srcは空でない最大500 UTF-16単位のHTTPS絶対URL。孤立サロゲート、U+0000〜001F・U+007F〜009F、URLの認証情報を禁止。baseなしのWHATWG URLとして解析しprotocolが`https:`、username/passwordが空であること。`http:`/`data:`/`blob:`/相対パスは不可（AIエージェントが既存のスライドを直すときは、今の中身にあるsrcをそのまま戻せます。[agent.md](../agent.md)）。 |

編集画面の「書き出す」はこの形で書き出し、取り込み直すと同じ中身に戻ります（内部IDと並びのキーだけ振り直します）。

URLは元の表記のまま保存・表示します。大文字host、国際化ドメイン、IP、明示port、fragment、URLパーサーが扱う空白を一律に拒否・正規化しません。query/fragmentも文字数に含みます。ブラウザとサーバーは同じvalidatorで検証し、元原稿／URL／queryをエラーや修正指示に反射しません。

[schema.json](schema.json) はDraft 2020-12ですが、SchemaのmaxLengthはコードポイント単位です。URLのHTTPS・認証情報・制御文字判定、UTF-16長、文字・要素の総数、UTF-8 bytes、重複キーと深度はschema単体では保証できません。この仕様と共通validatorが正です。[プロンプト](prompt.txt)と[画像付き紹介サンプル](sample-events-lab-intro.json)を利用できます。

## 保存・表示と画像の注意

image-urlは`src`を持つ既存のimage要素へ投影、空枠はsrc無しのimageへ投影します。内部IDを採番し、変換後のdeck本文もUTF-8 1MiB以下である必要があります。ブラウザで全ページと画像を確認し、公開同意の上ログインして保存します。保存は原子的で同一キー再送は同じdeckへ戻ります。URL画像はプレビュー・編集・公開閲覧のたびに閲覧者のブラウザから画像ホストへ直接GETします。画像ホストにアクセス元IP・時刻等が知られ得ます。外部画像を使いたくない場合は未設定枠にして保存後に自分でアップロードしてください。サーバーは外部画像を取りに行かず画像の永続性や内容を保証しません。期限切れやHotlink制限等で読み込めなければ枠内に失敗を表示しますがsrcを消さず、保存を止めません。画像が読み込み中なら手動確認してから保存してください。すでに自分が公開しているHTTPS画像URLだけを原稿のsrcへ入れ、架空URLや秘密入りURLを使わないでください。
