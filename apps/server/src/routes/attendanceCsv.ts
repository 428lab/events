import { Hono } from "hono";
import { surveyValueLabel } from "@eventer/shared";
import type { EventMemberWithUser, User } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { isAppAdmin } from "../auth/admin.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { venueOffersRepo } from "../db/repositories/venueOffers.js";
import { isVenueManager } from "../db/repositories/venues.js";
import {
  MEMBER_STATUS_LABEL,
  collectAnswerRows,
  csvCell,
} from "./eventSurvey.js";

/** 入館名簿CSV (#154)。受付（出席チェック）の結果を会場提供者に渡すためのエクスポート。
 * スタッフに加えて、成立オファーで会場を提供している会場運営者もダウンロードできる */

export const attendanceCsvRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

const ROLE_LABEL: Record<string, string> = {
  participant: "参加者",
  staff: "スタッフ",
  judge: "審査員",
  observer: "観覧者",
};

/** ダウンロード可能か。
 * - requireEventRole(["staff"]) 相当: アプリ管理者 / イベントの staff / コミュニティ管理者
 * - 会場提供者: このイベントに accepted のオファーを持つ会場のオーナー/管理者 */
async function canDownloadAttendance(
  eventId: string,
  user: User,
): Promise<boolean> {
  if (isAppAdmin(user)) return true;
  const member = await eventMembersRepo.find(eventId, user.id);
  if (member?.role === "staff") return true;
  const event = await eventsRepo.findById(eventId);
  if (!event) return false;
  if (
    event.communityId &&
    (await communitiesRepo.isManager(event.communityId, user.id))
  ) {
    return true;
  }
  // 会場マッチング成立（accepted）した会場の運営者にも渡す
  for (const offer of await venueOffersRepo.listByEvent(eventId)) {
    if (offer.status !== "accepted") continue;
    if (await isVenueManager(offer.venueId, user.id)) return true;
  }
  return false;
}

/** epoch ms → "YYYY-MM-DD HH:mm"（JST固定。Workers はタイムゾーンに依存しない） */
function formatJstMinute(ms: number): string {
  const JST_OFFSET = 9 * 60 * 60 * 1000;
  return new Date(ms + JST_OFFSET).toISOString().slice(0, 16).replace("T", " ");
}

/** 入館名簿CSV（staff または成立会場の運営者）。
 * 行 = メンバー（確定を先頭に）∪ アンケート回答者。UTF-8 BOM + CRLF */
attendanceCsvRoutes.get("/:id/attendance.csv", async (c) => {
  const eventId = c.req.param("id");
  // Content-Disposition に埋めるためUUID形式を明示検証（多層防御）
  if (!/^[0-9a-f-]{36}$/.test(eventId)) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!(await eventsRepo.findById(eventId))) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!(await canDownloadAttendance(eventId, c.get("user")))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { questions, rows } = await collectAnswerRows(eventId);
  const answersByUser = new Map(rows.map((r) => [r.user.id, r]));

  // メンバー（キャンセル以外）を確定 → その他の順で（同状態内は参加登録順を保持）
  const members = await eventMembersRepo.listWithUsers(eventId);
  const ordered: EventMemberWithUser[] = [
    ...members.filter((m) => m.status === "confirmed"),
    ...members.filter((m) => m.status !== "confirmed"),
  ];

  const statusLabel = (status: string | null): string =>
    status ? (MEMBER_STATUS_LABEL[status] ?? status) : "未参加";

  const header = [
    "ユーザー名",
    "表示名",
    "ロール",
    "参加状態",
    "出席",
    "出席時刻",
    ...questions.map((q) => q.question),
  ];
  const lines = [header.map(csvCell).join(",")];
  const pushRow = (cells: string[]) =>
    lines.push(cells.map(csvCell).join(","));

  const seen = new Set<string>();
  for (const m of ordered) {
    seen.add(m.userId);
    const answers = answersByUser.get(m.userId)?.answers ?? {};
    pushRow([
      m.user.username,
      m.user.globalName ?? "",
      ROLE_LABEL[m.role] ?? m.role,
      statusLabel(m.status),
      m.attended ? "出席" : "未",
      m.attendedAt != null ? formatJstMinute(m.attendedAt) : "",
      ...questions.map((q) => surveyValueLabel(q.qtype, answers[q.id] ?? "")),
    ]);
  }
  // メンバーでないアンケート回答者（未参加・キャンセル済み等）も名簿の末尾に含める
  for (const row of rows) {
    if (seen.has(row.user.id)) continue;
    pushRow([
      row.user.username,
      row.user.globalName ?? "",
      "",
      statusLabel(row.memberStatus),
      "未",
      "",
      ...questions.map((q) =>
        surveyValueLabel(q.qtype, row.answers[q.id] ?? ""),
      ),
    ]);
  }

  // 先頭に BOM を付けて Excel での文字化けを防ぐ
  return c.body(`\uFEFF${lines.join("\r\n")}\r\n`, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="attendance-${eventId}.csv"`,
  });
});
