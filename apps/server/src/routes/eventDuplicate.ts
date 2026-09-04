import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import { awardsRepo } from "../db/repositories/awards.js";
import { eventMeetPrizesRepo } from "../db/repositories/eventMeetPrizes.js";
import { copyMeetPrizeImage } from "./eventMeetPrizes.js";
import { eventTodosRepo } from "../db/repositories/eventTodos.js";
import { eventDutiesRepo } from "../db/repositories/eventDuties.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { scoringCriteriaRepo } from "../db/repositories/scoringCriteria.js";
import { participationSlotsRepo } from "../db/repositories/participationSlots.js";
import { copyEventImage } from "./images.js";

/**
 * イベントの複製 (#340)。
 *
 * ## 何をコピーし、何をコピーしないか
 *
 * コピーするのは **定義** だけ。設定・参加枠・採点基準・出会いの景品・表彰・
 * 準備の段取り TODO・スタッフの役割・イベント画像を持ち越す。
 *
 * コピーしないのは **その回の実績と、絶対時刻に紐づいた値**:
 * - メンバー・エントリー・コメント・写真・日程調整の候補と投票・受賞結果
 * - 募集締切 (#269)・抽選日時 `drawAt`・TODO の期限と担当と状態
 *
 * 後者をコピーしない理由は1つ。複製は開催日時を 0（未定）に戻すので、
 * 複製元の絶対時刻をそのまま持ち越すと「作った瞬間もう締め切られている」
 * 「作った瞬間に全部が遅れている」下書きができてしまう。
 */
export const eventDuplicateRoutes = new Hono<AppEnv>();

eventDuplicateRoutes.post(
  "/:id/duplicate",
  requireEventRole(["staff"]),
  async (c) => {
    const src = await eventsRepo.findById(c.req.param("id"));
    if (!src) return c.json({ error: "not_found" }, 404);
    const user = c.get("user");

    // タイトル末尾に「のコピー」（200字上限を超えるなら切り詰めてから付与）
    const suffix = "のコピー";
    // コードポイント境界で切り詰め（サロゲートペアを分断しない）
    const base =
      src.title.length + suffix.length > 200
        ? [...src.title].slice(0, 200 - suffix.length).join("")
        : src.title;

    // 基本情報をコピーして下書きで作成。開催日時は未定（0）に戻し、
    // 日程調整をやり直せるよう scheduling=true で作る（編集で直接設定も可能）
    const created = await eventsRepo.create(
      {
        title: base + suffix,
        subtitle: src.subtitle,
        description: src.description,
        startsAt: 0,
        endsAt: 0,
        venueType: src.venueType,
        venueOffline: src.venueOffline,
        venueOnline: src.venueOnline,
        aggregateSelfEntry: src.aggregateSelfEntry,
        contestMode: src.contestMode,
        // 複製元と同じコミュニティに紐づける。複製できるのは複製元の staff
        // （＝そのコミュニティ側から招かれた人）だけなので、#264 の
        // 「第三者が任意のコミュニティにぶら下げる」経路にはならない
        communityId: src.communityId,
        scheduling: true,
        scheduleAnonymous: src.scheduleAnonymous,
        venueWanted: src.venueWanted,
      },
      user.id,
    );
    await eventMembersRepo.add(created.id, user.id, "staff");

    // create が受け取らない設定と参加者限定の文章は update で反映
    await eventsRepo.update(created.id, {
      scheduleVisible: src.scheduleVisible,
      photosPublic: src.photosPublic,
      attendanceCheck: src.attendanceCheck,
      chatEnabled: src.chatEnabled,
      chatUrlsAllowed: src.chatUrlsAllowed,
      // Q&A (#216) は設定だけコピーする（質問・票は複製元のもの）
      qaEnabled: src.qaEnabled,
      qaAnonymity: src.qaAnonymity,
      // 出会いランキング (#418) も設定だけコピーする（出会いの記録はコピーしない）
      meetRanking: src.meetRanking,
      // 出会いの景品 (#431) も設定と定義だけコピー（下）。引き換え記録・1位はコピーしない
      meetPrizes: src.meetPrizes,
      membersNote: await eventsRepo.membersNoteFor(src.id),
    });

    // 参加枠の定義（参加者は除く）。listByEvent は sort_order 順なので順序が保たれる
    for (const slot of await participationSlotsRepo.listByEvent(src.id)) {
      await participationSlotsRepo.create(created.id, {
        name: slot.name,
        capacity: slot.capacity,
        selectionType: slot.selectionType,
        // 抽選日時は旧イベントの絶対時刻なのでコピーしない（日程リセットと整合）
        drawAt: null,
      });
    }

    // 採点基準（デフォルトのシードではなく元イベントの内容をコピー）
    for (const cr of await scoringCriteriaRepo.listByEvent(src.id)) {
      await scoringCriteriaRepo.create(created.id, {
        name: cr.name,
        description: cr.description,
        maxLevel: cr.maxLevel,
      });
    }

    // 出会いの景品の定義 (#431)（引き換え記録・1位の確定は除く）。
    // 画像 (#434) は R2 オブジェクトごとコピーして新しいキーを振る
    // （キーを共有すると片方の削除で共倒れするため）
    for (const prize of await eventMeetPrizesRepo.listByEvent(src.id)) {
      const copied = await eventMeetPrizesRepo.create(created.id, {
        name: prize.name,
        description: prize.description,
        conditionType: prize.conditionType,
        threshold: prize.threshold,
        stock: prize.stock,
      });
      await copyMeetPrizeImage(prize, copied.id);
    }

    // 表彰の定義（受賞結果は除く）
    for (const rank of await awardsRepo.listRanks(src.id)) {
      await awardsRepo.createRank(created.id, {
        name: rank.name,
        content: rank.content,
      });
    }
    for (const special of await awardsRepo.listSpecials(src.id)) {
      await awardsRepo.createSpecial(created.id, {
        name: special.name,
        content: special.content,
      });
    }

    // 準備の段取り TODO (#393)。題名・補足・依存の辺・並び順だけを持ち越す
    // （日付・担当・状態はコピーしない。理由はファイル冒頭）。
    // 辺の張り替えはリポジトリに閉じる
    await eventTodosRepo.copyForDuplicate(src.id, created.id, user.id);

    // スタッフの役割の定義 (#384)。名前と並び順だけをコピーする。
    // 持ち場（時間帯×役割×人数）と割り当てはコピー**できない**: 複製は
    // タイムテーブルをコピーしないので、ぶら下げる先の項目が複製先に無い。
    // **将来タイムテーブルの複製が入ったら、持ち場（event_duty_slot）も
    // コピー対象に含めること**（割り当ては含めない。複製先は開催日時 0 の
    // 下書きで、スタッフ集めもこれからのため）。
    await eventDutiesRepo.copyForDuplicate(src.id, created.id);

    // イベント画像（元画像が無ければスキップ）
    await copyEventImage(src.id, created.id);

    return c.json({ event: await eventsRepo.findById(created.id) }, 201);
  },
);
