import { Hono } from "hono";
import type { Context } from "hono";
import { saveScheduleInput } from "@eventer/shared";
import type { SaveScheduleInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth, currentUser } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventScheduleRepo } from "../db/repositories/eventSchedule.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

/** タイムテーブルを閲覧できるか。公開イベントは誰でも、下書きはメンバー/管理者のみ
 * （イベント詳細 GET と同じ判定） */
async function canViewTimetable(eventId: string, c: Context): Promise<boolean> {
  const event = await eventsRepo.findById(eventId);
  if (!event) return false;
  if (event.status === "published") return true;
  const user = await currentUser(c);
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return Boolean(await eventMembersRepo.find(eventId, user.id));
}

/* ===== 公開ハンドラ（未ログイン可。worker.ts で eventRoutes より先に登録） ===== */

/** タイムテーブル一覧（閲覧できる人は誰でも） */
export async function getEventTimetable(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewTimetable(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ items: await eventScheduleRepo.listByEvent(eventId) });
}

/* ===== 書き込み（要認証。staff のみ） ===== */

export const eventScheduleRoutes = new Hono<AppEnv>();
eventScheduleRoutes.use("*", requireAuth);

/** タイムテーブルの一括保存（全置き換え。staff のみ） */
eventScheduleRoutes.put(
  "/:id/timetable",
  requireEventRole(["staff"]),
  zValidator("json", saveScheduleInput),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const input = valid<SaveScheduleInput>(c, "json");
    // 担当者リンクはイベントメンバーのみ許可。非メンバーは黙って null に落とす
    // （フリーテキスト名はそのまま残る）
    const memberIds = new Set(
      (await eventMembersRepo.listWithUsers(eventId)).map((m) => m.user.id),
    );
    const items = input.items.map((it) => ({
      ...it,
      speakerUserId:
        it.speakerUserId && memberIds.has(it.speakerUserId)
          ? it.speakerUserId
          : null,
    }));
    return c.json({ items: await eventScheduleRepo.replaceAll(eventId, items) });
  },
);
