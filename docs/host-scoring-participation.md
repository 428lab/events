# 主催・運営の採点対象参加（#536）

## 目的と範囲

主催者も他の運営メンバーも、自分の作品を採点対象にするかを選べるようにする。採点する権限ではない。現行では作成者に staff の event_member だけが作られ、通常参加登録も既存メンバーなら終了する。対象一覧は staff を除外しておらず、Entry を作れば既存の提出・採点経路が使える。

個人 Entry の存在を ON とし、新しいフラグ・テーブル・移行は作らない。既存 Entry は ID、提出物、点数、発表順を含めそのまま使う。通常参加の登録・取消、staff の role/status/参加枠/定員、採点権限と自己採点設定は変更しない。チーム API/UI（#9）は対象外。

## 操作

ハッカソン（既存の contestMode）が有効な個人イベントの本人作品欄に、myRole が staff のときだけ「自分も採点対象として参加する」スイッチを置く。通常イベントには出さない。Entry 読込中・変更中は操作不可、変更中は既存の進捗表示、失敗は短いエラーを表示する。ON/OFF はサーバーの Entry 一覧を再取得して反映し、楽観的にデータを消さない。

- 自分の個人 Entry がなければ初期 OFF。ON で既存の本人作品フォームが現れ、資料・ソース URL を保存でき、他の採点者の対象になる。
- 既存の個人 Entry があれば初期 ON。読み込みや再 ON で作り直さない。
- OFF は「採点対象への参加を取り消しますか？提出済みのURLも削除されます。」と確認する。取消なら何もしない。
- 自分の Entry に点数が1件でもあれば OFF を拒否し「採点済みのため参加を取り消せません。」と表示。Entry・提出物・点数を保持する。
- 日英の既存辞書と MUI Switch/Alert/進捗表示、既存の window.confirm を使用する。追加の説明や警告の枠組みは作らない。

## API・権限

`PUT /api/events/:id/entries/self/participation`、JSON は厳密に `{ participating: boolean }`。userId/entryId は受け取らない。本人は既存認証から取得する。他人を指定する入力は400。成功は200 `{ entry: Entry | null }`。

既存のイベント閲覧ゲートと認証を通し、現時点の参加確定 staff（既存 isConfirmedEventStaff と eventWrite の staff 基準）だけ許可する。非staff は403、非閲覧イベントは従来どおり404。アプリ管理者・コミュニティ管理者というだけでは操作不可。contestMode 無効・個人以外は409 `participation_unavailable`。採点済み OFF は409 `entry_already_scored`、書込時に権限・イベント条件が変わった場合は409 `access_changed`。

## 原子性・再試行

既存 entriesRepo と eventWrite/D1 batch を使用する。バッチ内で現在の staff・有効ユーザー・イベント閲覧権限を再確認し、contest_mode と participation_type も検証する。

ON は本人の個人 Entry が存在しない場合だけ INSERT SELECT し、新しい ID が実際に作られた場合だけ entry_member を挿入する。同じバッチなので二重作成や Entry だけ残る状態を避ける。既存があれば更新しない。

OFF は同じバッチ内で、対象イベントの本人個人 Entry に紐づく score が存在しないことを SQL assertion で検証してから、その本人個人 Entry だけ削除する。点数があればバッチ全体を中止する。事前のUI/読取結果だけに依存しない。D1 の直列トランザクションにより、採点が先なら OFF は拒否、OFF が先なら既存の対象確認と Entry 参照の外部キー制約により、削除済み Entry への点数は保存されない。Entry の既存 CASCADE による提出物・所属削除を使う。既に OFF なら成功する。通信失敗時も再操作でき、ON は再利用、OFF は現在の点数条件を再確認する。

## 変更箇所・受入

entriesRepo、eventEntries ルート、shared 入力、web API hook、EventSubmissions と呼出元、日英辞書のみが製品コードの対象。

ルート/D1 テストで主催・運営 ON→提出→他者採点、未採点 OFF、採点済み OFF 拒否とデータ保持、既存 staff Entry 保持、非staff/他人指定拒否、通常参加者の登録・提出・採点・取消を確認する。既存の認証境界テストも実行する。重要な採点保持 assertion の変異は使い捨てコピーで確認する。

新しい隔離ローカル D1 にだけ架空ユーザー・イベント・テスト専用セッションを作り、実際の web/Worker とブラウザでスイッチ→提出→未採点 OFF→再 ON→別の架空参加者による採点→OFF 拒否を確認する。既存ユーザー/実セッションやリモート DB は使わない。型検査・関連テスト・web build をローカル、必須全件検証は対象 SHA の PR CI で確認する。専用 feature ブランチを push して staging 向け Draft PR まで。独立レビュー前の staging push、main/production 操作・配備はしない。
