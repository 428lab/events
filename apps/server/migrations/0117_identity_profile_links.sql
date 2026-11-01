-- 公開プロフィールに、連携しているアカウントへのリンクを出す (docs/profile-social-links.md)。
--
-- 1) identity.profile_public: 本人が「プロフィールに表示する」をオンにした連携だけ 1。
--    オプトイン方式なので既定は 0。既存の連携もすべて 0 のまま（勝手に公開しない）。
-- 2) identity.public_handle: リンクと表示に使う連携先のユーザー名（GitHub の login、
--    X の username、Bluesky のハンドル）。ログイン・連携のたびに連携先から受け取った
--    値で上書きする。連携先で名前を変えても次のログインで追いつく。
--    識別子は今までどおり provider_user_id（数値ID・DID・pubkey）で、この列は表示用。
--
-- どちらも identity の列で、identity は統合で勝ち側へ移り（行ごと）、退会の完全削除で
-- user 行と一緒に消える（FK CASCADE）。user を参照する列は増えないので userTables の
-- 登録は要らない。
ALTER TABLE identity ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE identity ADD COLUMN public_handle TEXT;
