import { Hono } from "hono";
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
import { clearSession, requireAuth } from "../auth/session.js";
import { getBucket } from "../runtime.js";
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
import { emailRepo } from "../db/repositories/email.js";
import { eventRequestsRepo } from "../db/repositories/eventRequests.js";
import { decksRepo } from "../db/repositories/decks.js";
import { liveSetsRepo } from "../db/repositories/liveSets.js";
import { bgmTracksRepo } from "../db/repositories/bgmTracks.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";
import { putMyCardImage } from "./profileCardImages.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.use("*", requireAuth);

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
    const taken = await usersRepo.findByUsername(username);
    if (taken && taken.id !== me.id) {
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
  return c.json({ ok: true, winnerId });
});

/** 退会するユーザー由来の R2 オブジェクトキーを列挙する (#244)。
 * 行削除後はキーを辿れなくなるため、DB 削除前に呼ぶこと。
 * 対象: スライド画像・配信セット画像・BGM 音源・イベント写真・プロフィールカードPNG */
async function collectUserObjectKeys(userId: string): Promise<string[]> {
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

/** 退会（アカウント削除） (#244)。共有コンテンツ（主催イベント・コミュニティ・
 * 会場・たまご・会場オファー）は「退会済みユーザー」名義で残し、本人の活動記録・
 * 資産・ログイン情報（連携・セッション）は削除する。
 * 誤操作防止に confirm: true を必須にし、実行後はセッション cookie を破棄する */
meRoutes.delete("/", zValidator("json", deleteAccountInput), async (c) => {
  const me = c.get("user");
  const ghost = await usersRepo.ensureDeletedUser();
  // 「退会済みユーザー」自身は identity が無くログイン不可のはずだが、多重防御
  if (me.id === ghost.id) return c.json({ error: "forbidden" }, 403);

  const objectKeys = await collectUserObjectKeys(me.id);

  // 監査: 不可逆な操作なので実行記録を必ず残す
  console.log(
    `[account-delete] user=${me.id} handle=${me.username} ghost=${ghost.id} r2Objects=${objectKeys.length}`,
  );
  await usersRepo.deleteAccount(me.id, ghost.id);

  // R2 の掃除はベストエフォート（失敗しても退会自体は成立。残骸はログで追える）
  try {
    const bucket = getBucket();
    for (let i = 0; i < objectKeys.length; i += 1000) {
      await bucket.delete(objectKeys.slice(i, i + 1000));
    }
  } catch (e) {
    console.error(`[account-delete] R2 cleanup failed for user=${me.id}`, e);
  }

  // セッション行は FK CASCADE で削除済み。cookie の破棄だけ行う
  await clearSession(c);
  return c.json({ ok: true });
});

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
