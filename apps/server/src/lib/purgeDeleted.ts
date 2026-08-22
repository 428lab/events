import { env, getBucket } from "../runtime.js";
import { usersRepo } from "../db/repositories/users.js";
import { recordAudit } from "../db/repositories/auditLogs.js";
import { decksRepo } from "../db/repositories/decks.js";
import { liveSetsRepo } from "../db/repositories/liveSets.js";
import { bgmTracksRepo } from "../db/repositories/bgmTracks.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";
import { avatarKey } from "./avatarStore.js";

/** 退会猶予期間 (#250) を過ぎたアカウントの完全削除。
 * GitHub Actions の定時実行から POST /api/cron/purge-deleted 経由で呼ばれる
 * （Workers Free の cron 上限のため。リマインダー #129 と同じ方式）。
 *
 * ■ サブリクエスト予算について
 * Workers Free のサブリクエスト上限は 1リクエストあたり 50 で、D1 / R2 への
 * 呼び出しもここに含まれる。1件あたりの消費数は
 *   9（固定）＋ デッキ数 ＋ 配信セット数 ＋ ceil(R2キー数 / 1000)
 * とユーザーの持ちデータ量に比例するため、「1回に N 件」という件数固定では
 * 上限を守れない（デッキを 40 個持つ人が1人居るだけで超過する）。しかも上限を
 * 超えると同一リクエスト内の以降のサブリクエストが全部失敗するので、
 * try/catch では守れず「毎日同じところで詰まる」状態になる。
 *
 * そこで件数ではなく実際に消費したサブリクエスト数を積算し、次の1件を始める
 * 余裕が無くなった時点で打ち切る方式にしている。積み残しは remaining として
 * 返し、翌日の実行に回す。 */

/** 1回の実行で使ってよいサブリクエスト数。実上限 50 に対し、見積もり誤差と
 * 打ち切り後の countPurgeTargets（1）ぶんの余裕を残して 40 に置く */
const SUBREQUEST_BUDGET = 40;

/** 1件あたりの最小消費数（データを何も持たないユーザーの場合）。
 *   findByIdIncludingDeleted 1
 * ＋ collectUserObjects の D1 4（decks / live_set / bgm / event_photo）
 * ＋ プロフィールカードの R2 list 1
 * ＋ deleteAccount の batch 1
 * ＋ deleteAccount 内のスタッフチャット列挙 (#382) 1
 *   （部屋があれば +1/部屋。実消費は deleteAccount の戻り値で budget に積む）
 * ＋ recordAudit 2（INSERT と保存期間の掃除）
 * ＝ 10。R2 に実体があれば delete でさらに 1 以上増えるので 11 で見積もる。
 * 次の1件がこれ以下の余裕しか無ければ打ち切る */
const MIN_COST_PER_USER = 11;

/** 1回の実行で見に行く候補の最大数。実際には予算のほうが先に効くが、
 * listPurgeTargets が無制限に行を読まないための保険 */
const MAX_CANDIDATES_PER_RUN = 20;

/** 消費したサブリクエスト数のカウンタ。例外で途中終了しても消費済みの分が
 * 残るよう、戻り値ではなく参照渡しで加算する */
interface Budget {
  spent: number;
}

/** 退会するユーザー由来の R2 オブジェクトキーを列挙する (#244)。
 * 行削除後はキーを辿れなくなるため、DB 削除前に呼ぶこと。
 * 対象: スライド画像・配信セット画像・BGM 音源・イベント写真・プロフィールカードPNG・
 * 自前保管のアイコン (#312)。
 * デッキ数・配信セット数だけ R2 list が増えるので、消費数を budget に積む */
async function collectUserObjects(
  userId: string,
  budget: Budget,
): Promise<string[]> {
  const bucket = getBucket();
  const decks = await decksRepo.listByOwner(userId);
  const liveSets = await liveSetsRepo.listByOwner(userId);
  const keys = await bgmTracksRepo.listKeysByOwner(userId);
  const photos = await eventPhotosRepo.listIdsByUser(userId);
  budget.spent += 4;
  for (const p of photos) keys.push(`event-photos/${p.eventId}/${p.id}`);
  // 自前保管のアイコン (#312) は 1ユーザー1キー固定なので list は要らない。
  // 保管していなければ存在しないキーを消すだけ（削除は下でまとめて投げるので費用ゼロ）
  keys.push(avatarKey(userId));
  const prefixes = [
    ...decks.map((d) => `deck-images/${d.id}/`),
    ...liveSets.map((s) => `live-set-images/${s.id}/`),
    // プロフィールカードPNG。旧キー profile-cards/{id}.png と
    // 組み合わせ別 profile-cards/{id}/{combo}.png の両方に一致させる
    `profile-cards/${userId}`,
  ];
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      budget.spent += 1;
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
  const cutoff = now - env.deletionGraceMs;
  const budget: Budget = { spent: 1 }; // listPurgeTargets
  const ids = await usersRepo.listPurgeTargets(cutoff, MAX_CANDIDATES_PER_RUN);
  if (ids.length === 0) return { purged: 0, failed: 0, remaining: 0 };

  // 共有コンテンツの引き受け先。対象が居るときだけ作る（無駄な ghost を作らない）
  const ghost = await usersRepo.ensureDeletedUser();
  budget.spent += 1;
  let purged = 0;
  let failed = 0;
  /** 1件でも実際に処理を始めたか。予算チェックのフォールバック判定に使う */
  let attemptedAny = false;
  let stoppedForBudget = false;
  for (const userId of ids) {
    // 予算チェック。ただし「まだ1件も処理していない」ときは予算を無視して進む。
    // 単独で予算を超える巨大ユーザーが1人居るだけで毎回そこで止まり、誰も
    // 削除されなくなる（＝永久に詰まる）のを避けるためのフォールバック。
    // listPurgeTargets は deleted_at の古い順なので、詰まりの原因になる人は
    // いつか必ず先頭に来る＝どこかの実行で必ず処理が試みられる
    if (attemptedAny && budget.spent + MIN_COST_PER_USER > SUBREQUEST_BUDGET) {
      stoppedForBudget = true;
      break;
    }
    // 「退会済みユーザー」自身は identity が無くログイン不可＝退会申請もできない
    // はずだが、消すと共有コンテンツの引き受け先が失われるので多重防御
    if (userId === ghost.id) continue;
    const startedAt = budget.spent;
    try {
      budget.spent += 1;
      const user = await usersRepo.findByIdIncludingDeleted(userId);
      if (!user || user.deletedAt === null) continue; // 直前に復帰した
      attemptedAny = true;
      const objectKeys = await collectUserObjects(userId, budget);
      console.log(
        `[account-purge] user=${userId} handle=${user.username} ghost=${ghost.id} r2Objects=${objectKeys.length}`,
      );
      // deleteAccount は自分の batch(1) に加えて、スタッフチャットの
      // ローテーション (#382) で消費した数を返す（部屋の数だけ増える）
      budget.spent += 1 + (await usersRepo.deleteAccount(userId, ghost.id));
      // 監査ログ (#248)。user 行は消えるが FK を張っていないので記録は残る
      budget.spent += 2;
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
          budget.spent += 1;
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
    // 単独で予算を超えるユーザーは上のフォールバックで押し通しているので、
    // 上限に張り付いて他の削除を圧迫していないか気づけるようログに出す
    const cost = budget.spent - startedAt;
    if (cost > SUBREQUEST_BUDGET) {
      console.error(
        `[account-purge] user=${userId} cost=${cost} exceeds budget=${SUBREQUEST_BUDGET}; ` +
          "この1件だけで実行枠を使い切っている（R2 の持ち物が多すぎる可能性）",
      );
    }
  }
  // 打ち切った場合と候補を取り切った場合だけ残件を数える（毎回数えると
  // サブリクエストを1つ無駄にする）。失敗して deleted_at が残っている分も
  // ここに含まれ、翌日再試行される
  const exhausted = stoppedForBudget || ids.length === MAX_CANDIDATES_PER_RUN;
  const remaining = exhausted ? await usersRepo.countPurgeTargets(cutoff) : failed;
  if (remaining > 0) {
    console.warn(
      `[account-purge] remaining=${remaining} (purged=${purged} failed=${failed} subrequests=${budget.spent}/${SUBREQUEST_BUDGET})`,
    );
  }
  return { purged, failed, remaining };
}
