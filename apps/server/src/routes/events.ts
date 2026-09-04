import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { eventPublicRoutes } from "./eventsPublic.js";
import { eventDateOptionRoutes } from "./eventDateOptions.js";
import { eventCrudRoutes } from "./eventCrud.js";
import { eventDuplicateRoutes } from "./eventDuplicate.js";
import { eventMemberRoutes } from "./eventMembers.js";
import { eventCheckinRoutes } from "./eventCheckin.js";
import { eventSlotRoutes } from "./eventSlots.js";
import { eventEntryRoutes } from "./eventEntries.js";

/**
 * `/api/events` の合成。**この並び順が振る舞いそのもの**。
 *
 * ## requireAuth の位置が契約
 *
 * `eventRoutes` は `/events/*` 全体の認証境界を持っている。Hono の `route()` は
 * 呼び出した時点で子のルートを親へ展開するので、ここに並んだ順がそのまま
 * ルーターの登録順になる。`use("*", requireAuth)` **より前** に並べたものだけが
 * 未ログインで通る。後ろへ動かすと公開イベントの詳細が 401 になる。
 *
 * この境界は worker.ts の登録順ごと、他のイベント配下ルートファイル
 * （`scoring.ts` など20本以上）が前提にしている。`worker.ts` で `eventRoutes`
 * より **前** に登録されたものは認証なしで通り、**後ろ** は必ずここを通る。
 * 認証なしで通したい GET を増やすときは `eventsPublic.ts` に足すこと。
 *
 * ## 中身がどこにあるか
 *
 * 責務ごとに分けてある。増やすときも「イベントそのもの」「参加」「枠」のように
 * 軸で選ぶこと（1ファイルに足し続けると、権限の検査が経路ごとにコピーされて必ずずれる）。
 */
export const eventRoutes = new Hono<AppEnv>();

/* ── 未ログインでも通る（requireAuth より前）───────────────── */
eventRoutes.route("/", eventPublicRoutes);

/* ── ここから認証必須 ──────────────────────────────────── */
eventRoutes.use("*", requireAuth);

eventRoutes.route("/", eventDateOptionRoutes); // 候補日・投票・日程確定
eventRoutes.route("/", eventCrudRoutes); // 一覧・作成・更新・公開・画像・削除
eventRoutes.route("/", eventDuplicateRoutes); // 複製
eventRoutes.route("/", eventMemberRoutes); // 参加・解除・ロール・出席
eventRoutes.route("/", eventCheckinRoutes); // QR受付
eventRoutes.route("/", eventSlotRoutes); // 参加枠・抽選・当落
eventRoutes.route("/", eventEntryRoutes); // 成果物の保存
