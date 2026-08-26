import { Hono } from "hono";
import type { Context } from "hono";
import type {
  CreateMeetPrizeInput,
  MeetPrize,
  MeetPrizeList,
  MeetPrizeStatus,
  MeetPrizeView,
  RedeemMeetPrizeInput,
  UpdateMeetPrizeInput,
} from "@eventer/shared";
import {
  MEET_PRIZE_MAX,
  createMeetPrizeInput,
  redeemMeetPrizeInput,
  updateMeetPrizeInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { eventMeetsRepo } from "../db/repositories/eventMeets.js";
import { eventMeetPrizesRepo } from "../db/repositories/eventMeetPrizes.js";

/**
 * 出会いの景品引き換え (#431)。設計は docs/meet-prizes.md。
 *
 * - 公開一覧（getEventMeetPrizes）は awards と同じく api に直接登録する
 *   （eventRoutes のブランケット requireAuth を避ける。景品は参加動機なので
 *   未ログインでも見える）
 * - **オフ（meet_prizes = 0）の隠蔽の門は公開一覧の1か所**。イベント不存在と
 *   同一の応答（404 not_found）にし、存在ごと隠す（#418 と同じ型）
 * - staff の CRUD・デスク・締めはオフでも動く（開催前に仕込んで当日オンにする
 *   運用のため。staff 用ランキングが meet_ranking に従わないのと同じ姿勢）
 */

/** 景品を残数つきの公開形へ。個人を指す値は載せない（設計 §3.9） */
function toView(prize: MeetPrize, redeemed: number): MeetPrizeView {
  return {
    id: prize.id,
    name: prize.name,
    description: prize.description,
    conditionType: prize.conditionType,
    threshold: prize.threshold,
    stock: prize.stock,
    // 在庫を後から引き換え済み数より減らしても負にしない（表示は 0 に丸める）
    stockLeft: Math.max(0, prize.stock - redeemed),
    sortOrder: prize.sortOrder,
  };
}

/**
 * 公開: 景品一覧（未ログイン可。awards の canView と同じ基準）。
 * オフのイベント・見られないイベントは 404 not_found（存在ごと隠す門はここ1か所）。
 */
export async function getEventMeetPrizes(c: Context) {
  const eventId = c.req.param("id")!;
  const event = await eventsRepo.findById(eventId);
  if (!event || !event.meetPrizes) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  if (event.status !== "published") {
    // 下書きはメンバーとアプリ管理者だけ（公開前の仕込みの確認用）
    const allowed =
      user &&
      (isAppAdmin(user) || (await eventMembersRepo.find(eventId, user.id)));
    if (!allowed) return c.json({ error: "not_found" }, 404);
  }

  const prizes = await eventMeetPrizesRepo.listByEvent(eventId);
  const redeemed = await eventMeetPrizesRepo.redemptionCounts(eventId);
  const winnersDecided = await eventMeetPrizesRepo.winnersDecided(eventId);

  // 本人の状態は確定メンバーにだけ添える（他人の分はどの立場にも返さない）
  const member = user ? await eventMembersRepo.find(eventId, user.id) : null;
  const me =
    user && member?.status === "confirmed"
      ? {
          count: await eventMeetsRepo.countedMeetsForUser(eventId, user.id),
          won: await eventMeetPrizesRepo.isWinner(eventId, user.id),
          redeemedPrizeIds: await eventMeetPrizesRepo.redeemedPrizeIdsForUser(
            eventId,
            user.id,
          ),
        }
      : null;

  return c.json({
    prizes: prizes.map((p) => toView(p, redeemed.get(p.id) ?? 0)),
    winnersDecided,
    me,
  } satisfies MeetPrizeList);
}

/** /api/events 配下（要認証・staff のみ）。設定 CRUD・デスク・引き換え・1位の締め */
export const meetPrizeRoutes = new Hono<AppEnv>();
meetPrizeRoutes.use("*", requireAuth);

/** 子リソースの所有チェック（別イベントの prizeId の差し込みは 404） */
async function prizeOf(
  c: Context,
): Promise<MeetPrize | null> {
  const prize = await eventMeetPrizesRepo.findById(c.req.param("prizeId")!);
  if (!prize || prize.eventId !== c.req.param("id")) return null;
  return prize;
}

meetPrizeRoutes.post(
  "/:id/meet-prizes",
  requireEventRole(["staff"]),
  zValidator("json", createMeetPrizeInput),
  async (c) => {
    const eventId = c.req.param("id");
    if ((await eventMeetPrizesRepo.countForEvent(eventId)) >= MEET_PRIZE_MAX) {
      return c.json({ error: "too_many" }, 409);
    }
    const prize = await eventMeetPrizesRepo.create(
      eventId,
      valid<CreateMeetPrizeInput>(c, "json"),
    );
    return c.json({ prize }, 201);
  },
);

meetPrizeRoutes.patch(
  "/:id/meet-prizes/:prizeId",
  requireEventRole(["staff"]),
  zValidator("json", updateMeetPrizeInput),
  async (c) => {
    if (!(await prizeOf(c))) return c.json({ error: "not_found" }, 404);
    const prize = await eventMeetPrizesRepo.update(
      c.req.param("prizeId"),
      valid<UpdateMeetPrizeInput>(c, "json"),
    );
    return c.json({ prize });
  },
);

meetPrizeRoutes.delete(
  "/:id/meet-prizes/:prizeId",
  requireEventRole(["staff"]),
  async (c) => {
    if (!(await prizeOf(c))) return c.json({ error: "not_found" }, 404);
    await eventMeetPrizesRepo.delete(c.req.param("prizeId"));
    return c.json({ ok: true });
  },
);

/** デスク画面: 景品ごとの達成者と交換状況（staff のみ。名前入りは運営にだけ返す） */
meetPrizeRoutes.get(
  "/:id/meet-prizes/status",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const prizes = await eventMeetPrizesRepo.listByEvent(eventId);
    const redeemed = await eventMeetPrizesRepo.redemptionCounts(eventId);
    const winners = await eventMeetPrizesRepo.listWinners(eventId);

    const rows = [];
    for (const prize of prizes) {
      // 達成者: meet_count は件数から、top_rank は確定済みの勝者から導出
      const base =
        prize.conditionType === "meet_count"
          ? await eventMeetPrizesRepo.achieversAtLeast(
              eventId,
              prize.threshold ?? 1,
            )
          : winners;
      const achievers = [];
      for (const a of base) {
        const r = await eventMeetPrizesRepo.findRedemption(prize.id, a.userId);
        achievers.push({
          userId: a.userId,
          username: a.username,
          name: a.name,
          avatarUrl: a.avatarUrl,
          count: a.count,
          redeemed: Boolean(r),
          redeemedAt: r?.createdAt ?? null,
        });
      }
      const n = redeemed.get(prize.id) ?? 0;
      rows.push({
        prize,
        stockLeft: Math.max(0, prize.stock - n),
        redeemedCount: n,
        achievers,
      });
    }
    return c.json({ prizes: rows, winners } satisfies MeetPrizeStatus);
  },
);

/**
 * 交換済みにする（staff のみ）。
 * 達成はここで**再検証**する（画面に出ていたかは信用しない。#330 の取り消しで
 * 直前に人数が減ったケースも窓口で正しく 409 になる）。
 * 在庫の確保はリポジトリの1文（残り1個への同時到達は片方だけ通る）。
 */
meetPrizeRoutes.post(
  "/:id/meet-prizes/:prizeId/redeem",
  requireEventRole(["staff"]),
  zValidator("json", redeemMeetPrizeInput),
  async (c) => {
    const eventId = c.req.param("id");
    const { userId } = valid<RedeemMeetPrizeInput>(c, "json");
    const prize = await prizeOf(c);
    if (!prize) return c.json({ error: "not_found" }, 404);

    // 渡す相手は確定メンバーだけ（出席チェックと同じ基準）
    const member = await eventMembersRepo.find(eventId, userId);
    if (member?.status !== "confirmed") {
      return c.json({ error: "not_confirmed" }, 409);
    }

    const achieved =
      prize.conditionType === "meet_count"
        ? (await eventMeetsRepo.countedMeetsForUser(eventId, userId)) >=
          (prize.threshold ?? Infinity)
        : await eventMeetPrizesRepo.isWinner(eventId, userId);
    if (!achieved) return c.json({ error: "not_achieved" }, 409);

    const me = c.get("user");
    if (!(await eventMeetPrizesRepo.redeem(prize.id, userId, me.id))) {
      // 入らなかった理由を読み直して区別（窓口の案内文言が変わる）
      const already = await eventMeetPrizesRepo.findRedemption(
        prize.id,
        userId,
      );
      return c.json(
        { error: already ? "already_redeemed" : "out_of_stock" },
        409,
      );
    }
    return c.json({ ok: true }, 201);
  },
);

/** 交換済みの取り消し（staff のみ・誤操作訂正）。外す方向は緩く通す */
meetPrizeRoutes.delete(
  "/:id/meet-prizes/:prizeId/redeem/:userId",
  requireEventRole(["staff"]),
  async (c) => {
    if (!(await prizeOf(c))) return c.json({ error: "not_found" }, 404);
    const undone = await eventMeetPrizesRepo.deleteRedemption(
      c.req.param("prizeId"),
      c.req.param("userId"),
    );
    if (!undone) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);

/**
 * 1位を確定する（staff のみ）。締めた瞬間の最多者を全員（同率含む）勝者にする。
 * 締め直しは全置換。誰も出会っていなければ 409（勝者0人の「確定済み」を作らない。
 * 確定済みかは winner 行の有無で表しているため）。
 */
meetPrizeRoutes.post(
  "/:id/meets/winners/close",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const n = await eventMeetPrizesRepo.closeWinners(eventId, Date.now());
    if (n === 0) return c.json({ error: "no_meets" }, 409);
    return c.json({ winners: await eventMeetPrizesRepo.listWinners(eventId) });
  },
);

/** 確定を取り消して未確定に戻す（staff のみ・誤操作用） */
meetPrizeRoutes.delete(
  "/:id/meets/winners",
  requireEventRole(["staff"]),
  async (c) => {
    await eventMeetPrizesRepo.clearWinners(c.req.param("id"));
    return c.json({ ok: true });
  },
);
