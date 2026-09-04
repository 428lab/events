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
import { isConfirmedEventStaff, requireEventRole } from "../auth/roles.js";
import {
  verifyChatKeyProof,
  verifyEventSignature,
} from "../auth/nostr.js";
import type { NostrEvent } from "../auth/nostr.js";
import {
  generateChatKey,
  serviceKeyConfigured,
  servicePubkey,
  signWithServiceKey,
} from "../lib/nostrSign.js";
import { nostrRelay } from "../lib/nostrRelay.js";
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
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

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

/** チャンネル登録の一本化 (#460)。主催者 NIP-07 経路（HTTP 登録）も
 * 公式鍵経路（サーバー発行）も、必ずこの関数を通って DB に登録される。
 *
 * 検証は「kind:40・署名正当・NIP-70 の `["-"]` タグ必須・著者 pubkey が
 * 許可リスト内」。許可する著者は**呼び出し側が計算して渡す**
 * （HTTP 登録は主催者の登録済み鍵だけ、サーバー発行は公式鍵だけ）。
 * `["-"]` 無しの kind:40 は新規登録では 400（既に DB 登録済みの
 * チャンネルには影響しない）。決着は従来どおり setChannelOnce の先勝ち */
async function registerVerifiedChannel(
  c: Context<AppEnv>,
  eventId: string,
  channelEvent: NostrEvent,
  allowedAuthors: readonly string[],
): Promise<Response> {
  if (
    channelEvent.kind !== 40 ||
    !verifyEventSignature(channelEvent) ||
    !channelEvent.tags.some((t) => t.length === 1 && t[0] === "-") ||
    !allowedAuthors.includes(channelEvent.pubkey)
  ) {
    return c.json({ error: "invalid_channel_event" }, 400);
  }
  const settled = await eventChatRepo.setChannelOnce(eventId, channelEvent.id);
  return c.json({ channelId: settled });
}

/** 公式サービス鍵でチャンネル（kind:40）を開設する (#460)。
 * 主催者が NIP-07 で自ら署名するケース以外はこの鍵でチャンネルを作る
 * （参加者個人の鍵にチャンネルを紐付けない）。
 * 部屋を開設するかどうかはスタッフが決める (#221) ため、そのイベントの staff 限定。
 *
 * NIP-70 の「AUTH 済み pubkey ＝ イベントの pubkey」を満たすため、署名も
 * リレーへの発行もサーバー（Workers）が行い、1台以上の OK を確認してから
 * 同一リクエスト内で登録する。発行と登録が閉じたので、旧 /official 時代の
 * pending 機構（発行済み id の控え #221）は不要になった */
eventChatRoutes.post(
  "/:id/chat-channel/create",
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
    // 既存チャンネルがあれば発行せず既存を返す（先勝ち）
    const existing = await eventChatRepo.channelIdFor(eventId);
    if (existing) return c.json({ channelId: existing });
    const channelEvent = signWithServiceKey({
      kind: 40,
      created_at: Math.floor(Date.now() / 1000),
      // NIP-70 (#460): 著者本人の AUTH 済み接続以外からの持ち込みを
      // 対応リレーが拒否する
      tags: [["-"]],
      content: JSON.stringify({
        name: event.title,
        about: CHAT_CHANNEL_ABOUT,
      }),
    });
    // 接続先は管理者設定由来の getChatRelays() のみ（SSRF 防止。lib/nostrRelay.ts）
    const report = await nostrRelay.publishToRelays(
      await getChatRelays(),
      channelEvent,
      signWithServiceKey,
    );
    if (!report.ok) {
      // 全滅。詳細は staff 向けのデバッグ情報として返す（リレー URL は
      // chat-members で参加者にも配っている公開値）
      console.error(
        `chat-channel create failed (event=${eventId}):`,
        JSON.stringify(report.relays),
      );
      return c.json(
        { error: "relay_publish_failed", relays: report.relays },
        502,
      );
    }
    // 一部失敗はログに残すだけで、成功応答には含めない
    const failed = report.relays.filter((r) => r.outcome !== "ok");
    if (failed.length > 0) {
      console.warn(
        `chat-channel create partial (event=${eventId}):`,
        JSON.stringify(failed),
      );
    }
    // servicePubkey() は serviceKeyConfigured() 確認済みなので非 null
    return registerVerifiedChannel(c, eventId, channelEvent, [
      servicePubkey()!,
    ]);
  },
);

/** NIP-28 チャンネル（kind:40）の登録（主催者 NIP-07 経路）。先勝ちで1回だけ
 * 設定され、2件目以降は既存のチャンネルIDをそのまま返す。
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
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    // HTTP 登録で受け付ける著者は「主催者(createdBy)の登録済み鍵」のみ (#199)。
    // 参加者個人の鍵で作ったチャンネルは受け付けない（鍵の持ち主が消えると
    // チャンネルの管理者が不在になるため）。
    // 公式鍵署名の body も**受け付けない** (#460)。公式鍵の kind:40 はサーバーが
    // リレーへ発行するので第三者も読めるが、それを登録 body に流用される穴
    // （#221 が pending で塞いでいたもの）を、許可リストから外すことで塞ぐ
    if (servicePubkey() === channelEvent.pubkey) {
      return c.json({ error: "invalid_channel_event" }, 400);
    }
    const bound = await eventChatRepo.pubkeyOwner(eventId, channelEvent.pubkey);
    const allowedAuthors =
      bound && bound === event.createdBy ? [channelEvent.pubkey] : [];
    return registerVerifiedChannel(c, eventId, channelEvent, allowedAuthors);
  },
);

/** チャンネルIDをリセットする（そのイベントの staff のみ）。
 * リレー側でチャンネル（kind:40）が失われた・部屋を作り直したい、といった
 * 復旧用（どちらの開設経路もリレーの受理を確認してから登録するため、
 * 「リレーに保存されなかった id を参照し続ける」旧来の主因は消えている）。
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
