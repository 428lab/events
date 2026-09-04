import { Hono } from "hono";
import type { Context } from "hono";
import type {
  CreateMeetPrizeInput,
  Event,
  MeetPrize,
  MeetPrizeList,
  MeetPrizeStatus,
  MeetPrizeView,
  RedeemMeetPrizeInput,
  UpdateMeetPrizeInput,
  User,
} from "@eventer/shared";
import {
  MEET_PRIZE_IMAGE,
  MEET_PRIZE_MAX,
  createMeetPrizeInput,
  meetPrizeImageUrl,
  redeemMeetPrizeInput,
  updateMeetPrizeInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser } from "../auth/session.js";
import { canManageEvent, canViewEvent, requireEventRole } from "../auth/roles.js";
import { getBucket } from "../runtime.js";
import { deleteObjects } from "../lib/mediaCleanup.js";
import { hasImageMagicBytes, normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { eventMeetsRepo } from "../db/repositories/eventMeets.js";
import { eventMeetPrizesRepo } from "../db/repositories/eventMeetPrizes.js";
import {
  drawnNumbers,
  eventBingoRepo,
} from "../db/repositories/eventBingo.js";
import { deriveBingoCard } from "@eventer/shared";

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
 * 見せてよい相手は公開一覧と同じ meetPrizeAudience の1か所で判定する。
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
  const audience = await meetPrizeAudience(event, user);
  if (!audience) return c.json({ error: "not_found" }, 404);

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
      // 設定オフ・下書きを staff 例外で通した応答は共有キャッシュに置かせない
      "Cache-Control":
        audience === "staff" ? "private, max-age=60" : "public, max-age=60",
      ETag: etag,
    },
  });
}

/** イベント複製用: 景品画像を別の景品へコピー（元が無ければ何もしない）。
 * キーは新しく振る（共有すると片方の削除で共倒れするため）。
 * 失敗は握りつぶして**画像なしで複製を完了**させる（画像1枚のために
 * 複製 API 全体を 500 にしない。ログで追える） */
export async function copyMeetPrizeImage(
  src: MeetPrize,
  dstPrizeId: string,
): Promise<void> {
  if (!src.imageKey) return;
  try {
    const obj = await getBucket().get(src.imageKey);
    if (!obj) return;
    // 画像は MEET_PRIZE_IMAGE.maxBytes（1MB）以内なのでメモリに載せてコピーする
    const body = await obj.arrayBuffer();
    const newKey = prizeImageKey(dstPrizeId);
    await getBucket().put(newKey, body, {
      httpMetadata: { contentType: obj.httpMetadata?.contentType },
    });
    await eventMeetPrizesRepo.setImageKey(dstPrizeId, newKey);
  } catch (e) {
    console.error("[meet-prize] image copy failed", src.imageKey, e);
  }
}

/**
 * 景品が誰に見えるか（**オフの隠蔽の門の述語はこれ1つ**。公開一覧と画像 GET が共用）。
 * - "public": 設定オンで、イベント自体を見られる人（未ログイン含む）
 * - "staff": 設定オフ・下書きでも運営できる人（仕込み中の編集・プレビュー用）
 * - null: 見せない（イベント不存在と同一の 404 で存在ごと隠す）
 */
async function meetPrizeAudience(
  event: Event,
  user: User | null,
): Promise<"public" | "staff" | null> {
  if (event.meetPrizes && (await canViewEvent(event, user))) return "public";
  if (user && (await canManageEvent(event.id, user))) return "staff";
  return null;
}

/** 本人がビンゴを達成しているか (#436)。ゲームと自分のカードから導出する
 * （達成テーブルは無い。me の表示と redeem の再検証が同じこの1つを使う） */
async function hasBingo(eventId: string, userId: string): Promise<boolean> {
  const game = await eventBingoRepo.findGame(eventId);
  if (!game) return false;
  const card = await eventBingoRepo.findCard(eventId, userId);
  if (!card) return false;
  return deriveBingoCard(card, drawnNumbers(game)).bingo;
}

/**
 * 公開: 景品一覧（未ログイン可。awards の canView と同じ基準）。
 * 見せてよい相手かは meetPrizeAudience の1か所で判定する。
 * **この公開経路はオフなら staff にも一律 404**（設計 §3.9。staff の例外が
 * 効くのは staff 用ルートと画像 GET だけ。staff はオフでも /list を読める）。
 */
export async function getEventMeetPrizes(c: Context) {
  const eventId = c.req.param("id")!;
  const event = await eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  if ((await meetPrizeAudience(event, user)) !== "public") {
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
          bingo: await hasBingo(eventId, user.id),
          redemptions: await eventMeetPrizesRepo.redemptionsForUser(
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
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

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
    await deleteObjects(
      prize.imageKey ? [prize.imageKey] : [],
      `[meet-prize] prize=${prize.id}`,
    );
    return c.json({ ok: true });
  },
);

/**
 * 景品画像のアップロード (#434)（staff のみ・生バイナリ）。
 * 検証はイベント画像 (routes/images.ts putEventImage) と同じ契約
 * （MIME 許可リスト imageMime.ts・MEET_PRIZE_IMAGE.maxBytes）＋マジックバイト検査。
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
    if (declared > MEET_PRIZE_IMAGE.maxBytes) {
      return c.json({ error: "too_large", maxBytes: MEET_PRIZE_IMAGE.maxBytes }, 413);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
    if (body.byteLength > MEET_PRIZE_IMAGE.maxBytes) {
      return c.json({ error: "too_large", maxBytes: MEET_PRIZE_IMAGE.maxBytes }, 413);
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
      await deleteObjects([newKey], `[meet-prize] new prize=${prize.id}`);
      throw e;
    }
    await deleteObjects(
      prize.imageKey ? [prize.imageKey] : [],
      `[meet-prize] old prize=${prize.id}`,
    );
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
    await deleteObjects([prize.imageKey], `[meet-prize] prize=${prize.id}`);
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

/** 引き換え履歴 (#441)（staff のみ）。全景品種別を時刻順（新しい順）で返す */
meetPrizeRoutes.get(
  "/:id/meet-prizes/log",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ log: await eventMeetPrizesRepo.redemptionLog(eventId) });
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

    // ビンゴ景品プール (#436): 達成者は達成順の1本のリスト（景品ごとに繰り返さない）。
    // デスクは「達成者が在庫のあるプール景品から1つ選ぶ」UIを組む
    const hasBingoPrize = prizes.some((p) => p.conditionType === "bingo");
    const bingoGame = hasBingoPrize
      ? await eventBingoRepo.findGame(eventId)
      : null;
    const bingoRows = bingoGame
      ? await eventBingoRepo.statusRows(eventId, drawnNumbers(bingoGame))
      : [];
    const poolTaken = hasBingoPrize
      ? await eventMeetPrizesRepo.bingoPoolRedemptions(eventId)
      : new Map<string, { prizeId: string; createdAt: number }>();
    const bingoAchievers = bingoRows
      .filter((r) => r.bingo)
      .map((r) => ({
        userId: r.userId,
        username: r.username,
        name: r.name,
        avatarUrl: r.avatarUrl,
        rank: r.rank ?? 0,
        completedAtSeq: r.completedAtSeq ?? 0,
        redeemedPrizeId: poolTaken.get(r.userId)?.prizeId ?? null,
        redeemedAt: poolTaken.get(r.userId)?.createdAt ?? null,
      }));

    const rows = [];
    for (const prize of prizes) {
      // 達成者: meet_count は件数から、top_rank は確定済みの勝者から導出。
      // bingo はプールの1本（bingoAchievers）に出すので per-prize では空。
      // クエリは景品ごとに高々1本（threshold は CHECK 制約で meet_count に必ず入る）
      const base =
        prize.conditionType === "meet_count"
          ? await eventMeetPrizesRepo.achieversAtLeast(
              eventId,
              prize.threshold ?? 1,
            )
          : prize.conditionType === "top_rank"
            ? winners
            : [];
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
    return c.json({
      prizes: rows,
      winners,
      bingoAchievers,
    } satisfies MeetPrizeStatus);
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

    // threshold は CHECK 制約で meet_count に必ず入る（?? 1 は型の絞り込みだけ）。
    // bingo の達成順はここで検証しない（同着の裁定は現場。docs/bingo.md §3.7）
    const achieved =
      prize.conditionType === "meet_count"
        ? (await eventMeetsRepo.countedMeetsForUser(eventId, userId)) >=
          (prize.threshold ?? 1)
        : prize.conditionType === "top_rank"
          ? await eventMeetPrizesRepo.isWinner(eventId, userId)
          : await hasBingo(eventId, userId);
    if (!achieved) return c.json({ error: "not_achieved" }, 409);

    const me = c.get("user");
    // bingo はプール全体で1人1回（redeemFromBingoPool の1文）。他は景品ごとに1回
    const ok =
      prize.conditionType === "bingo"
        ? await eventMeetPrizesRepo.redeemFromBingoPool(
            eventId,
            prize.id,
            userId,
            me.id,
          )
        : await eventMeetPrizesRepo.redeem(prize.id, userId, me.id);
    if (!ok) {
      // 入らなかった理由を読み直して区別（窓口の案内文言が変わる）
      const already =
        prize.conditionType === "bingo"
          ? await eventMeetPrizesRepo.findBingoPoolRedemption(eventId, userId)
          : await eventMeetPrizesRepo.findRedemption(prize.id, userId);
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
