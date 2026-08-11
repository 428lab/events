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

/** タイムテーブルを編集できる人か（＝ネタ出し中のコマまで見てよい人）。
 * 保存の権限 (staff) と同じ範囲にそろえる */
async function canEditTimetable(eventId: string, c: Context): Promise<boolean> {
  const user = await currentUser(c);
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return (await eventMembersRepo.find(eventId, user.id))?.role === "staff";
}

/** タイムテーブル一覧（閲覧できる人は誰でも）。
 * トラック (#338) も一緒に返す。時刻の計算にトラックの一覧が要るため、
 * 別々に取ると片方だけ古い状態で描画されうる。
 *
 * **未割り当て（ネタ出し中）は staff にしか返さない** (#338)。
 * 参加者に見せない、という判断はここ1か所だけが持つ。画面側で落とすと、
 * この API を直に叩けばまだ出すと決まっていない企画が読めてしまう */
export async function getEventTimetable(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewTimetable(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const items = await eventScheduleRepo.listByEvent(eventId);
  const canEdit = await canEditTimetable(eventId, c);
  return c.json({
    items: canEdit
      ? items
      : items.filter((it) => it.placement !== "unassigned"),
    tracks: await eventScheduleRepo.listTracks(eventId),
  });
}

/* ===== 書き込み（要認証。staff のみ） ===== */

export const eventScheduleRoutes = new Hono<AppEnv>();
eventScheduleRoutes.use("*", requireAuth);

/** タイムテーブルの保存（全項目を送り、サーバーが差分で反映する。staff のみ #340）。
 * 既存項目の ID を送れば更新扱いになり、ID が保存をまたいで変わらない。
 * トラックの定義と割り当て (#338) も同じ保存で一緒に反映する */
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
    const saved = await eventScheduleRepo.saveAll(eventId, items, input.tracks);
    // OG サムネイルはレスポンスを待たせずバックグラウンドで取得 (#149)
    await deferBackground(refreshMaterialMeta(eventId));
    return c.json({
      items: saved,
      tracks: await eventScheduleRepo.listTracks(eventId),
    });
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
