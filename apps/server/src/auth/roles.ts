import type { Context, MiddlewareHandler } from "hono";
import type { EventRole, User } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { isEventManager } from "./eventAccess.js";
export { canViewEvent } from "./eventAccess.js";
import { isAppAdmin } from "./admin.js";
import { currentUser } from "./session.js";

/**
 * イベントメンバーであり、かつ指定ロールのいずれかを持つことを要求する。
 * requireAuth の後に使うこと（c.get("user") が必要）。
 * イベント ID はパスパラメータ :id から取得。
 * - アプリ運営管理者（ADMIN_DISCORD_IDS）は常に許可。
 * - イベントが所属するコミュニティの owner/admin は staff 相当として許可。
 */
export function requireEventRole(
  roles: EventRole[],
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    const eventId = c.req.param("id");
    if (!eventId) return c.json({ error: "event_id_required" }, 400);
    if (isAppAdmin(user)) {
      await next();
      return;
    }
    const member = await eventMembersRepo.find(eventId, user.id);
    if (member && member.status !== "canceled" && roles.includes(member.role)) {
      await next();
      return;
    }
    // コミュニティ管理者（owner/admin）はそのコミュニティのイベントを staff 相当で管理可
    if (roles.includes("staff") && (await canManageEvent(eventId, user))) {
      await next();
      return;
    }
    return c.json({ error: "forbidden" }, 403);
  };
}

/**
 * そのイベントを運営として操作できるか。**requireEventRole(["staff"]) と同じ基準**。
 *
 * ミドルウェアを通せない場面のためのもの。いまの用途は「招待した人がいまも運営か」
 * を承諾の時点で確かめること (#339)：招待した人が降格・脱退・退会しても pending の
 * 招待は残るので、そのままだと資格を失った人の招待で運営になれてしまう。
 *
 * 判定を requireEventRole と2か所に書くと必ずずれるので、あちらからもここを呼ぶ。
 */
export async function canManageEvent(
  eventId: string,
  user: User,
): Promise<boolean> {
  return isEventManager(eventId, user);
}

/**
 * `canManageEvent` を **未ログインでも呼べる形**で包んだもの。
 *
 * 公開ハンドラ（未ログイン可）から「この人は運営か」を聞くための入口。
 * 判定そのものは `canManageEvent` に閉じているので、**運営として何ができるかの
 * 範囲は1つの関数が持つ**。いま使っているのはタイムテーブルで、
 * 「編集できる人」「裏方 (#383) が見える人」「`PUT` が通る人」がこれで同じになる。
 * ずれていると、公開向けに絞られた一覧を受け取った人が保存でき、
 * その差分保存で**裏方と未割り当てが全部消える**。
 */
export async function canManageEventAs(
  eventId: string,
  c: Context,
): Promise<boolean> {
  const user = await currentUser(c);
  if (!user) return false;
  return canManageEvent(eventId, user);
}

/**
 * **そのイベントの参加確定 staff メンバーか**。
 *
 * requireEventRole(["staff"]) はアプリ運営管理者とコミュニティの owner/admin も
 * 通すが、イベント内コンテンツのモデレーション（コメント・写真の削除、チャットの
 * 非表示など）はそこから更に絞る (#275)。「イベント配下の表示・操作にサイト管理者か
 * どうかを混ぜず、イベント内の役割だけで判定する」というこのプロジェクトの方針に
 * 揃えるため（操作が必要な人は、そのイベントの staff に加わればよい）。
 * web も myRole === "staff" でしか操作UIを出さないので、これで基準が一致する。
 *
 * 参加確定（status=confirmed）も要求する。未確定の staff が閲覧はできないのに
 * 削除は通る、という非対称をなくすため。
 */
export async function isConfirmedEventStaff(
  eventId: string,
  userId: string,
): Promise<boolean> {
  const member = await eventMembersRepo.find(eventId, userId);
  return member?.role === "staff" && member.status === "confirmed";
}
