import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  createEventInput,
  createSlotInput,
  joinEventInput,
  updateEventInput,
  updateMemberRoleInput,
  updateSlotInput,
  updateSubmissionInput,
} from "@eventer/shared";
import type {
  CreateEventInput,
  CreateSlotInput,
  Event,
  JoinEventInput,
  UpdateEventInput,
  UpdateMemberRoleInput,
  UpdateSlotInput,
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
import { participationSlotsRepo } from "../db/repositories/participationSlots.js";
import { usersRepo } from "../db/repositories/users.js";
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

/** 参加枠一覧（公開イベントは未ログインでも閲覧可） */
eventRoutes.get("/:id/slots", (c) => {
  const event = eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!canView(event, currentUser(c))) return c.json({ error: "forbidden" }, 403);
  return c.json({ slots: participationSlotsRepo.listByEvent(event.id) });
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

/** 参加登録（枠選択。先着=確定/満員はキャンセル待ち、抽選=申込） */
eventRoutes.post("/:id/join", zValidator("json", joinEventInput), (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const event = eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);

  const existing = eventMembersRepo.find(eventId, user.id);
  if (existing) return c.json({ member: existing });

  const input = valid<JoinEventInput>(c, "json");
  const slots = participationSlotsRepo.listByEvent(eventId);
  let slotId: string | null = null;
  let status = "confirmed";

  if (slots.length > 0) {
    const slot = slots.find((s) => s.id === input.slotId);
    if (!slot) return c.json({ error: "slot_required" }, 400);
    slotId = slot.id;
    if (slot.selectionType === "lottery") {
      status = "applied";
    } else {
      status = slot.confirmedCount < slot.capacity ? "confirmed" : "waitlist";
    }
  }

  const member = eventMembersRepo.add(
    eventId,
    user.id,
    "participant",
    slotId,
    status,
  );
  if (status === "confirmed") {
    entriesRepo.createIndividual(
      eventId,
      user.id,
      user.globalName ?? user.username,
    );
  }
  return c.json({ member, status }, 201);
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

/** 参加枠の作成/更新/削除（staff のみ） */
eventRoutes.post(
  "/:id/slots",
  requireEventRole(["staff"]),
  zValidator("json", createSlotInput),
  (c) => {
    const slot = participationSlotsRepo.create(
      c.req.param("id"),
      valid<CreateSlotInput>(c, "json"),
    );
    return c.json({ slot }, 201);
  },
);

eventRoutes.patch(
  "/:id/slots/:slotId",
  requireEventRole(["staff"]),
  zValidator("json", updateSlotInput),
  (c) => {
    const slot = participationSlotsRepo.update(
      c.req.param("slotId"),
      valid<UpdateSlotInput>(c, "json"),
    );
    if (!slot) return c.json({ error: "not_found" }, 404);
    return c.json({ slot });
  },
);

eventRoutes.delete("/:id/slots/:slotId", requireEventRole(["staff"]), (c) => {
  participationSlotsRepo.delete(c.req.param("slotId"));
  return c.json({ ok: true });
});

/** 抽選実行（staff のみ）。applied から定員までを当選=confirmed、残りを落選=lost に */
eventRoutes.post("/:id/slots/:slotId/draw", requireEventRole(["staff"]), (c) => {
  const eventId = c.req.param("id");
  const slot = participationSlotsRepo.findById(c.req.param("slotId"));
  if (!slot || slot.eventId !== eventId) return c.json({ error: "not_found" }, 404);
  if (slot.selectionType !== "lottery") {
    return c.json({ error: "not_lottery" }, 400);
  }
  const applied = eventMembersRepo.membersBySlotStatus(slot.id, "applied");
  const shuffled = [...applied].sort(() => Math.random() - 0.5);
  const winners = shuffled.slice(0, slot.capacity);
  const winnerIds = new Set(winners.map((w) => w.id));

  for (const m of applied) {
    if (winnerIds.has(m.id)) {
      eventMembersRepo.setStatus(m.id, "confirmed");
      const u = usersRepo.findById(m.userId);
      if (u) {
        entriesRepo.createIndividual(eventId, m.userId, u.globalName ?? u.username);
      }
    } else {
      eventMembersRepo.setStatus(m.id, "lost");
    }
  }
  return c.json({
    drawn: applied.length,
    confirmed: winners.length,
    lost: applied.length - winners.length,
  });
});

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
