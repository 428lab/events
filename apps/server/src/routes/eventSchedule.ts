import { Hono } from "hono";
import type { Context } from "hono";
import { saveScheduleInput, setScheduleLiveDeckInput, updateScheduleMaterialInput } from "@eventer/shared";
import type {
  SaveScheduleInput,
  ScheduleAudience,
  ScheduleEditingState,
  SetScheduleLiveDeckInput,
  UpdateScheduleMaterialInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser } from "../auth/session.js";
import { canManageEventAs, requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { publishLive } from "./liveControl.js";
import { deferBackground } from "../runtime.js";
import { eventSignal } from "../lib/eventSignal.js";
import { refreshMaterialMeta } from "../lib/materialMeta.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventScheduleRepo } from "../db/repositories/eventSchedule.js";
import { eventScheduleStateRepo } from "../db/repositories/eventScheduleState.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { decksRepo } from "../db/repositories/decks.js";
import { presenterSlidesRepo } from "../db/repositories/presenterSlides.js";

/** タイムテーブルの編集中・版が変わったことを、開いている運営の画面へ知らせる
 * （topic `schedule-editing`、D-POLL-MIN 第5段階 5b-4）。定期の見張りの代わり */
function publishScheduleEditingChanged(eventId: string): Promise<void> {
  return deferBackground(eventSignal.publishRefetch([["schedule-editing", eventId]]));
}

/** 編集中ステータスに合図の受け先を添える（staff のゲートの内側でだけ呼ぶ） */
async function withEditingSignal(eventId: string, readAt: number, state: ScheduleEditingState) {
  return { ...state, signal: await eventSignal.source(eventId, "schedule-editing", readAt) };
}

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

/** タイムテーブル一覧（閲覧できる人は誰でも）。
 * トラック (#338) も一緒に返す。時刻の計算にトラックの一覧が要るため、
 * 別々に取ると片方だけ古い状態で描画されうる。
 *
 * **未割り当て（ネタ出し中 #338）と裏方 (#383) は staff にしか返さない。**
 * 誰向けの取得かを決めるのは**このアプリでここ1か所だけ**で、あとは
 * `audience` としてリポジトリの入口へ渡す。取ってきたあとで JS の `filter` で
 * 除く形にはしない（除き忘れた経路が黙って参加者へ配ってしまうため）。
 *
 * スタッフ専用のエンドポイントは作らない。1本のまま「見える人には見える形で返す」ので、
 * 画面は「来たものをそのまま描く」だけで済む。 */
export async function getEventTimetable(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewTimetable(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  // 「編集できる人」＝「裏方まで見てよい人」＝「PUT が通る人」。
  // 判定は auth/roles.ts の canManageEvent 1つに寄せてある (#383)。
  // ずれていると、絞られた一覧を受け取った人の差分保存で裏方が全部消える
  const audience: ScheduleAudience = (await canManageEventAs(eventId, c))
    ? "staff"
    : "public";
  const items = await eventScheduleRepo.listByEvent(eventId, audience);
  // 配信用デッキの紐付け (#571) は、そのコマの担当者本人と staff にだけ添える。
  // 参加者には出さない（公開したいものは資料URLに載せる、という分け方）
  const viewer = await currentUser(c);
  if (viewer && (audience === "staff" || items.some((it) => it.speakerUserId === viewer.id))) {
    const decks = await presenterSlidesRepo.effectiveDecks(eventId);
    for (const it of items) {
      if (audience === "staff" || it.speakerUserId === viewer.id) it.liveDeck = decks.get(it.id) ?? null;
    }
  }
  return c.json({
    items,
    tracks: await eventScheduleRepo.listTracks(eventId, audience),
    // 保存時に送り返してもらう版 (#340)。読み専用の相手にも返してよい
    // （中身は単なる連番で、返さないと編集画面が版を知る経路が無くなる）
    version: await eventScheduleStateRepo.getVersion(eventId),
  });
}

/* ===== 書き込み（要認証。staff のみ） ===== */

export const eventScheduleRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/** タイムテーブルの保存（全項目を送り、サーバーが差分で反映する。staff のみ #340）。
 * 既存項目の ID を送れば更新扱いになり、ID が保存をまたいで変わらない。
 * トラックの定義と割り当て (#338) も同じ保存で一緒に反映する。
 *
 * **保存は全項目の置き換えなので、そのまま通すと他人の変更を丸ごと消す**。
 * 読んだ時点の版 (version) を突き合わせ、食い違ったら 409 で止める。
 * 編集中の表示は助言でしかないので、上書きを実際に防いでいるのはここだけ */
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
    const state = await eventScheduleStateRepo.getOrInit(eventId);
    if (state.version !== input.version) {
      return c.json({ error: "conflict", version: state.version }, 409);
    }
    // 知らない ID が混じっていたら止める。版が合っていてもここは確かめる。
    // 「編集画面を開いたまま他人がセッションを消した」場合、そのまま通すと
    // 新しい ID で復活し、トラックの割り当てだけが黙って消える
    const live = await eventScheduleRepo.listIds(eventId);
    const seenItems = new Set<string>();
    const seenTracks = new Set<string>();
    for (const it of input.items) {
      if (it.id === null) continue;
      if (!live.itemIds.has(it.id) || seenItems.has(it.id)) {
        return c.json({ error: "conflict", version: state.version }, 409);
      }
      seenItems.add(it.id);
    }
    for (const t of input.tracks ?? []) {
      if (t.id === null) continue;
      if (!live.trackIds.has(t.id) || seenTracks.has(t.id)) {
        return c.json({ error: "conflict", version: state.version }, 409);
      }
      seenTracks.add(t.id);
    }
    // 版を先に取りに行く。同じ版を持った2人が同時に押しても通るのは片方だけ
    // （読んで比べるだけでは、読んでから書くまでの隙間に両方が通ってしまう）
    const version = await eventScheduleStateRepo.bumpVersion(
      eventId,
      input.version, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    if (version === null) {
      return c.json(
        { error: "conflict", version: await eventScheduleStateRepo.getVersion(eventId) },
        409,
      );
    }
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
    const saved = await eventScheduleRepo.saveAll(eventId, items, input.tracks, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    // OG サムネイルはレスポンスを待たせずバックグラウンドで取得 (#149)
    await deferBackground(refreshMaterialMeta(eventId));
    // 版が進んだ。開いている他の運営の編集画面に「保存されたので、このままだと衝突する」と
    // 先に知らせる（衝突を実際に止めるのは版の突き合わせのまま）
    await publishScheduleEditingChanged(eventId);
    // 保存できるのは staff だけなので、返すのも staff 向けの全量
    return c.json({
      items: saved,
      tracks: await eventScheduleRepo.listTracks(eventId, "staff"),
      version,
    });
  },
);

/* ===== 編集中ステータス (#340) ===== */

/** 編集中ステータスは行を作りながら読むので、イベントの実在を先に確かめる
 * （アプリ管理者は存在しないイベントでも requireEventRole を通るため）。
 * 下書き（公開前）のイベントでも staff なら通る。#339 で公開前に運営を
 * 追加できるようになれば、そのまま公開前の共同編集にも効く */
eventScheduleRoutes.use("/:id/timetable/editing", async (c, next) => {
  if (!(await eventsRepo.findById(c.req.param("id")!))) {
    return c.json({ error: "not_found" }, 404);
  }
  await next();
});

/** いま誰がタイムテーブルを編集しているか。編集できる人だけが見られる。
 * 画面は定期に取りに来ない。開いたとき・タブ復帰と、応答の `signal`
 * （topic `schedule-editing`）の合図で取り直す（D-POLL-MIN 第5段階 5b-4） */
eventScheduleRoutes.get(
  "/:id/timetable/editing",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const readAt = Date.now();
    return c.json(await withEditingSignal(eventId, readAt, await eventScheduleStateRepo.getOrInit(eventId)));
  },
);

/** 「自分が編集中」と宣言する／宣言を延長する。
 *
 * 呼ぶのは編集画面を開いたときと、編集したとき（前の宣言から
 * SCHEDULE_EDIT_RENEW_MS 以上経っていれば）だけ。定期の心拍はしない。
 * **他人の編集中は奪わない**が、**奪えなくても編集と保存は止めない**（助言）。
 * 引き継ぎのボタンを別に用意しないのはそのため。放置された編集中は
 * SCHEDULE_EDIT_EXPIRE_MS で自動的に空くので、待てば必ず自分のものになる。
 * 返すのは反映後の状態なので、奪えなかった側には相手の名前が返る。
 * 編集している人が替わったときだけ合図を送る（同じ人の延長は他の画面に関係ない） */
eventScheduleRoutes.post(
  "/:id/timetable/editing",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const userId = c.get("user").id;
    const readAt = Date.now();
    const before = await eventScheduleStateRepo.getOrInit(eventId);
    const after = await eventScheduleStateRepo.claimEditor(
      eventId,
      userId, {eventId:c.req.param("id")!,actorId:userId,permission:"manager"});
    if (before.editor?.userId !== after.editor?.userId) await publishScheduleEditingChanged(eventId);
    return c.json(await withEditingSignal(eventId, readAt, after));
  },
);

/** 編集をやめた（画面を閉じた・保存し終えた・ページを離れた）。自分の宣言だけ外せる。
 * ページを離れるときは keepalive の fetch で届く（応答は読まれない） */
eventScheduleRoutes.delete(
  "/:id/timetable/editing",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const userId = c.get("user").id;
    const readAt = Date.now();
    const before = await eventScheduleStateRepo.getOrInit(eventId);
    const after = await eventScheduleStateRepo.releaseEditor(
      eventId,
      userId, {eventId:c.req.param("id")!,actorId:userId,permission:"manager"});
    if (before.editor?.userId !== after.editor?.userId) await publishScheduleEditingChanged(eventId);
    return c.json(await withEditingSignal(eventId, readAt, after));
  },
);

/** 登壇資料URLの更新（登壇者本人の自己編集 #148）。
 * staff は編集画面から全体を保存できるが、このエンドポイントでも更新可。
 *
 * **対象は常に参加者に見せる項目だけ** (#383)。裏方の項目は `"public"` で
 * 引けないので 404 になる。「引いてから弾く」にしないのは、弾き忘れると
 * 裏方のタイトル・説明・担当が応答に載って漏れるため。
 * 裏方に登壇資料は要らないので機能の損失も無い
 * （staff も編集画面の全体保存からは触れる）。 */
eventScheduleRoutes.patch(
  "/:id/timetable/:itemId/material",
  zValidator("json", updateScheduleMaterialInput),
  async (c) => {
    const eventId = c.req.param("id");
    const itemId = c.req.param("itemId");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const item = await eventScheduleRepo.findItem(eventId, itemId, "public");
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
    await eventScheduleRepo.updateMaterial(eventId, itemId, input.materialUrl, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"view"});
    // 版を進める (#340)。staff が編集画面を開いたまま全体を保存すると、
    // 編集開始時点の古い URL でここの更新を巻き戻してしまう。
    // 版が進んでいれば、その保存は 409 で止まり、読み直しを促せる
    await eventScheduleStateRepo.touch(eventId, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"view"});
    await publishScheduleEditingChanged(eventId);
    // OG サムネイルはバックグラウンドで再取得 (#149)
    await deferBackground(refreshMaterialMeta(eventId));
    const updated = await eventScheduleRepo.findItem(eventId, itemId, "public");
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ item: updated });
  },
);

/** 配信用デッキの紐付け (#571)。登壇者本人が、自分が話すコマに自分のデッキを1つ紐付ける。
 *
 * - **付ける**のはそのコマの担当者本人（現役メンバー）だけ。staff・管理者でも代わりに付けられない
 *   （紐付けが「このイベントのこのコマで運営に見せてよい」という本人の同意そのものなので）
 * - **外す**（`deckId: null`）のは本人か staff。外すのは見せる範囲を狭める向きなので同意を損なわない
 * - 対象は参加者に見せるコマだけ（#148 の資料URLと同じ。裏方は 404）
 * - 外したデッキが配信中なら、同じ書き込みで配信状態のデッキも外す */
eventScheduleRoutes.put(
  "/:id/timetable/:itemId/live-deck",
  zValidator("json", setScheduleLiveDeckInput),
  async (c) => {
    const eventId = c.req.param("id");
    const itemId = c.req.param("itemId");
    const item = await eventScheduleRepo.findItem(eventId, itemId, "public");
    if (!item) return c.json({ error: "not_found" }, 404);
    const user = c.get("user");
    const { deckId } = valid<SetScheduleLiveDeckInput>(c, "json");
    const member = await eventMembersRepo.find(eventId, user.id);
    const isSpeakerSelf = item.speakerUserId === user.id && member != null;
    if (deckId) {
      if (!isSpeakerSelf) return c.json({ error: "forbidden" }, 403);
      const deck = await decksRepo.findById(deckId);
      if (!deck || deck.ownerId !== user.id) return c.json({ error: "deck_not_owned" }, 403);
    } else if (!isSpeakerSelf && !(await canManageEventAs(eventId, c))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const changed = await presenterSlidesRepo.setLink(eventId, itemId, deckId, {eventId, actorId: user.id, permission: "view"});
    // 判定と書き込みの間に担当者・持ち主が変わった場合は書かれない
    if (changed === 0) return c.json({ error: "forbidden" }, 403);
    // 配信中のコマなら映すデッキが変わる（presenterSlides.setLink が event_live_state も書く）
    await publishLive([eventId]);
    const decks = await presenterSlidesRepo.effectiveDecks(eventId);
    return c.json({ liveDeck: decks.get(itemId) ?? null });
  },
);
