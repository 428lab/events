import { Hono } from "hono";
import type { Context } from "hono";
import {
  CHAT_CHANNEL_ABOUT,
  hideChatNoteInput,
  registerChatChannelInput,
  registerChatPubkeyInput,
} from "@eventer/shared";
import type {
  ChatMembersPayload,
  HideChatNoteInput,
  RegisterChatChannelInput,
  RegisterChatPubkeyInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isConfirmedEventStaff, requireEventRole } from "../auth/roles.js";
import {
  verifyChatKeyProof,
  verifyEventSignature,
} from "../auth/nostr.js";
import {
  generateChatKey,
  serviceKeyConfigured,
  servicePubkey,
  signWithServiceKey,
} from "../lib/nostrSign.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventChatRepo } from "../db/repositories/eventChat.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { identitiesRepo } from "../db/repositories/identities.js";
import { getChatRelays } from "../db/repositories/appSettings.js";
import { recordAudit } from "../db/repositories/auditLogs.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;

/** 1人がこのイベントで使える発言鍵の数の上限 (#332)。
 *
 * 鍵は消えない（消すとその鍵で書いた発言が全員の画面から消える）ので、
 * 増える経路には必ず上限が要る。表示許可リストは全参加者が数秒ごとに取るため、
 * 1人が太らせるとイベント全体の負担になる。
 *
 * 増える経路は「サインインに使った鍵をアカウントに登録し直す」だけ
 * （一時鍵はイベント×ユーザーで1つ、他人の鍵と未連携の鍵は登録側で弾く）なので、
 * 普通に使っていて届く数ではない。端末や鍵を替えても十分に足りる値にしてある */
const MAX_CHAT_KEYS_PER_USER = 10;

/** Nostrイベントチャット (#199)。チャット本文はブラウザ⇔リレー直通で、
 * ここでは鍵の紐付け・チャンネルID・非表示リストのみ扱う。すべて要認証。
 *
 * 権限は2段階に分けてある:
 * - 読む・参加する: 参加確定メンバー（＋appAdmin / コミュニティ管理者）
 * - 部屋の開設・作り直し・メッセージの非表示: **そのイベントの staff メンバーだけ**
 *   （staffAndNotBlocked）。web も myRole === "staff" でしか操作UIを出さない (#275)
 *
 * どちらの段にも締め出し (#283) を通す。締め出された人はチャットから切り離された
 * 人なので、読む・書く・運営するのいずれもできない */
export const eventChatRoutes = new Hono<AppEnv>();
eventChatRoutes.use("*", requireAuth);

/** requireEventRole はロールのみ見るため、確定済み（status=confirmed）を追加チェック。
 * （メンバー行がない=appAdmin/コミュニティ管理者バイパスはそのまま許可。
 * eventQa.ts の同名ヘルパーと同じ判定）。
 * 読み出し・参加で使う（スタッフ操作は staffAndNotBlocked でさらに絞る） */
async function confirmedOnly(c: Context<AppEnv>): Promise<Response | null> {
  const member = await eventMembersRepo.find(
    c.req.param("id")!,
    c.get("user").id,
  );
  if (member && member.status !== "confirmed") {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** 締め出された発言者 (#283) をチャットから切り離す。
 *
 * **理由は返さない**。「あなたは締め出されました」と伝えると鍵を作り直して
 * 戻ってくるだけで意味がないため、画面には理由を書かない
 * （ただし「不調です」のような嘘も書かない。文言は EventChat.tsx を参照）。
 *
 * 効き方は2段構え。どちらも **このアプリの中で** 効くもので、リレーへの
 * 書き込みそのものを止めるわけではない:
 * - 他人の画面: 表示許可リスト (listMembers) から外れるので、これまでの発言が
 *   まとめて描画されなくなる（表示側のフィルタが本体）
 * - 本人の画面: この関数を通す経路（許可リスト・一時鍵）が 403 になるので、
 *   署名器が手に入らずリレーにも繋がらない ＝ **このアプリからは投稿できなくなる**。
 *   一時鍵を渡さないのは、これが無いと画面を再読み込みするだけで復帰するため
 *
 * 限界（承知のうえ）: リレーはこのサービスの外にあるので、外部の Nostr
 * クライアントからは引き続き投稿できる。ただしその発言は許可リストに載っていない
 * ので、このアプリの誰の画面にも出ない（それで目的は足りる、と確認済み）。
 * 別のアカウントで入り直されることも防げない（同じアカウントのまま鍵を
 * 登録し直しても、判定はこれまでに使った鍵で行うので外れない #332）。
 * **その場の荒らしを止めるための道具**であって、恒久的な追放ではない。 */
async function notBlocked(c: Context<AppEnv>): Promise<Response | null> {
  const blocked = await eventChatRepo.isUserBlocked(
    c.req.param("id")!,
    c.get("user").id,
  );
  return blocked ? c.json({ error: "chat_unavailable" }, 403) : null;
}

/** スタッフ操作（部屋の開設・作り直し・メッセージの非表示）の入口。
 * requireEventRole(["staff"]) の後ろに置き、運営管理者・コミュニティ管理者の
 * バイパスをここで閉じる（判定の中身は isConfirmedEventStaff を参照）。
 * Q&A (eventQa.ts) の eventStaffOnly と同じ形。
 *
 * **締め出し (#283) も必ずここで一緒に見る**。締め出された人は「このアプリの
 * チャットから切り離された人」なので、スタッフであってもチャットに関する操作は
 * 一切させない。特にチャンネルの作り直し（DELETE /chat-channel）は、締め出された
 * スタッフが部屋を作り直して**全員の履歴を画面から飛ばせて**しまう。 */
async function staffAndNotBlocked(
  c: Context<AppEnv>,
): Promise<Response | null> {
  if (!(await isConfirmedEventStaff(c.req.param("id")!, c.get("user").id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return notBlocked(c);
}

/** サーバー管理の一時鍵 (#223)。複数端末で同じ発言者鍵を使えるよう、
 * イベント用一時鍵はサーバーが生成・保管し、本人のセッションにだけ配布する。
 * GET: 既存の一時鍵を返す（NIP-07登録・未登録は 404） */
eventChatRoutes.get(
  "/:id/chat-key/ephemeral",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = (await confirmedOnly(c)) ?? (await notBlocked(c));
    if (denied) return denied;
    const key = await eventChatRepo.ephemeralFor(
      c.req.param("id"),
      c.get("user").id,
    );
    c.header("Cache-Control", "no-store");
    if (!key) return c.json({ error: "not_found" }, 404);
    return c.json(key);
  },
);

/** POST: 一時鍵を発行して発言鍵として登録する（既にあれば同じ鍵を返す）。
 * 本人の鍵を登録していても一時鍵は別に持てる（置き換えない #332）ので、
 * 一度発行したあとは何度呼んでも同じ鍵が返る */
eventChatRoutes.post(
  "/:id/chat-key/ephemeral",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = (await confirmedOnly(c)) ?? (await notBlocked(c));
    if (denied) return denied;
    const eventId = c.req.param("id");
    const userId = c.get("user").id;
    c.header("Cache-Control", "no-store");
    // 一時鍵は**イベント×ユーザーで1回だけ**発行する (#332)。入り直すたびに
    // 作ると、その人の鍵（＝表示許可リストの行）が際限なく増える。
    // 本人の鍵を登録してもこの鍵は保管されたままなので、ここで必ず見つかる
    const existing = await eventChatRepo.ephemeralFor(eventId, userId);
    if (existing) return c.json(existing);
    const { secret, pubkey } = generateChatKey();
    // 生成した鍵が既にこのイベントで使われていたら登録しない (#332)。
    // 乱数256bitなので現実には起きないが、衝突したまま登録すると
    // 「その鍵の過去の発言」が別人のものとして表示されてしまう
    const taken = await eventChatRepo.pubkeyOwner(eventId, pubkey);
    if (taken && taken !== userId) return c.json({ error: "pubkey_taken" }, 409);
    // 先勝ち: 同時発行のレースでは先着の鍵が残るので、確定値を読み直して返す。
    // 読み直して見つからないのは、その一瞬に他人が同じ鍵を押さえたときだけ
    await eventChatRepo.addEphemeral(eventId, userId, pubkey, secret);
    const settled = await eventChatRepo.ephemeralFor(eventId, userId);
    if (!settled) return c.json({ error: "pubkey_taken" }, 409);
    return c.json(settled);
  },
);

/** 発言用の公開鍵を登録（確定メンバーのみ）。
 * 前に使っていた鍵は消さずに**加える** (#332) */
eventChatRoutes.post(
  "/:id/chat-key",
  requireEventRole([...MEMBER_ROLES]),
  zValidator("json", registerChatPubkeyInput),
  async (c) => {
    // 締め出し (#283) はここでも見る。登録しても許可リストからは外れたままで
    // 実害は無いが、他の経路が 403 を返すのにここだけ 200 を返すのは筋が悪い
    const denied = (await confirmedOnly(c)) ?? (await notBlocked(c));
    if (denied) return denied;
    const eventId = c.req.param("id");
    const userId = c.get("user").id;
    const { proof } = valid<RegisterChatPubkeyInput>(c, "json");
    // 所有証明: このpubkeyの秘密鍵で署名できることを検証（他人の鍵を指定して
    // その鍵の発言を自分のものとして表示させるのを防ぐ）
    const pubkey = await verifyChatKeyProof(proof, eventId);
    if (!pubkey) return c.json({ error: "invalid_proof" }, 400);
    // 締め出し中の鍵での登録は受け付けない (#283)。
    // 重複チェック (pubkey_taken) より**先**に見る。逆順だと、締め出された人が
    // 他人の鍵を指定したときに「その鍵は使用中」だけが返り、鍵の使用状況という
    // 別の情報が先に漏れる。繋がらないことが分かった時点で話を終わらせる
    if (await eventChatRepo.isBlocked(eventId, pubkey)) {
      return c.json({ error: "chat_unavailable" }, 403);
    }
    // ここから先の検査は**行が増えるとき（＝この鍵がまだ自分のものでないとき）だけ**。
    // 既に自分の鍵として載っている鍵の登録し直しは、何も増やさないので素通しでよい。
    // 先に見ておかないと、この変更より前に登録した人（別の手段でサインインしていて
    // 鍵をアカウントに登録していない）が端末を変えたときに、
    // 自分の鍵なのに「登録されていません」と言われる
    const owner = await eventChatRepo.pubkeyOwner(eventId, pubkey);
    if (owner !== userId) {
      // **この鍵がログイン中のアカウントのものであること** (#332)。
      // 所有証明で分かるのは「この鍵の持ち主である」ことだけで、「このアカウントの
      // 人である」ことまでは言えない。別の手段でサインインした人が、アカウントとは
      // 何の関係も無い鍵を発言鍵にできてしまうと、
      // - その鍵の発言がこのアカウントの人の発言として表示される
      // - アカウントに紐付かない鍵をいくつでも登録できる（表示許可リストが太る）
      // アカウントに鍵が1つも登録されていない場合もここで止まる。発言できなくなる
      // わけではなく、イベント用の一時鍵で参加できる（そちらが既定の経路）。
      //
      // 鍵の使用状況 (pubkey_taken) より**先**に見る。逆順だと、鍵を他人と
      // 共有している人に「その鍵はこのイベントで使用中」という別の情報が漏れる
      const linkedTo = await identitiesRepo.findUserId("nostr", pubkey);
      if (linkedTo !== userId) return c.json({ error: "key_not_linked" }, 403);
      // 同一イベント内で他ユーザーが使っている鍵は拒否（過去に使っていた鍵も含む
      // #332。使わなくなった鍵を登録できると、その鍵の過去の発言が自分の名前で出る）
      if (owner) return c.json({ error: "pubkey_taken" }, 409);
      // 409 なのは、時間を置いても通らないため（429 だと再試行で通ると読める）
      if (
        (await eventChatRepo.countKeys(eventId, userId)) >=
        MAX_CHAT_KEYS_PER_USER
      ) {
        return c.json({ error: "too_many_keys" }, 409);
      }
    }
    await eventChatRepo.addPubkey(eventId, userId, pubkey);
    return c.json({ ok: true });
  },
);

/** 表示許可リスト＋チャンネルID＋非表示リスト（確定メンバーのみ） */
eventChatRoutes.get(
  "/:id/chat-members",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = (await confirmedOnly(c)) ?? (await notBlocked(c));
    if (denied) return denied;
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const payload: ChatMembersPayload = {
      members: await eventChatRepo.listMembers(eventId),
      channelId: await eventChatRepo.channelIdFor(eventId),
      chatEnabled: event.chatEnabled,
      hiddenNoteIds: await eventChatRepo.listHidden(eventId),
      relays: await getChatRelays(),
    };
    return c.json(payload);
  },
);

/** 公式サービス鍵で署名した kind:40（チャンネル作成）を発行する (#199)。
 * 主催者が NIP-07 で自ら署名するケース以外はこの鍵でチャンネルを作る
 * （参加者個人の鍵にチャンネルを紐付けない）。
 * 部屋を開設するかどうかはスタッフが決める (#221) ため、そのイベントの staff 限定。
 * ここでは登録しない: クライアントがリレーへの受理を確認してから
 * POST /:id/chat-channel で先勝ち登録する */
eventChatRoutes.post(
  "/:id/chat-channel/official",
  requireEventRole(["staff"]),
  async (c) => {
    const denied = await staffAndNotBlocked(c);
    if (denied) return denied;
    if (!serviceKeyConfigured()) {
      return c.json({ error: "service_key_unset" }, 503);
    }
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    // 公式鍵の署名オラクル化防止: チャット有効な公開イベントに限定 (#221)
    if (!event.chatEnabled || event.status !== "published") {
      return c.json({ error: "chat_disabled" }, 409);
    }
    const channelEvent = signWithServiceKey({
      kind: 40,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: event.title,
        about: CHAT_CHANNEL_ABOUT,
      }),
    });
    // 発行した id をイベントに控え、登録時に一致を要求する（別イベント向け・
    // 過去発行分の kind:40 持ち込み防止。再発行で上書き）
    await eventChatRepo.setPendingChannel(eventId, channelEvent.id);
    return c.json({ channelEvent });
  },
);

/** NIP-28 チャンネル（kind:40）の登録。先勝ちで1回だけ設定され、
 * 2件目以降は既存のチャンネルIDをそのまま返す。
 * 開設はそのイベントのスタッフの操作でのみ行う (#221) */
eventChatRoutes.post(
  "/:id/chat-channel",
  requireEventRole(["staff"]),
  zValidator("json", registerChatChannelInput),
  async (c) => {
    const denied = await staffAndNotBlocked(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const { channelEvent } = valid<RegisterChatChannelInput>(c, "json");
    // 先勝ち: 既に設定済みなら検証せず既存IDを返す（後着は無視）
    const existing = await eventChatRepo.channelIdFor(eventId);
    if (existing) return c.json({ channelId: existing });
    // 署名済みの kind:40 のみ（無関係な既存チャンネルの紐付け防止）
    if (!verifyEventSignature(channelEvent) || channelEvent.kind !== 40) {
      return c.json({ error: "invalid_channel_event" }, 400);
    }
    // 署名者は「公式サービス鍵」または「主催者(createdBy)が登録済みの鍵」のみ (#199)。
    // 参加者個人の鍵で作ったチャンネルは受け付けない（鍵の持ち主が消えると
    // チャンネルの管理者が不在になるため、公式鍵/主催者鍵に限定する）
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const isServiceSigned = channelEvent.pubkey === servicePubkey();
    if (isServiceSigned) {
      // 公式鍵署名は「このイベント向けに /official が発行した id」のみ受理 (#221)
      const pending = await eventChatRepo.pendingChannelFor(eventId);
      if (!pending || pending !== channelEvent.id) {
        return c.json({ error: "invalid_channel_event" }, 400);
      }
    } else {
      const bound = await eventChatRepo.pubkeyOwner(
        eventId,
        channelEvent.pubkey,
      );
      if (!bound || bound !== event.createdBy) {
        return c.json({ error: "invalid_channel_event" }, 400);
      }
    }
    const settled = await eventChatRepo.setChannelOnce(
      eventId,
      channelEvent.id,
    );
    return c.json({ channelId: settled });
  },
);

/** チャンネルIDをリセットする（そのイベントの staff のみ）。
 * NIP-70時代にリレーへ保存されなかった kind:40 を参照し続けるケース等の復旧用。
 * リセット後、次にチャットを開いたメンバーが新しいチャンネルを作成する */
eventChatRoutes.delete(
  "/:id/chat-channel",
  requireEventRole(["staff"]),
  async (c) => {
    const denied = await staffAndNotBlocked(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    await eventChatRepo.clearChannel(eventId);
    // 監査ログ (#248)。参加者から見ると履歴が消えたように見える操作なので記録する
    const me = c.get("user");
    await recordAudit({
      action: "chat_channel_reset",
      actor: { id: me.id, handle: me.username },
      detail: { eventId },
    });
    return c.json({ ok: true });
  },
);

/** メッセージをアプリ側で非表示にする（そのイベントの staff のみ） */
eventChatRoutes.post(
  "/:id/chat-hidden",
  requireEventRole(["staff"]),
  zValidator("json", hideChatNoteInput),
  async (c) => {
    const denied = await staffAndNotBlocked(c);
    if (denied) return denied;
    const { noteId } = valid<HideChatNoteInput>(c, "json");
    await eventChatRepo.hideNote(c.req.param("id"), noteId);
    return c.json({ ok: true });
  },
);

/** 非表示を解除する（そのイベントの staff のみ） */
eventChatRoutes.delete(
  "/:id/chat-hidden/:noteId",
  requireEventRole(["staff"]),
  async (c) => {
    const denied = await staffAndNotBlocked(c);
    if (denied) return denied;
    const noteId = c.req.param("noteId");
    if (!/^[0-9a-f]{64}$/.test(noteId)) {
      return c.json({ error: "invalid_note_id" }, 400);
    }
    await eventChatRepo.unhideNote(c.req.param("id"), noteId);
    return c.json({ ok: true });
  },
);
