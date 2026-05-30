import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  createEventInput,
  updateEventInput,
  updateMemberRoleInput,
  updateSubmissionInput,
} from "@eventer/shared";
import type {
  CreateEventInput,
  Event,
  UpdateEventInput,
  UpdateMemberRoleInput,
  UpdateSubmissionInput,
  User,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { scoringCriteriaRepo } from "../db/repositories/scoringCriteria.js";
import { deleteEventImage, putEventImage } from "./images.js";

export const eventRoutes = new Hono<AppEnv>();

/** 公開イベントは誰でも閲覧可。下書きはメンバー/管理者のみ。 */
function canView(event: Event, user: User | null): boolean {
  if (event.status === "published") return true;
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return Boolean(eventMembersRepo.find(event.id, user.id));
}

/* =========================================================
 *  公開ルート（未ログイン可）。requireAuth より前に登録する。
 * =======================================================*/

/** イベント詳細（公開イベントは未ログインでも閲覧可） */
eventRoutes.get("/:id", (c) => {
  const event = eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  const user = currentUser(c);
  if (!canView(event, user)) return c.json({ error: "not_found" }, 404);
  const member = user ? eventMembersRepo.find(event.id, user.id) : null;
  return c.json({ event, myRole: member?.role ?? null });
});

/** Entry 一覧（公開イベントは未ログインでも閲覧可） */
eventRoutes.get("/:id/entries", (c) => {
  const event = eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!canView(event, currentUser(c))) return c.json({ error: "forbidden" }, 403);
  return c.json({ entries: entriesRepo.listByEvent(event.id) });
});

/** 成果物集約（公開イベントは未ログインでも閲覧可。提出済みのみ） */
eventRoutes.get("/:id/submissions", (c) => {
  const event = eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!canView(event, currentUser(c))) return c.json({ error: "forbidden" }, 403);
  const entries = entriesRepo
    .listByEvent(event.id)
    .filter((e) => e.submission);
  return c.json({ entries });
});

/** 参加者一覧（公開イベントは未ログインでも閲覧可） */
eventRoutes.get("/:id/members", (c) => {
  const event = eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!canView(event, currentUser(c))) return c.json({ error: "forbidden" }, 403);
  return c.json({ members: eventMembersRepo.listWithUsers(event.id) });
});

/* =========================================================
 *  ここから認証必須
 * =======================================================*/
eventRoutes.use("*", requireAuth);

/** 公開イベント一覧 */
eventRoutes.get("/", (c) => {
  return c.json({ events: eventsRepo.listPublished() });
});

/** イベント作成（作成者は staff として自動参加） */
eventRoutes.post("/", zValidator("json", createEventInput), (c) => {
  const user = c.get("user");
  const input = valid<CreateEventInput>(c, "json");
  const event = eventsRepo.create(input, user.id);
  eventMembersRepo.add(event.id, user.id, "staff");
  scoringCriteriaRepo.seedDefaults(event.id);
  return c.json({ event }, 201);
});

/** イベント更新（staff のみ） */
eventRoutes.patch(
  "/:id",
  requireEventRole(["staff"]),
  zValidator("json", updateEventInput),
  (c) => {
    const event = eventsRepo.update(
      c.req.param("id"),
      valid<UpdateEventInput>(c, "json"),
    );
    if (!event) return c.json({ error: "not_found" }, 404);
    return c.json({ event });
  },
);

/** イベント画像のアップロード/削除（staff のみ。admin はバイパス） */
eventRoutes.put("/:id/image", requireEventRole(["staff"]), putEventImage);
eventRoutes.delete("/:id/image", requireEventRole(["staff"]), deleteEventImage);

/** 公開（staff のみ） */
eventRoutes.post("/:id/publish", requireEventRole(["staff"]), (c) => {
  const event = eventsRepo.setStatus(c.req.param("id"), "published");
  if (!event) return c.json({ error: "not_found" }, 404);
  return c.json({ event });
});

/** イベント削除（staff のみ。関連データは FK CASCADE で削除） */
eventRoutes.delete("/:id", requireEventRole(["staff"]), (c) => {
  eventsRepo.delete(c.req.param("id"));
  return c.json({ ok: true });
});

/** 参加登録（participant として参加し、個人 Entry を自動生成） */
eventRoutes.post("/:id/join", (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const event = eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);

  const member = eventMembersRepo.add(eventId, user.id, "participant");
  const displayName = user.globalName ?? user.username;
  entriesRepo.createIndividual(eventId, user.id, displayName);
  return c.json({ member }, 201);
});

/** 参加解除（メンバーと個人 Entry を削除） */
eventRoutes.delete("/:id/join", (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  entriesRepo.removeIndividualEntry(eventId, user.id);
  eventMembersRepo.remove(eventId, user.id);
  return c.json({ ok: true });
});

/** ロール変更（staff のみ） */
eventRoutes.patch(
  "/:id/members/:userId/role",
  requireEventRole(["staff"]),
  zValidator("json", updateMemberRoleInput),
  (c) => {
    const member = eventMembersRepo.setRole(
      c.req.param("id"),
      c.req.param("userId"),
      valid<UpdateMemberRoleInput>(c, "json").role,
    );
    if (!member) return c.json({ error: "not_found" }, 404);
    return c.json({ member });
  },
);

/** 自分の Entry の成果物を保存（その Entry の member のみ） */
eventRoutes.put(
  "/:id/entries/:entryId/submission",
  zValidator("json", updateSubmissionInput),
  (c) => {
    const user = c.get("user");
    const entryId = c.req.param("entryId");
    const entry = entriesRepo.findById(entryId);
    if (!entry || entry.eventId !== c.req.param("id")) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!entriesRepo.isMember(entryId, user.id)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const input = valid<UpdateSubmissionInput>(c, "json");
    const norm = (v: string | null | undefined) => (v ? v : null);
    const submission = entriesRepo.upsertSubmission(
      entryId,
      norm(input.presentationUrl),
      norm(input.sourceCodeUrl),
    );
    return c.json({ submission });
  },
);
