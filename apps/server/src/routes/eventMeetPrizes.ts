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
  EVENT_IMAGE,
  MEET_PRIZE_MAX,
  createMeetPrizeInput,
  meetPrizeImageUrl,
  redeemMeetPrizeInput,
  updateMeetPrizeInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { canManageEvent, canViewEvent, requireEventRole } from "../auth/roles.js";
import { getBucket } from "../runtime.js";
import { hasImageMagicBytes, normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
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
    // 公開応答に R2 キーは載せない（URL だけ #434）
    imageUrl: meetPrizeImageUrl(prize.eventId, prize.id, prize.imageKey),
  };
}

/* =========================================================
 *  景品画像 (#434)。本体は R2、キーは event_prize.image_key
 * =======================================================*/

/** R2 キー。アップロードごとに新しい乱数を振る:
 * 同じキーへの上書きだと差し替え失敗時に新旧が混ざり、複製でキーを共有すると
 * 片方の削除で共倒れする。掃除は「参照を外してから旧キーを消す」の一方向 */
const prizeImageKey = (prizeId: string) =>
  `prize-images/${prizeId}/${crypto.randomUUID()}`;

/**
 * 公開: 景品画像の取得（未ログイン可）。イベント画像 (routes/images.ts) と同じ
 * 配信の型（R2 ストリーム＋許可リスト固定の Content-Type＋nosniff＋ETag）。
 * 見せてよい相手も公開一覧と同じ門（オフ・不可視は 404）だが、staff だけは
 * オフでも見られる（編集・デスクのプレビューが仕込み中に使う）。
 */
export async function getMeetPrizeImage(c: Context) {
  const eventId = c.req.param("id")!;
  const event = await eventsRepo.findById(eventId);
  const prize = event
    ? await eventMeetPrizesRepo.findById(c.req.param("prizeId")!)
    : null;
  if (!event || !prize || prize.eventId !== eventId || !prize.imageKey) {
    return c.json({ error: "not_found" }, 404);
  }
  const user = await currentUser(c);
  const visible =
    event.meetPrizes && (await canViewEvent(event, user));
  if (!visible && !(user && (await canManageEvent(eventId, user)))) {
    return c.json({ error: "not_found" }, 404);
  }

  // キー末尾はアップロードごとの乱数なので、そのまま ETag になる
  const etag = `"${prize.imageKey.split("/").pop()}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304 });
  }
  const obj = await getBucket().get(prize.imageKey);
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(obj.httpMetadata?.contentType),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=60",
      ETag: etag,
    },
  });
}

/** イベント複製用: 景品画像を別の景品へコピー（元が無ければ何もしない）。
 * キーは新しく振る（共有すると片方の削除で共倒れするため） */
export async function copyMeetPrizeImage(
  src: MeetPrize,
  dstPrizeId: string,
): Promise<void> {
  if (!src.imageKey) return;
  const obj = await getBucket().get(src.imageKey);
  if (!obj) return;
  // 画像は 1MB 以内（EVENT_IMAGE と同じ上限）なのでメモリに載せてコピーする
  const body = await obj.arrayBuffer();
  const newKey = prizeImageKey(dstPrizeId);
  await getBucket().put(newKey, body, {
    httpMetadata: { contentType: obj.httpMetadata?.contentType },
  });
  await eventMeetPrizesRepo.setImageKey(dstPrizeId, newKey);
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
  // 下書きの可視判定は canViewEvent の1か所（判定の写しを持たない）。
  // 見られない人には 404（オフの隠蔽と同じ応答）
  if (!(await canViewEvent(event, user))) {
    return c.json({ error: "not_found" }, 404);
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
    const prize = await prizeOf(c);
    if (!prize) return c.json({ error: "not_found" }, 404);
    await eventMeetPrizesRepo.delete(prize.id);
    // 行が消えた画像は誰にも辿れない孤児になるので、ここで R2 も消す (#434)。
    // best-effort（失敗してもログで追える。参照は既に無いので配信はされない）
    if (prize.imageKey) {
      try {
        await getBucket().delete(prize.imageKey);
      } catch (e) {
        console.error("[meet-prize] image cleanup failed", prize.imageKey, e);
      }
    }
    return c.json({ ok: true });
  },
);

/**
 * 景品画像のアップロード (#434)（staff のみ・生バイナリ）。
 * 検証はイベント画像 (routes/images.ts putEventImage) と同じ契約
 * （MIME 許可リスト imageMime.ts・EVENT_IMAGE.maxBytes）＋マジックバイト検査。
 *
 * 掃除の順序（put 失敗時に孤児を残さない — PR #423 の教訓）:
 * 新キーに put → D1 の参照を差し替え（失敗したら新キーを消して投げ直す）→
 * 旧キーを best-effort で削除。どこで落ちても「参照されない新オブジェクト」か
 * 「参照が旧のまま」にしかならず、参照先が消えている状態を作らない。
 */
meetPrizeRoutes.put(
  "/:id/meet-prizes/:prizeId/image",
  requireEventRole(["staff"]),
  async (c) => {
    const prize = await prizeOf(c);
    if (!prize) return c.json({ error: "not_found" }, 404);

    const mime = normalizeImageMime(c.req.header("content-type"));
    if (!mime) return c.json({ error: "invalid_content_type" }, 400);
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > EVENT_IMAGE.maxBytes) {
      return c.json({ error: "too_large", maxBytes: EVENT_IMAGE.maxBytes }, 413);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
    if (body.byteLength > EVENT_IMAGE.maxBytes) {
      return c.json({ error: "too_large", maxBytes: EVENT_IMAGE.maxBytes }, 413);
    }
    const head = new Uint8Array(body, 0, Math.min(12, body.byteLength));
    if (!hasImageMagicBytes(head, mime)) {
      return c.json({ error: "invalid_image" }, 400);
    }

    const bucket = getBucket();
    const newKey = prizeImageKey(prize.id);
    await bucket.put(newKey, body, { httpMetadata: { contentType: mime } });
    try {
      await eventMeetPrizesRepo.setImageKey(prize.id, newKey);
    } catch (e) {
      // 参照の差し替えに失敗したら、置いたばかりの新キーを消して投げ直す
      try {
        await bucket.delete(newKey);
      } catch (cleanupError) {
        console.error("[meet-prize] image cleanup failed", newKey, cleanupError);
      }
      throw e;
    }
    if (prize.imageKey) {
      try {
        await bucket.delete(prize.imageKey);
      } catch (e) {
        console.error("[meet-prize] old image cleanup failed", prize.imageKey, e);
      }
    }
    return c.json({ prize: await eventMeetPrizesRepo.findById(prize.id) });
  },
);

/** 景品画像の削除 (#434)（staff のみ）。参照を外してから R2 を best-effort で消す */
meetPrizeRoutes.delete(
  "/:id/meet-prizes/:prizeId/image",
  requireEventRole(["staff"]),
  async (c) => {
    const prize = await prizeOf(c);
    if (!prize || !prize.imageKey) return c.json({ error: "not_found" }, 404);
    await eventMeetPrizesRepo.setImageKey(prize.id, null);
    try {
      await getBucket().delete(prize.imageKey);
    } catch (e) {
      console.error("[meet-prize] image cleanup failed", prize.imageKey, e);
    }
    return c.json({ ok: true });
  },
);

/** 景品の定義一覧（staff のみ・編集画面用）。達成者や在庫の集計はしない軽い口。
 * オフのイベントでも動く（仕込み用） */
meetPrizeRoutes.get(
  "/:id/meet-prizes/list",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ prizes: await eventMeetPrizesRepo.listByEvent(eventId) });
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
    const winners = await eventMeetPrizesRepo.listWinners(eventId);
    // 引き換え記録はイベント単位で1回だけ引く。達成者×景品の入れ子で
    // 1件ずつ問い合わせると N+1（人数×景品数）になる（レビュー指摘）
    const redemptions = await eventMeetPrizesRepo.redemptionsForEvent(eventId);

    const rows = [];
    for (const prize of prizes) {
      // 達成者: meet_count は件数から、top_rank は確定済みの勝者から導出。
      // クエリは景品ごとに高々1本（threshold は CHECK 制約で meet_count に必ず入る）
      const base =
        prize.conditionType === "meet_count"
          ? await eventMeetPrizesRepo.achieversAtLeast(
              eventId,
              prize.threshold ?? 1,
            )
          : winners;
      const byUser = redemptions.get(prize.id);
      const achievers = base.map((a) => ({
        userId: a.userId,
        username: a.username,
        name: a.name,
        avatarUrl: a.avatarUrl,
        count: a.count,
        redeemed: byUser?.has(a.userId) ?? false,
        redeemedAt: byUser?.get(a.userId) ?? null,
      }));
      const n = byUser?.size ?? 0;
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

    // threshold は CHECK 制約で meet_count に必ず入る（?? 1 は型の絞り込みだけ）
    const achieved =
      prize.conditionType === "meet_count"
        ? (await eventMeetsRepo.countedMeetsForUser(eventId, userId)) >=
          (prize.threshold ?? 1)
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
