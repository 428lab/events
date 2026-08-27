import { Hono } from "hono";
import { env, getBucket } from "../runtime.js";
import { avatarKey } from "../lib/avatarStore.js";
import type { Context } from "hono";
import {
  deleteAccountInput,
  mergeAccountInput,
  updateDisplayNameInput,
  updateNotificationPrefsInput,
  updateUsernameInput,
} from "@eventer/shared";
import type {
  MergeAccountInput,
  UpdateDisplayNameInput,
  UpdateNotificationPrefsInput,
  UpdateUsernameInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import type { MyBingoResults } from "@eventer/shared";
import { eventBingoRepo } from "../db/repositories/eventBingo.js";
import {
  clearSession,
  pendingDeletionUser,
  requireAuth,
} from "../auth/session.js";
import {
  consumeMergeCode,
  issueMergeCode,
  parseMergeCode,
} from "../auth/mergeCode.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { usersRepo } from "../db/repositories/users.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { followsRepo } from "../db/repositories/follows.js";
import { notificationPrefsRepo } from "../db/repositories/notificationPrefs.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { emailRepo } from "../db/repositories/email.js";
import { eventRequestsRepo } from "../db/repositories/eventRequests.js";
import { recordAudit } from "../db/repositories/auditLogs.js";
import { putMyCardImage } from "./profileCardImages.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.use("*", requireAuth);

/** 本人のビンゴ成績 (#441)。**本人のみ**（公開の口は無い。docs/bingo-history.md §3.5）。
 * 集計は行から都度計算する（保存しない）。分母: 達成率＝全ラウンド /
 * 平均順位・平均抽選回数＝達成ラウンドのみ（未達成に順位は無い） */
meRoutes.get("/bingo-results", async (c) => {
  const results = await eventBingoRepo.resultsForUser(c.get("user").id);
  const done = results.filter((r) => r.rank !== null);
  const avg = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  return c.json({
    results,
    games: results.length,
    achieved: done.length,
    avgRank: avg(done.map((r) => r.rank!)),
    avgSeq: avg(done.map((r) => r.completedAtSeq!)),
  } satisfies MyBingoResults);
});

/** マイページ: 自分が所属する全コミュニティ（参加歴含む・ロール付き） */
meRoutes.get("/communities", async (c) => {
  return c.json({
    communities: await communitiesRepo.listForUser(c.get("user").id),
  });
});

/** マイページ: フォロー中のユーザー（本人のみ・一覧は非公開） */
meRoutes.get("/following", async (c) => {
  return c.json({
    following: await followsRepo.listFollowing(c.get("user").id),
  });
});

/** 自分が投稿したオープンなたまご（会場申込の対象選択用） */
meRoutes.get("/requests", async (c) => {
  return c.json({
    requests: await eventRequestsRepo.listOpenByCreator(c.get("user").id),
  });
});

/** 通知設定の取得/更新 (#21 PR3)。email はメール通知の宛先（連携が無ければ null） (#126) */
meRoutes.get("/notification-prefs", async (c) => {
  const userId = c.get("user").id;
  return c.json({
    prefs: await notificationPrefsRepo.get(userId),
    email: await emailRepo.latestIdentityEmail(userId),
  });
});

meRoutes.put(
  "/notification-prefs",
  zValidator("json", updateNotificationPrefsInput),
  async (c) => {
    const userId = c.get("user").id;
    const prefs = await notificationPrefsRepo.update(
      userId,
      valid<UpdateNotificationPrefsInput>(c, "json"),
    );
    return c.json({ prefs, email: await emailRepo.latestIdentityEmail(userId) });
  },
);

/** マイページ: 開催中 / 過去参加イベント */
meRoutes.get("/events", async (c) => {
  const user = c.get("user");
  const now = Date.now();
  const all = await eventMembersRepo.listEventsForUser(user.id);
  // 日程調整中（endsAt未確定=0）は常に「開催予定」側
  const ongoing = all.filter((e) => e.scheduling || e.endsAt >= now);
  // 過去参加。出席チェックモードで未出席の参加者は「参加した」に含めない
  const past = all.filter(
    (e) =>
      !e.scheduling &&
      e.endsAt < now &&
      !(e.attendanceCheck && e.myRole === "participant" && !e.attended),
  );
  return c.json({ ongoing, past });
});

/** プロフィールカードPNGのアップロード（OG画像用キャッシュ） (#193) */
meRoutes.put("/card-image", putMyCardImage);

/** ユーザー名（プロフィールURLのハンドル）を変更。他ユーザーと被る場合は 409 */
meRoutes.put(
  "/username",
  zValidator("json", updateUsernameInput),
  async (c) => {
    const me = c.get("user");
    const username = valid<UpdateUsernameInput>(c, "json").username.trim();
    // 猶予期間中 (#250) のユーザーのハンドルも予約済みとして扱う
    if (await usersRepo.isUsernameTaken(username, me.id)) {
      return c.json({ error: "taken" }, 409);
    }
    await usersRepo.setUsername(me.id, username);
    return c.json({ ok: true, username });
  },
);

/** アカウント統合コードを発行する (#240)。もう一方のアカウント側で入力して使う */
meRoutes.post("/merge-code", async (c) => {
  return c.json({ code: await issueMergeCode(c.get("user").id) });
});

/** アカウント統合を実行する (#240)。
 * code の発行者と現在のユーザーのどちらを残すか keep で選び、
 * 負け側の全データを勝ち側へ移動して負け側アカウントを削除する */
meRoutes.post("/merge", zValidator("json", mergeAccountInput), async (c) => {
  const me = c.get("user");
  const { code, keep } = valid<MergeAccountInput>(c, "json");
  // 先に署名・期限だけ検証し、実行できないケースではコードを消費しない
  const otherId = await parseMergeCode(code);
  if (!otherId) return c.json({ error: "invalid_code" }, 400);
  if (otherId === me.id) return c.json({ error: "same_account" }, 400);
  // findById は退会申請中（猶予期間 #250）を null にするので、
  // 猶予期間中のアカウントは統合の相手にならない（復帰の余地を残す）
  const other = await usersRepo.findById(otherId);
  if (!other) return c.json({ error: "invalid_code" }, 400);
  // 使い捨てチェック（ここで消費。以降は同じコードを再利用できない）
  if (!(await consumeMergeCode(code))) {
    return c.json({ error: "invalid_code" }, 400);
  }
  const [winnerId, loserId] =
    keep === "me" ? [me.id, otherId] : [otherId, me.id];
  // 監査: 不可逆な操作なので実行記録を必ず残す（「勝手に統合された」調査用）
  console.log(
    `[account-merge] executor=${me.id} codeIssuer=${otherId} winner=${winnerId} loser=${loserId}`,
  );
  await usersRepo.mergeUsers(winnerId, loserId);
  // 負け側が自前保管していたアイコン (#312) の実体を消す。勝ち側は自分のものを
  // 引き続き使うので移し替えは不要。行が消えたあとはキーを辿れず孤児になる
  try {
    await getBucket().delete(avatarKey(loserId));
  } catch (e) {
    console.warn(`[avatar] 統合時の削除に失敗 user=${loserId}`, e);
  }
  // 監査ログ (#248)。負け側のユーザー行は消えるのでハンドルも一緒に残す
  await recordAudit({
    action: "account_merge",
    actor: { id: me.id, handle: me.username },
    target: { id: otherId, handle: other.username },
    detail: { keep, winnerId, loserId },
  });
  return c.json({ ok: true, winnerId });
});

/** 退会リクエスト (#244, #250)。データはすぐには消さず deleted_at を立てて
 * 「即座に利用不可・他ユーザーから非表示」にし、30日の猶予期間を置く。
 * 猶予期間中に同じログイン方法でログインすれば復帰でき、経過後は日次バッチ
 * (POST /api/cron/purge-deleted) が従来の完全削除を実行する。
 * 誤操作防止に confirm: true を必須にし、実行後はセッションを破棄する */
meRoutes.delete("/", zValidator("json", deleteAccountInput), async (c) => {
  const me = c.get("user");
  // 「退会済みユーザー」(ghost) 自身は identity が無くログイン不可のはずだが、
  // 共有コンテンツの引き受け先が消えると困るので多重防御で弾く
  const ghost = await usersRepo.ensureDeletedUser();
  if (me.id === ghost.id) return c.json({ error: "forbidden" }, 403);

  const now = Date.now();
  console.log(`[account-delete-requested] user=${me.id} handle=${me.username}`);
  await usersRepo.requestDeletion(me.id, now);
  // 他の人の通知一覧に残る「◯◯ さんが…」を消す (#250)。タイトルに表示名を
  // 焼き込んでいるため、user 行を隠すだけでは名前とプロフィールリンクが残る。
  // 通知を消すこと自体は退会の成否に影響させない（ベストエフォート）
  try {
    await notificationsRepo.deleteByActor(me.id);
  } catch (e) {
    console.error(`[account-delete-requested] notification cleanup failed`, e);
  }
  // 監査ログ (#248)。完全削除は日次バッチ側で別途記録する
  await recordAudit({
    action: "account_delete_requested",
    actor: { id: me.id, handle: me.username },
    target: { id: me.id, handle: me.username },
    detail: { purgeAt: now + env.deletionGraceMs },
  });

  // session 行は requestDeletion で削除済み。cookie の破棄だけ行う
  await clearSession(c);
  return c.json({ ok: true, purgeAt: now + env.deletionGraceMs });
});

/** 退会の取り消し（復帰） (#250)。
 * POST /api/me/restore。meRoutes は requireAuth が付いていて猶予期間中は
 * 401 になるため、worker.ts で meRoutes より先に登録している。
 *
 * 「ログイン成功で自動復帰」ではなく明示的な確認を挟む設計にした理由:
 * OAuth は連携追加や別アカウントへのログインでも同じコールバックを通るため、
 * 自動復帰にすると「退会したのに触っただけで戻る」誤復帰が起きうる。
 * また退会直後にログイン画面へ戻る導線が残っているので、意図しない復帰を
 * 防ぐには確認画面が要る。セッションはログイン時に発行するが、
 * currentUser が猶予期間中を null にするため、このAPI以外は一切使えない。 */
export async function postRestoreAccount(c: Context<AppEnv>): Promise<Response> {
  const pending = await pendingDeletionUser(c);
  if (!pending) return c.json({ error: "unauthorized" }, 401);
  // 猶予期間を過ぎている場合は復帰させない（日次バッチ待ちの状態）
  if (Date.now() - pending.deletedAt > env.deletionGraceMs) {
    return c.json({ error: "grace_period_expired" }, 410);
  }
  await usersRepo.restore(pending.id);
  console.log(`[account-restore] user=${pending.id} handle=${pending.username}`);
  await recordAudit({
    action: "account_restore",
    actor: { id: pending.id, handle: pending.username },
    target: { id: pending.id, handle: pending.username },
    detail: { requestedAt: pending.deletedAt },
  });
  return c.json({ ok: true });
}

/** 表示名を変更する (#232)。イベント・チャット・プロフィール等の表示に使われる */
meRoutes.put(
  "/display-name",
  zValidator("json", updateDisplayNameInput),
  async (c) => {
    const me = c.get("user");
    const displayName = valid<UpdateDisplayNameInput>(c, "json").displayName.trim();
    await usersRepo.setGlobalName(me.id, displayName);
    return c.json({ ok: true, displayName });
  },
);
