import { Hono } from "hono";
import type { Context } from "hono";
import { saveScheduleInput, updateScheduleMaterialInput } from "@eventer/shared";
import type {
  SaveScheduleInput,
  UpdateScheduleMaterialInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth, currentUser } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { deferBackground } from "../runtime.js";
import { refreshMaterialMeta } from "../lib/materialMeta.js";
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

/** タイムテーブルの保存（全項目を送り、サーバーが差分で反映する。staff のみ #340）。
 * 既存項目の ID を送れば更新扱いになり、ID が保存をまたいで変わらない */
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
    // （フリーテキスト名はそのまま残る）。
    // 退会申請中 (#250) のメンバーも「メンバー」として許可する。除外すると
    // 猶予期間中に staff が保存しただけでリンクが消え、復帰しても登壇者が
    // 戻らなくなる（＝データが復元不能になる）ため
    const memberIds = new Set(
      await eventMembersRepo.listMemberUserIds(eventId),
    );
    const items = input.items.map((it) => ({
      ...it,
      speakerUserId:
        it.speakerUserId && memberIds.has(it.speakerUserId)
          ? it.speakerUserId
          : null,
    }));
    const saved = await eventScheduleRepo.saveAll(eventId, items);
    // OG サムネイルはレスポンスを待たせずバックグラウンドで取得 (#149)
    await deferBackground(refreshMaterialMeta(eventId));
    return c.json({ items: saved });
  },
);

/** 登壇資料URLの更新（登壇者本人の自己編集 #148）。
 * staff は編集画面から全体を保存できるが、このエンドポイントでも更新可。 */
eventScheduleRoutes.patch(
  "/:id/timetable/:itemId/material",
  zValidator("json", updateScheduleMaterialInput),
  async (c) => {
    const eventId = c.req.param("id");
    const itemId = c.req.param("itemId");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const item = await eventScheduleRepo.findItem(eventId, itemId);
    if (!item) return c.json({ error: "not_found" }, 404);

    // 許可: アプリ管理者 / イベント staff / このコマにリンクされた登壇者本人。
    // 登壇者本人でも現役メンバーであること（離脱・キャンセル済みは不可）
    const user = c.get("user");
    if (!isAppAdmin(user)) {
      const member = await eventMembersRepo.find(eventId, user.id);
      const isSpeakerSelf = item.speakerUserId === user.id && member != null;
      if (!isSpeakerSelf && member?.role !== "staff") {
        return c.json({ error: "forbidden" }, 403);
      }
    }

    const input = valid<UpdateScheduleMaterialInput>(c, "json");
    await eventScheduleRepo.updateMaterial(eventId, itemId, input.materialUrl);
    // OG サムネイルはバックグラウンドで再取得 (#149)
    await deferBackground(refreshMaterialMeta(eventId));
    const updated = await eventScheduleRepo.findItem(eventId, itemId);
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ item: updated });
  },
);
