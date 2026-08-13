import type { Context } from "hono";
import type { User } from "@eventer/shared";
import { usersRepo } from "../db/repositories/users.js";
import { identitiesRepo } from "../db/repositories/identities.js";
import { recordAudit } from "../db/repositories/auditLogs.js";
import { avatarKey } from "../lib/avatarStore.js";
import { getBucket } from "../runtime.js";
import { currentUser, issueSession } from "./session.js";

/** 連携の引き取り (#238)。相手が「唯一の連携 かつ 利用実績なし」の空アカウント
 * のときだけユーザー行ごと削除して "ok" を返す（identity は FK CASCADE で消える。
 * unlink を挟まない単一文なので、FK違反等で失敗しても相手アカウントは無傷のまま）。
 * 実績のあるアカウントは孤児化させない（誤ログインでできた空アカウントの回収専用） */
export async function takeoverEmptyAccount(
  existingUserId: string,
  actor: User,
  provider: string,
): Promise<"ok" | "already_linked" | "account_in_use" | "account_deleted"> {
  // 退会申請中（猶予期間 #250）は引き取りの対象外。復帰したときに
  // ログイン手段ごとアカウントが消えていた、という事態を防ぐ
  const target = await usersRepo.findByIdIncludingDeleted(existingUserId);
  if (!target || target.deletedAt !== null) return "account_deleted";
  if ((await identitiesRepo.countByUser(existingUserId)) !== 1) {
    return "already_linked";
  }
  if (await usersRepo.hasActivity(existingUserId)) {
    return "account_in_use";
  }
  await usersRepo.deleteById(existingUserId);
  // 自前保管したアイコン (#312) の実体も消す。行が消えるとキーを辿れなくなり、
  // R2 に孤児が残り続ける（退会の完全削除 purgeDeleted.ts と同じ後始末）
  try {
    await getBucket().delete(avatarKey(existingUserId));
  } catch (e) {
    console.warn(`[avatar] 引き取り時の削除に失敗 user=${existingUserId}`, e);
  }
  // 監査ログ (#248)。相手のユーザー行ごと消す不可逆操作なので記録する
  await recordAudit({
    action: "identity_takeover",
    actor: { id: actor.id, handle: actor.username },
    target: { id: existingUserId, handle: target.username },
    detail: { provider },
  });
  return "ok";
}

/** 退会申請中（猶予期間 #250）のアカウントか。
 * ログイン自体は通し（本人確認はプロバイダ側で済んでいる）、復帰画面へ誘導する。
 * ログイン自体を弾くと「同じログイン方法でログインすれば復帰できる」導線が
 * 作れないため、この形にしている */
export async function isPendingDeletion(userId: string): Promise<boolean> {
  const u = await usersRepo.findByIdIncludingDeleted(userId);
  return !!u && u.deletedAt !== null;
}

/** 新規作成に使うプロフィール。`username` は**呼び出し側で整形済み**のものを渡す。
 * ハンドルの作り方は方式ごとに違う（OAuth は deriveHandle、Nostr は pubkey 由来）
 * ため、ここでは共通化しない */
export interface IdentityProfile {
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export type FinishIdentityLoginResult =
  | { kind: "linked" }
  | { kind: "logged_in"; userId: string; pendingDeletion: boolean }
  | {
      kind: "link_error";
      code: "already_linked" | "account_in_use" | "account_deleted";
    };

/** ログイン/連携の判断を1か所に集める。
 *
 * 「ログイン中なら連携、別アカウントに連携済みなら空アカウントのみ引き取り (#238)、
 * 未ログインなら既存ログイン or 新規作成、猶予期間中 (#250) はセッションだけ発行」——
 * この規則は OAuth コールバックと Nostr ログインで同一なので、ここに寄せる。
 *
 * **応答の作り方は呼び出し側に残す。** OAuth は失敗をリダイレクトの
 * `?link_error=` で返し、Nostr は 409 の JSON で返すため、ここでは結果を返すだけにする。
 * アイコンの取り込み (#312) も方式ごとに有無が違うので呼び出し側の責務。
 *
 * @param onLinked 連携が成立した直後に呼ぶ逃がし口（Discord の setDiscordId 用）
 */
export async function finishIdentityLogin(
  c: Context,
  opts: {
    provider: string;
    providerUserId: string;
    profile: IdentityProfile;
    onLinked?: (userId: string) => Promise<void>;
  },
): Promise<FinishIdentityLoginResult> {
  const { provider, providerUserId, profile, onLinked } = opts;
  const current = await currentUser(c);
  const existingUserId = await identitiesRepo.findUserId(
    provider,
    providerUserId,
  );

  if (current) {
    // 連携 or 統合
    if (!existingUserId) {
      await identitiesRepo.link(
        current.id,
        provider,
        providerUserId,
        profile.email,
      );
      await onLinked?.(current.id);
    } else if (existingUserId !== current.id) {
      // 別アカウントに連携済み。アカウントの所有は認証で証明済み
      // → 空アカウントのみ引き取り (#238)
      // （行削除で discord_id の UNIQUE 衝突・管理者判定の残置も同時に消える）
      const takeover = await takeoverEmptyAccount(
        existingUserId,
        current,
        provider,
      );
      if (takeover !== "ok") return { kind: "link_error", code: takeover };
      await identitiesRepo.link(
        current.id,
        provider,
        providerUserId,
        profile.email,
      );
      await onLinked?.(current.id);
    }
    return { kind: "linked" };
  }

  // 未ログイン: 既存ならログイン、無ければ新規作成
  let userId = existingUserId;
  if (!userId) {
    const u = await usersRepo.createFromProfile(provider, {
      providerUserId,
      username: profile.username,
      globalName: profile.globalName,
      avatarUrl: profile.avatarUrl,
    });
    await identitiesRepo.link(u.id, provider, providerUserId, profile.email);
    userId = u.id;
  }
  // 猶予期間中 (#250) はセッションだけ発行して復帰画面へ誘導する。
  // このセッションで使えるのは復帰API だけ（currentUser が null を返すため）
  const pendingDeletion = await isPendingDeletion(userId);
  await issueSession(c, userId);
  return { kind: "logged_in", userId, pendingDeletion };
}
