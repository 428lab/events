# 写真NG（No photo）のアンケートプリセットと名札マーク (D-NOPHOTO)

## 参加アンケート

- 編集画面（参加アンケート）のスイッチ「写真NG（No photo）の希望を聞く」で、定型の質問を1問足す／外す。
  外すときに回答が集まっていれば確認する（保存すると回答も削除。通常の質問の削除と同じ）。
- `event_survey_question.preset`（migration `0104_survey_question_preset.sql`）。NULL は通常の質問、
  `'no_photo'` がプリセット。`(event_id, preset)` の部分一意インデックスで1イベント1問まで。
- 保存入力は `{ id?, preset: "no_photo" }` だけ。質問文・形式（select）・選択肢・必須はサーバーが
  `SURVEY_PRESET_QUESTIONS` の固定値で書く。送られた文言は捨てる。同じプリセットを2つ送ると400。
- 保存値は言語に依存しない `ok` / `no_photo`。回答の検証は通常の select と同じく選択肢一致なので、
  これ以外（訳した文言を含む）は `invalid_option`。必須の扱いも他の必須質問と同じ。
- 文言は閲覧者の言語（`NO_PHOTO_TEXT`。画面の辞書 `eventForm.noPhoto*` もここを引く）:
  - ja: 写真への写り込みを避けたいですか？／撮影OK／写真NG（No photo）
  - en: Do you prefer not to be photographed?／Photos OK／No photo
- 参加者の回答フォーム、アクセス統計の回答一覧（写真NG・撮影OKの人数のまとめつき）、
  回答CSVと入館名簿CSVに適用。CSVは画面が `?lang=` で表示言語を渡す（無ければ Accept-Language、どれも無ければ日本語）。
  CSVの他の列見出しは従来どおり日本語。
- メンバー一覧・イベント詳細には出さない。
- 通常の質問の id をプリセットとして送っても（逆も）入れ替えず、別の質問として作り直す。

## 名札

- 画像パーツの表示内容に `noPhoto`（写真NG（No photo）マーク）を追加。選択・移動・リサイズは他のパーツと同じ。
  画像は既定で同梱の `apps/web/public/card-no-photo.svg`（カメラに斜線＋NO PHOTO）。
  イベントのアップロード画像を選ぶと差し替わる（`cardDesignAssetIds` に入るので所有・コピー・削除拒否も通常の画像と同じ）。
- 名札一覧 `GET /events/:id/name-cards`（確定スタッフのみ）に `noPhoto: boolean` を追加。
  プリセットに `no_photo` と答えた人だけ true。マークは true のカードにだけ描く。
- 編集画面のプレビューは、位置を決められるよう常にマークを出す（見本・選んだメンバーとも noPhoto 扱い）。
- 組み込みテンプレート（名前重視・プロフィール交流・役割重視）すべての右上（x930 y24、120×120）に入る。
  名前・QR・アイコンと重ならない。
- **保存済みのデザインは変更しない**（自動で足さない）。既存イベントで使うには、テンプレートを適用し直すか、
  パーツを追加して表示内容を「写真NG（No photo）マーク」にする。
