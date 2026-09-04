import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import { checkinInput, memberLookupQuery } from "@eventer/shared";
import type {
  CheckinInput,
  CheckinResultKind,
  CheckinUser,
  EventMember,
  MemberLookupQuery,
  MemberLookupResult,
  User,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { usersRepo } from "../db/repositories/users.js";
import {
  createCheckinToken,
  verifyCheckinToken,
} from "../lib/checkinToken.js";

/** QR受付（入場チェックイン） (#154) */
export const eventCheckinRoutes = new Hono<AppEnv>();

/** 受付画面に返すユーザーの最小情報 */
function toCheckinUser(user: User): CheckinUser {
  return {
    id: user.id,
    username: user.username,
    name: user.globalName ?? user.username,
    avatarUrl: user.avatarUrl,
  };
}

function toCheckinMember(member: EventMember | null) {
  return member
    ? { role: member.role, status: member.status, attended: member.attended }
    : null;
}

/** 入場チケット（署名付きQRトークン）。本人＝確定メンバーのみ */
eventCheckinRoutes.get("/:id/my-ticket", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const member = await eventMembersRepo.find(eventId, user.id);
  if (!member || member.status !== "confirmed") {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json(await createCheckinToken(eventId, user.id));
});

/** 入場チケットの検証＋出席記録（staff のみ）。
 * 署名検証を通ったチケットは「本人がアカウントを開いている」証明なので即時に出席記録する */
eventCheckinRoutes.post(
  "/:id/checkin",
  requireEventRole(["staff"]),
  zValidator("json", checkinInput),
  async (c) => {
    const eventId = c.req.param("id");
    const { token } = valid<CheckinInput>(c, "json");
    const verified = await verifyCheckinToken(token);
    if (!verified.ok) {
      return verified.reason === "expired"
        ? c.json({ error: "expired_token" }, 410)
        : c.json({ error: "invalid_token" }, 400);
    }
    // 別イベントのチケットの流用は拒否
    if (verified.eventId !== eventId) {
      return c.json({ error: "wrong_event" }, 400);
    }
    const user = await usersRepo.findById(verified.userId);
    if (!user) return c.json({ error: "invalid_token" }, 400);
    let member = await eventMembersRepo.find(eventId, user.id);
    let result: CheckinResultKind;
    if (!member || member.status !== "confirmed") {
      // 確定参加者でない場合は出席記録しない（受付で案内してもらう）
      result = "not_confirmed";
    } else if (member.attended) {
      result = "already";
    } else {
      member = await eventMembersRepo.setAttended(
        eventId,
        user.id,
        true,
        Date.now(),
      );
      result = "checked_in";
    }
    return c.json({
      result,
      user: toCheckinUser(user),
      member: toCheckinMember(member),
    });
  },
);

/** プロフィールQR（印刷カード等）からのメンバー照会（staff のみ）。
 * 本人確認チケットではないため、出席記録は staff の手動操作に任せる */
eventCheckinRoutes.get(
  "/:id/member-lookup",
  requireEventRole(["staff"]),
  zValidator("query", memberLookupQuery),
  async (c) => {
    const { handle } = valid<MemberLookupQuery>(c, "query");
    const user =
      (await usersRepo.findByUsername(handle)) ??
      (await usersRepo.findById(handle));
    if (!user) {
      return c.json({ found: false } satisfies MemberLookupResult);
    }
    const member = await eventMembersRepo.find(c.req.param("id"), user.id);
    return c.json({
      found: true,
      user: toCheckinUser(user),
      member: toCheckinMember(member),
    } satisfies MemberLookupResult);
  },
);
