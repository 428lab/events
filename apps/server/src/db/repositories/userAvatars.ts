import { one, run } from "../client.js";
import { ACTIVE } from "./users.js";

/** 自前保管したアイコン (#312/#313) とプロフィールカードPNG (#193) の**メタ情報**。
 * 実体（R2 のオブジェクト）は lib/avatarStore.ts と routes/*Images.ts が扱う。
 * user 表の列を読み書きするのでユーザーのリポジトリと同じ表を触るが、
 * プロフィールそのものではないので分けてある */
export const userAvatarsRepo = {
  /** 自前保管したアイコン (#312) のメタ。配信 (routes/avatarImages.ts) と
   * 「中身が変わったときだけ書き込む」判定 (lib/avatarStore.ts) の両方で使う。
   * 退会申請中 (#250) は null＝配信しない（他の参照系と同じ扱い） */
  async findAvatarImage(userId: string): Promise<{
    updatedAt: number;
    mime: string | null;
    hash: string | null;
  } | null> {
    const row = await one<{
      avatar_image_updated_at: number | null;
      avatar_image_mime: string | null;
      avatar_image_hash: string | null;
    }>(
      `SELECT avatar_image_updated_at, avatar_image_mime, avatar_image_hash
       FROM user WHERE id = ? AND ${ACTIVE}`,
      userId,
    );
    if (!row?.avatar_image_updated_at) return null;
    return {
      updatedAt: row.avatar_image_updated_at,
      mime: row.avatar_image_mime,
      hash: row.avatar_image_hash,
    };
  },

  /** 取り込み側 (lib/avatarStore.ts) がまとめて要る状態 (#313)。
   * スロットル判定・ハッシュ比較・取得元URLの比較を1回の SELECT で賄う。
   * findAvatarImage と分けているのは、あちらが「配信できる画像があるか」を
   * 表す null を返すのに対し、こちらは画像が無くても行の状態が要るため */
  async findAvatarSyncState(userId: string): Promise<{
    updatedAt: number | null;
    mime: string | null;
    hash: string | null;
    sourceUrl: string | null;
    attemptedAt: number | null;
  } | null> {
    const row = await one<{
      avatar_image_updated_at: number | null;
      avatar_image_mime: string | null;
      avatar_image_hash: string | null;
      avatar_source_url: string | null;
      avatar_sync_attempted_at: number | null;
    }>(
      `SELECT avatar_image_updated_at, avatar_image_mime, avatar_image_hash,
              avatar_source_url, avatar_sync_attempted_at
       FROM user WHERE id = ? AND ${ACTIVE}`,
      userId,
    );
    if (!row) return null;
    return {
      updatedAt: row.avatar_image_updated_at,
      mime: row.avatar_image_mime,
      hash: row.avatar_image_hash,
      sourceUrl: row.avatar_source_url,
      attemptedAt: row.avatar_sync_attempted_at,
    };
  },

  /** 取り込みを試みた時刻を記録する (#313)。取得の前に呼ぶ。
   * 成否や中身の変化に関わらず進むので、これでスロットルすれば
   * 「毎回同じ画像を返すURL」でも外向き fetch ごと抑止できる */
  async touchAvatarSyncAttempt(userId: string, at: number): Promise<void> {
    await run(
      "UPDATE user SET avatar_sync_attempted_at = ? WHERE id = ?",
      at,
      userId,
    );
  },

  /** 取得元URLだけを更新する (#313)。
   * 連携先がURLをローテーションしても画像は同じ、というケース（CDN でよくある）で
   * 使う。?v= は進めない（中身が同じなので再ダウンロードさせない）が、
   * 切り戻し用に控えているURLが既に404のものになるのは避けたい */
  async setAvatarSourceUrl(userId: string, sourceUrl: string): Promise<void> {
    await run(
      "UPDATE user SET avatar_source_url = ? WHERE id = ?",
      sourceUrl,
      userId,
    );
  },

  /** 自前保管したアイコンを記録する (#312)。
   * avatar_url も同時に自ドメインのURLへ差し替える（表示側は全てここを読む）。
   * 1文にまとめてあるので「R2 には入ったが URL が連携先のまま」にはならない。
   *
   * 取り込み元URL (sourceUrl) も併せて残す。avatar_url を上書きしてしまう以上、
   * ここに控えないと元の連携先URLがどこにも残らず、切り戻しができなくなる (#313) */
  async setAvatarImage(
    userId: string,
    avatarUrl: string,
    updatedAt: number,
    mime: string,
    hash: string,
    sourceUrl: string,
  ): Promise<void> {
    await run(
      `UPDATE user SET avatar_url = ?, avatar_image_updated_at = ?,
         avatar_image_mime = ?, avatar_image_hash = ?, avatar_source_url = ?
       WHERE id = ?`,
      avatarUrl,
      updatedAt,
      mime,
      hash,
      sourceUrl,
      userId,
    );
  },

  /** プロフィールカードPNG（OG画像キャッシュ）の更新時刻と選択中の組み合わせを記録 (#193, #201) */
  async setCardImage(userId: string, ts: number, key: string): Promise<void> {
    await run(
      "UPDATE user SET card_image_updated_at = ?, card_image_key = ? WHERE id = ?",
      ts,
      key,
      userId,
    );
  },
};
