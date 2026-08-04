import { ACCOUNT_DELETION_GRACE_MS } from "@eventer/shared";
import { getBucket } from "../runtime.js";
import { usersRepo } from "../db/repositories/users.js";
import { recordAudit } from "../db/repositories/auditLogs.js";
import { decksRepo } from "../db/repositories/decks.js";
import { liveSetsRepo } from "../db/repositories/liveSets.js";
import { bgmTracksRepo } from "../db/repositories/bgmTracks.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";

/** 退会猶予期間 (#250) を過ぎたアカウントの完全削除。
 * GitHub Actions の定時実行から POST /api/cron/purge-deleted 経由で呼ばれる
 * （Workers Free の cron 上限のため。リマインダー #129 と同じ方式）。 */

/** 1回の実行で完全削除するアカウント数の上限。
 * 1件あたり R2 の list/delete と D1 の batch を伴うため、Workers の
 * サブリクエスト上限に余裕を持たせて控えめにする。取りこぼしは翌日に回る */
const MAX_PURGES_PER_RUN = 20;

/** 退会するユーザー由来の R2 オブジェクトキーを列挙する (#244)。
 * 行削除後はキーを辿れなくなるため、DB 削除前に呼ぶこと。
 * 対象: スライド画像・配信セット画像・BGM 音源・イベント写真・プロフィールカードPNG */
export async function collectUserObjectKeys(userId: string): Promise<string[]> {
  const bucket = getBucket();
  const prefixes = [
    ...(await decksRepo.listByOwner(userId)).map((d) => `deck-images/${d.id}/`),
    ...(await liveSetsRepo.listByOwner(userId)).map(
      (s) => `live-set-images/${s.id}/`,
    ),
    // プロフィールカードPNG。旧キー profile-cards/{id}.png と
    // 組み合わせ別 profile-cards/{id}/{combo}.png の両方に一致させる
    `profile-cards/${userId}`,
  ];
  const keys = await bgmTracksRepo.listKeysByOwner(userId);
  for (const p of await eventPhotosRepo.listIdsByUser(userId)) {
    keys.push(`event-photos/${p.eventId}/${p.id}`);
  }
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ prefix, cursor });
      keys.push(...listed.objects.map((o) => o.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  return keys;
}

/** 猶予期間を過ぎた退会申請を完全削除する。処理した件数を返す。
 * 1件の失敗で全体を止めないよう、ユーザーごとに try/catch する（残りは翌日再試行） */
export async function purgeDeletedAccounts(
  now = Date.now(),
): Promise<{ purged: number; failed: number }> {
  const cutoff = now - ACCOUNT_DELETION_GRACE_MS;
  const ids = await usersRepo.listPurgeTargets(cutoff, MAX_PURGES_PER_RUN);
  if (ids.length === 0) return { purged: 0, failed: 0 };

  // 共有コンテンツの引き受け先。対象が居るときだけ作る（無駄な ghost を作らない）
  const ghost = await usersRepo.ensureDeletedUser();
  let purged = 0;
  let failed = 0;
  for (const userId of ids) {
    // 「退会済みユーザー」自身は identity が無くログイン不可＝退会申請もできない
    // はずだが、消すと共有コンテンツの引き受け先が失われるので多重防御
    if (userId === ghost.id) continue;
    try {
      const user = await usersRepo.findByIdIncludingDeleted(userId);
      if (!user || user.deletedAt === null) continue; // 直前に復帰した
      const objectKeys = await collectUserObjectKeys(userId);
      console.log(
        `[account-purge] user=${userId} handle=${user.username} ghost=${ghost.id} r2Objects=${objectKeys.length}`,
      );
      await usersRepo.deleteAccount(userId, ghost.id);
      // 監査ログ (#248)。user 行は消えるが FK を張っていないので記録は残る
      await recordAudit({
        action: "account_delete_completed",
        target: { id: userId, handle: user.username },
        detail: {
          ghostId: ghost.id,
          r2Objects: objectKeys.length,
          requestedAt: user.deletedAt,
        },
      });
      // R2 の掃除はベストエフォート（失敗しても削除自体は成立。残骸はログで追える）
      try {
        const bucket = getBucket();
        for (let i = 0; i < objectKeys.length; i += 1000) {
          await bucket.delete(objectKeys.slice(i, i + 1000));
        }
      } catch (e) {
        console.error(`[account-purge] R2 cleanup failed for user=${userId}`, e);
      }
      purged += 1;
    } catch (e) {
      // DB 側で失敗した場合は deleted_at が残るため、翌日の実行で再試行される
      console.error(`[account-purge] failed for user=${userId}`, e);
      failed += 1;
    }
  }
  return { purged, failed };
}
