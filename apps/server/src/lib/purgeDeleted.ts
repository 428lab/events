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
 *
 * Workers Free のサブリクエスト上限は 1リクエストあたり 50 で、D1 / R2 への
 * 呼び出しもここに含まれる。1件あたりの内訳は最低でも
 *   findByIdIncludingDeleted 1
 * ＋ collectUserObjectKeys の D1 4（decks / live_set / bgm / event_photo）
 * ＋ R2 list（プロフィールカード + スライド数 + 配信セット数 なので最低 1）
 * ＋ deleteAccount の batch 1
 * ＋ recordAudit 2（INSERT と保存期間の掃除）
 * ＋ R2 delete（キーがあれば 1000件ごとに 1）
 * ＝ 最低 9・実際は 11 前後で、スライドや配信セットが多いほど増える。
 * 固定分（listPurgeTargets 1 ＋ ensureDeletedUser 1 ＋ 残件カウント 1）と
 * 合わせて 4件 × 11 + 3 = 47 で上限内に収まる。20件では確実に超過していた。
 *
 * 上限に達した残りは翌日に回る。1日4件を超える退会が続くと消化が追いつかない
 * ので、その場合はログ（[account-purge] remaining=）を見て手動実行
 * （POST /api/admin/run-purge-deleted）で補うか、有料プランの上限
 * （1000サブリクエスト）を前提に引き上げること */
const MAX_PURGES_PER_RUN = 4;

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

/** 猶予期間を過ぎた退会申請を完全削除する。処理した件数と積み残しを返す。
 * 1件の失敗で全体を止めないよう、ユーザーごとに try/catch する（残りは翌日再試行）。
 * failed > 0 / remaining > 0 は呼び出し側（GitHub Actions）が検知できるよう返す */
export async function purgeDeletedAccounts(
  now = Date.now(),
): Promise<{ purged: number; failed: number; remaining: number }> {
  const cutoff = now - ACCOUNT_DELETION_GRACE_MS;
  const ids = await usersRepo.listPurgeTargets(cutoff, MAX_PURGES_PER_RUN);
  if (ids.length === 0) return { purged: 0, failed: 0, remaining: 0 };

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
  // 上限まで取れたときだけ残件を数える（毎回数えるとサブリクエストを1つ無駄にする）。
  // 失敗して deleted_at が残っている分もここに含まれ、翌日再試行される
  const remaining =
    ids.length < MAX_PURGES_PER_RUN
      ? failed
      : await usersRepo.countPurgeTargets(cutoff);
  if (remaining > 0) {
    console.warn(
      `[account-purge] remaining=${remaining} (purged=${purged} failed=${failed} limit=${MAX_PURGES_PER_RUN})`,
    );
  }
  return { purged, failed, remaining };
}
