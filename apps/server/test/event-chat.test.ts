import {
  SELF,
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { ChatMembersPayload, Event } from "@eventer/shared";

const BASE = "https://example.com";

/** 一般ユーザーを1人作る（セッション付き）。
 * admin=true なら discord_id を ADMIN_DISCORD_IDS(=dev-user) に一致させる */
async function makeUser(admin = false): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `c_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, admin ? "dev-user" : `nostr:${uid}`, username, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

/** イベント行を直接作る（既定は公開・開催中） */
async function insertEvent(
  ownerId: string,
  communityId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, community_id, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', ?, ?, ?)`,
  )
    .bind(id, `チャットE2E_${id.slice(0, 6)}`, now - 3600_000, now + 3600_000, ownerId, communityId, now)
    .run();
  return id;
}

/** コミュニティを作り、owner を1人つける */
async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, `c-${id.slice(0, 8)}`, `community_${id.slice(0, 4)}`, ownerId, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
  )
    .bind(crypto.randomUUID(), id, ownerId, Date.now())
    .run();
  return id;
}

/** メンバー行を直接作る */
async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" = "participant",
  status = "confirmed",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, status, Date.now())
    .run();
}


// ---- Nostr 署名ヘルパー（テスト用の本物の鍵と署名） ----
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

function makeNostrKey(): { sk: Uint8Array; pubkey: string } {
  const sk = schnorr.utils.randomSecretKey();
  return { sk, pubkey: bytesToHex(schnorr.getPublicKey(sk)) };
}

/** vitest.config.ts の bindings と同じ公式サービス鍵 (#199) */
const SERVICE_KEY_HEX =
  "7f3b2a1c9e8d7c6b5a4938271605f4e3d2c1b0a99887766554433221100ffeed";
const SERVICE_KEY = {
  sk: hexToBytes(SERVICE_KEY_HEX),
  pubkey: bytesToHex(schnorr.getPublicKey(hexToBytes(SERVICE_KEY_HEX))),
};

function signNostrEvent(
  sk: Uint8Array,
  pubkey: string,
  kind: number,
  tags: string[][],
  content = "",
  createdAt = Math.floor(Date.now() / 1000),
) {
  const serialized = JSON.stringify([0, pubkey, createdAt, kind, tags, content]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { id, pubkey, sig, kind, created_at: createdAt, tags, content };
}

async function chatKeyProof(eventId: string, key = makeNostrKey()) {
  const res = await SELF.fetch(`${BASE}/api/auth/nostr/challenge`);
  const { challenge } = (await res.json()) as { challenge: string };
  const proof = signNostrEvent(key.sk, key.pubkey, 27888, [
    ["purpose", "eventer-chat-key"],
    ["eventer-event", eventId],
    ["challenge", challenge],
  ]);
  return { key, proof };
}

/** 64桁hexのダミー（Nostrの pubkey / note id 相当） */
function hex64(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

async function postJson(
  path: string,
  cookie: string,
  body: unknown,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function getChatMembers(
  eventId: string,
  cookie: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/chat-members`, {
    headers: { cookie },
  });
}

describe("Nostrイベントチャットの紐付け (#199)", () => {
  it("chat-key: 所有証明つきで登録・置換でき、不正な証明や他人の鍵は拒否", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // 正しい所有証明つき → 登録できる
    const p1 = await chatKeyProof(eventId);
    const r1 = await postJson(`/events/${eventId}/chat-key`, a.cookie, {
      proof: p1.proof,
    });
    expect(r1.status).toBe(200);

    // 署名の無い/壊れた証明 → 400
    const broken = { ...p1.proof, sig: p1.proof.sig.replace(/^../, "00") };
    const rBad = await postJson(`/events/${eventId}/chat-key`, a.cookie, {
      proof: broken,
    });
    expect(rBad.status).toBe(400);

    // 別イベントIDに向けた証明 → 400（イベント間の流用防止）
    const pWrong = await chatKeyProof("00000000-0000-0000-0000-000000000000");
    const rWrong = await postJson(`/events/${eventId}/chat-key`, a.cookie, {
      proof: pWrong.proof,
    });
    expect(rWrong.status).toBe(400);

    // challenge の使い回し → 400（単回使用）
    const rReplay = await postJson(`/events/${eventId}/chat-key`, b.cookie, {
      proof: p1.proof,
    });
    expect(rReplay.status).toBe(400);

    // 他ユーザーが登録済みの鍵と同じ pubkey → 409（なりすまし表示防止）
    const pSame = await chatKeyProof(eventId, p1.key);
    const rTaken = await postJson(`/events/${eventId}/chat-key`, b.cookie, {
      proof: pSame.proof,
    });
    expect(rTaken.status).toBe(409);

    // 本人による別鍵への再登録 → 発言に使う鍵は置き換わるが、
    // 前の鍵も表示許可リストに残る（過去の自分の発言が消えないように #332）
    const p2 = await chatKeyProof(eventId);
    const r2 = await postJson(`/events/${eventId}/chat-key`, a.cookie, {
      proof: p2.proof,
    });
    expect(r2.status).toBe(200);
    const res = await getChatMembers(eventId, a.cookie);
    const members = ((await res.json()) as { members: { userId: string; pubkey: string }[] })
      .members;
    const mine = members.filter((m) => m.userId === a.userId);
    expect(mine.map((m) => m.pubkey).sort()).toEqual(
      [p1.key.pubkey, p2.key.pubkey].sort(),
    );
  });

  /** #332: スマホなど拡張機能が使えない端末で入り直すと、以前に拡張機能で
   * 署名して書いた自分の発言が画面から消えていた。表示は許可リストで絞られていて、
   * 鍵を登録し直すと前の鍵が許可リストから消えていたため。
   * 同じアカウントである限り、署名の手段が変わっても過去の鍵は残り続ける */
  it("chat-key: 署名の手段を変えても過去の自分の鍵が表示許可リストに残る (#332)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // 拡張機能がある端末で自分の鍵を登録して発言していた状態
    const p1 = await chatKeyProof(eventId);
    expect(
      (await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: p1.proof }))
        .status,
    ).toBe(200);

    // 拡張機能が使えない端末で入り直す（＝一時鍵での参加）
    const r = await postJson(`/events/${eventId}/chat-key/ephemeral`, a.cookie, {});
    expect(r.status).toBe(200);
    const ephemeral = (await r.json()) as { secret: string; pubkey: string };

    // 許可リストには両方の鍵が載る（過去の発言も、これからの発言も描画される）
    const members = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    const mine = members.members.filter((m) => m.userId === a.userId);
    expect(mine.map((m) => m.pubkey).sort()).toEqual(
      [p1.key.pubkey, ephemeral.pubkey].sort(),
    );
    // 他人の鍵が自分のものとして載ることはない
    expect(members.members.some((m) => m.userId === b.userId)).toBe(false);

    // 手放した鍵は他人が登録できない（その鍵の過去の発言を横取りさせない）
    const stolen = await chatKeyProof(eventId, p1.key);
    expect(
      (await postJson(`/events/${eventId}/chat-key`, b.cookie, { proof: stolen.proof }))
        .status,
    ).toBe(409);
    // 一時鍵のほうも同じ（サーバー発行の鍵でも所有者は変わらない）
    const p3 = await chatKeyProof(eventId);
    expect(
      (await postJson(`/events/${eventId}/chat-key`, b.cookie, { proof: p3.proof }))
        .status,
    ).toBe(200);
    const after = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(
      after.members.find((m) => m.pubkey === p1.key.pubkey)?.userId,
    ).toBe(a.userId);
    expect(
      after.members.find((m) => m.pubkey === p3.key.pubkey)?.userId,
    ).toBe(b.userId);
  });

  it("chat-key/ephemeral: サーバーが一時鍵を発行・保管し、同じ鍵を配布する (#223)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);

    // 発行前の GET は 404
    const before = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-key/ephemeral`,
      { headers: { cookie: a.cookie } },
    );
    expect(before.status).toBe(404);

    // POST で発行される（secret は 64hex、pubkey は secret から導出）
    const r1 = await postJson(`/events/${eventId}/chat-key/ephemeral`, a.cookie, {});
    expect(r1.status).toBe(200);
    const k1 = (await r1.json()) as { secret: string; pubkey: string };
    expect(k1.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(bytesToHex(schnorr.getPublicKey(hexToBytes(k1.secret)))).toBe(
      k1.pubkey,
    );

    // 再POST・GET は同じ鍵を返す（複数端末で同一の発言者鍵）
    const r2 = await postJson(`/events/${eventId}/chat-key/ephemeral`, a.cookie, {});
    expect((await r2.json()) as object).toEqual(k1);
    const g = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-key/ephemeral`,
      { headers: { cookie: a.cookie } },
    );
    expect(g.status).toBe(200);
    expect((await g.json()) as object).toEqual(k1);

    // 表示許可リストに pubkey が載り、secret は含まれない
    const members = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    const mine = members.members.find((m) => m.userId === a.userId)!;
    expect(mine.pubkey).toBe(k1.pubkey);
    expect(mine.role).toBe("participant"); // 色分け表示用のロール (#228)

    // staff のロールも返る（バッジ表示の根拠 #228）
    await addMember(eventId, owner.userId, "staff");
    const rOwner = await postJson(
      `/events/${eventId}/chat-key/ephemeral`,
      owner.cookie,
      {},
    );
    expect(rOwner.status).toBe(200);
    const withStaff = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(
      withStaff.members.find((m) => m.userId === owner.userId)?.role,
    ).toBe("staff");
    expect(JSON.stringify(members)).not.toContain(k1.secret);

    // NIP-07（所有証明つき登録）に切り替えると一時鍵は消える
    const p = await chatKeyProof(eventId);
    await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: p.proof });
    const afterNip07 = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-key/ephemeral`,
      { headers: { cookie: a.cookie } },
    );
    expect(afterNip07.status).toBe(404);

    // 一時鍵に戻すと新しい鍵で置き換わる
    const r3 = await postJson(`/events/${eventId}/chat-key/ephemeral`, a.cookie, {});
    const k3 = (await r3.json()) as { secret: string; pubkey: string };
    expect(k3.secret).not.toBe(k1.secret);

    // 他の確定メンバーが GET しても A の鍵は返らない（自分の鍵のみ）
    const b = await makeUser();
    await addMember(eventId, b.userId);
    const other = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-key/ephemeral`,
      { headers: { cookie: b.cookie } },
    );
    expect(other.status).toBe(404);
  });

  it("chat-key/ephemeral: 非メンバー・未確定メンバーは403", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const waitlisted = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, waitlisted.userId, "participant", "waitlist");

    expect(
      (
        await postJson(
          `/events/${eventId}/chat-key/ephemeral`,
          outsider.cookie,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await postJson(
          `/events/${eventId}/chat-key/ephemeral`,
          waitlisted.cookie,
          {},
        )
      ).status,
    ).toBe(403);
  });

  it("chat-key / chat-members: 非メンバー・未確定メンバーは403", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const waitlisted = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, waitlisted.userId, "participant", "waitlist");

    const pOut = await chatKeyProof(eventId);
    const r1 = await postJson(`/events/${eventId}/chat-key`, outsider.cookie, {
      proof: pOut.proof,
    });
    expect(r1.status).toBe(403);
    expect((await getChatMembers(eventId, outsider.cookie)).status).toBe(403);

    // メンバー行はあるが未確定（waitlist）も403
    const pWait = await chatKeyProof(eventId);
    const r2 = await postJson(
      `/events/${eventId}/chat-key`,
      waitlisted.cookie,
      { proof: pWait.proof },
    );
    expect(r2.status).toBe(403);
    expect((await getChatMembers(eventId, waitlisted.cookie)).status).toBe(403);
  });

  it("chat-channel: 主催者の登録鍵か公式鍵で署名した kind:40 のみ受理・先勝ち", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const staff2 = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    await addMember(eventId, a.userId);
    await addMember(eventId, staff2.userId, "staff");

    // owner/a がそれぞれ鍵を登録
    const po = await chatKeyProof(eventId);
    await postJson(`/events/${eventId}/chat-key`, owner.cookie, { proof: po.proof });
    const pa = await chatKeyProof(eventId);
    await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: pa.proof });

    // 参加者の登録鍵で署名した kind:40 → 400（staff が持ち込んでも、
    // 参加者個人の鍵にチャンネルを紐付けない #199）
    const evParticipant = signNostrEvent(pa.key.sk, pa.key.pubkey, 40, [["-"]], "{}");
    const rParticipant = await postJson(`/events/${eventId}/chat-channel`, owner.cookie, {
      channelEvent: evParticipant,
    });
    expect(rParticipant.status).toBe(400);

    // 未登録鍵で署名した kind:40 → 400（無関係チャンネルの紐付け防止）
    const stranger = makeNostrKey();
    const evStranger = signNostrEvent(stranger.sk, stranger.pubkey, 40, [["-"]], "{}");
    const rBad = await postJson(`/events/${eventId}/chat-channel`, owner.cookie, {
      channelEvent: evStranger,
    });
    expect(rBad.status).toBe(400);

    // kind違い（主催者の鍵でも）→ 400
    const evWrongKind = signNostrEvent(po.key.sk, po.key.pubkey, 42, [["-"]], "x");
    expect(
      (
        await postJson(`/events/${eventId}/chat-channel`, owner.cookie, {
          channelEvent: evWrongKind,
        })
      ).status,
    ).toBe(400);

    // 主催者(createdBy)の登録鍵（NIP-07相当）で署名した kind:40 → 受理
    const ev1 = signNostrEvent(po.key.sk, po.key.pubkey, 40, [["-"]], "{}");
    const r1 = await postJson(`/events/${eventId}/chat-channel`, owner.cookie, {
      channelEvent: ev1,
    });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { channelId: string }).channelId).toBe(ev1.id);

    // 後着（別の staff が公式鍵署名の kind:40 を持ってきても）は無視され、既存IDが返る
    const evOfficial = signNostrEvent(SERVICE_KEY.sk, SERVICE_KEY.pubkey, 40, [], "{}");
    const r2 = await postJson(`/events/${eventId}/chat-channel`, staff2.cookie, {
      channelEvent: evOfficial,
    });
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { channelId: string }).channelId).toBe(ev1.id);
  });

  it("chat-channel: 開設は staff のみ (#221)。公式鍵署名でも参加者からは403", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const staff2 = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, staff2.userId, "staff");

    // /official で発行（pending としてイベントに束縛される）
    const issued = await postJson(
      `/events/${eventId}/chat-channel/official`,
      staff2.cookie,
      {},
    );
    expect(issued.status).toBe(200);
    const { channelEvent } = (await issued.json()) as {
      channelEvent: { id: string };
    };

    // 参加者は公式鍵署名のイベントを持っていても登録できない
    const rParticipant = await postJson(`/events/${eventId}/chat-channel`, a.cookie, {
      channelEvent,
    });
    expect(rParticipant.status).toBe(403);

    // staff（主催者本人でなくてもよい）からは受理
    const r = await postJson(`/events/${eventId}/chat-channel`, staff2.cookie, {
      channelEvent,
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { channelId: string }).channelId).toBe(
      channelEvent.id,
    );
  });

  it("chat-channel: 公式鍵署名でも /official 未発行・別イベント向けの kind:40 は登録できない (#221)", async () => {
    const ownerA = await makeUser();
    const ownerB = await makeUser();
    const eventA = await insertEvent(ownerA.userId);
    const eventB = await insertEvent(ownerB.userId);
    await addMember(eventA, ownerA.userId, "staff");
    await addMember(eventB, ownerB.userId, "staff");

    // /official を通さず自前で公式鍵署名した kind:40 → 400（pending 不一致）
    const forged = signNostrEvent(SERVICE_KEY.sk, SERVICE_KEY.pubkey, 40, [], "{}");
    expect(
      (
        await postJson(`/events/${eventA}/chat-channel`, ownerA.cookie, {
          channelEvent: forged,
        })
      ).status,
    ).toBe(400);

    // イベントA向けに発行した kind:40 をイベントBに持ち込む → 400
    const issuedA = await postJson(
      `/events/${eventA}/chat-channel/official`,
      ownerA.cookie,
      {},
    );
    const { channelEvent: evA } = (await issuedA.json()) as {
      channelEvent: { id: string };
    };
    expect(
      (
        await postJson(`/events/${eventB}/chat-channel`, ownerB.cookie, {
          channelEvent: evA,
        })
      ).status,
    ).toBe(400);

    // 本来のイベントAには登録できる
    const rA = await postJson(`/events/${eventA}/chat-channel`, ownerA.cookie, {
      channelEvent: evA,
    });
    expect(rA.status).toBe(200);
    expect(((await rA.json()) as { channelId: string }).channelId).toBe(evA.id);
  });

  it("official: チャット無効イベントでは発行できない (#221)", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");

    // staff がチャットをオフにすると /official は 409
    await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ chatEnabled: false }),
    });
    const res = await postJson(
      `/events/${eventId}/chat-channel/official`,
      owner.cookie,
      {},
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "chat_disabled",
    );
  });

  it("chat-hidden: staff のみ追加/解除でき、chat-members に反映される", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, a.userId);

    // 一般参加者は403
    const forbidden = await postJson(
      `/events/${eventId}/chat-hidden`,
      a.cookie,
      { noteId: hex64("d") },
    );
    expect(forbidden.status).toBe(403);

    // staff は非表示にできる（冪等）
    for (let i = 0; i < 2; i++) {
      const r = await postJson(`/events/${eventId}/chat-hidden`, staff.cookie, {
        noteId: hex64("d"),
      });
      expect(r.status).toBe(200);
    }
    let payload = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(payload.hiddenNoteIds).toEqual([hex64("d")]);

    // 解除は staff のみ。一般参加者は403
    const delForbidden = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-hidden/${hex64("d")}`,
      { method: "DELETE", headers: { cookie: a.cookie } },
    );
    expect(delForbidden.status).toBe(403);
    const del = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-hidden/${hex64("d")}`,
      { method: "DELETE", headers: { cookie: staff.cookie } },
    );
    expect(del.status).toBe(200);
    payload = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(payload.hiddenNoteIds).toEqual([]);

    // 不正な note id は400
    const badDel = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-hidden/xyz`,
      { method: "DELETE", headers: { cookie: staff.cookie } },
    );
    expect(badDel.status).toBe(400);
  });

  it("chatEnabled: 新規作成イベントは既定オフ (#221)", async () => {
    const owner = await makeUser();
    const res = await postJson(`/events`, owner.cookie, {
      title: "チャット既定オフE2E",
      venueType: "offline",
      scheduling: true,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { event: Event }).event.chatEnabled).toBe(
      false,
    );
  });

  it("chatEnabled: 既存イベントは既定オンのまま、イベント更新（PATCH）でオンオフできる", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    await addMember(eventId, a.userId);

    // 既定はオン（イベント取得にも含まれる）
    const before = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      headers: { cookie: a.cookie },
    });
    expect(before.status).toBe(200);
    expect(((await before.json()) as { event: Event }).event.chatEnabled).toBe(
      true,
    );

    // staff がオフにできる
    const patch = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ chatEnabled: false }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { event: Event }).event.chatEnabled).toBe(
      false,
    );

    // chat-members にも反映される
    const payload = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(payload.chatEnabled).toBe(false);

    // 再度オンに戻せる
    const patch2 = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ chatEnabled: true }),
    });
    expect(((await patch2.json()) as { event: Event }).event.chatEnabled).toBe(
      true,
    );
  });

  it("chatUrlsAllowed: 既定はオフ、イベント更新（PATCH）でオンオフできる (#241)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    await addMember(eventId, a.userId);

    // 既定はオフ（イベント取得に含まれる）
    const before = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      headers: { cookie: a.cookie },
    });
    expect(before.status).toBe(200);
    expect(
      ((await before.json()) as { event: Event }).event.chatUrlsAllowed,
    ).toBe(false);

    // staff がオンにできる
    const patch = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ chatUrlsAllowed: true }),
    });
    expect(patch.status).toBe(200);
    expect(
      ((await patch.json()) as { event: Event }).event.chatUrlsAllowed,
    ).toBe(true);

    // 再度オフに戻せる
    const patch2 = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ chatUrlsAllowed: false }),
    });
    expect(
      ((await patch2.json()) as { event: Event }).event.chatUrlsAllowed,
    ).toBe(false);
  });

  it("chatUrlsAllowed: イベントの複製で引き継がれる (#241)", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");

    // 元イベントをオンにしてから複製する
    const patch = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ chatUrlsAllowed: true }),
    });
    expect(patch.status).toBe(200);

    const dup = await SELF.fetch(`${BASE}/api/events/${eventId}/duplicate`, {
      method: "POST",
      headers: { cookie: owner.cookie },
    });
    expect(dup.status).toBe(201);
    expect(
      ((await dup.json()) as { event: Event }).event.chatUrlsAllowed,
    ).toBe(true);
  });
});

describe("公式チャンネル署名 (#199)", () => {
  interface SignedNostrEvent {
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }

  it("official: 公式鍵で署名済みの kind:40 を返す（この時点では登録しない）", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    // 開設は staff のみ (#221)
    await addMember(eventId, a.userId, "staff");

    const res = await postJson(
      `/events/${eventId}/chat-channel/official`,
      a.cookie,
      {},
    );
    expect(res.status).toBe(200);
    const { channelEvent } = (await res.json()) as {
      channelEvent: SignedNostrEvent;
    };

    // kind:40・タグ無し・公式鍵の pubkey
    expect(channelEvent.kind).toBe(40);
    expect(channelEvent.tags).toEqual([]);
    expect(channelEvent.pubkey).toBe(SERVICE_KEY.pubkey);

    // content は {name: イベントタイトル, about: 固定文言}
    const content = JSON.parse(channelEvent.content) as {
      name: string;
      about: string;
    };
    expect(content.name).toBe(`チャットE2E_${eventId.slice(0, 6)}`);
    expect(content.about).toBe("events lab のイベントチャット");

    // NIP-01 の id とschnorr署名が正しい
    const serialized = JSON.stringify([
      0,
      channelEvent.pubkey,
      channelEvent.created_at,
      channelEvent.kind,
      channelEvent.tags,
      channelEvent.content,
    ]);
    expect(
      bytesToHex(sha256(new TextEncoder().encode(serialized))),
    ).toBe(channelEvent.id);
    expect(
      schnorr.verify(
        hexToBytes(channelEvent.sig),
        hexToBytes(channelEvent.id),
        hexToBytes(channelEvent.pubkey),
      ),
    ).toBe(true);

    // この時点では未登録（クライアントがリレー発行後に /chat-channel で登録する）
    const members = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(members.channelId).toBeNull();

    // 返ってきたイベントをそのまま登録できる
    const reg = await postJson(`/events/${eventId}/chat-channel`, a.cookie, {
      channelEvent,
    });
    expect(reg.status).toBe(200);
    expect(((await reg.json()) as { channelId: string }).channelId).toBe(
      channelEvent.id,
    );
  });

  it("official: 非メンバー・未確定メンバー・参加者は403", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const waitlisted = await makeUser();
    const participant = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, waitlisted.userId, "participant", "waitlist");
    await addMember(eventId, participant.userId);

    // 確定済み参加者でも開設は staff のみ (#221)
    expect(
      (
        await postJson(
          `/events/${eventId}/chat-channel/official`,
          participant.cookie,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await postJson(
          `/events/${eventId}/chat-channel/official`,
          outsider.cookie,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await postJson(
          `/events/${eventId}/chat-channel/official`,
          waitlisted.cookie,
          {},
        )
      ).status,
    ).toBe(403);
  });

  it("official: NOSTR_SERVICE_KEY 未設定なら 503 (service_key_unset)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId, "staff");

    // SELF のバインディングは変えられないため、worker.fetch を鍵なしの env で直接呼ぶ
    const { default: worker } = await import("../src/worker.js");
    const keyless = {
      ...(env as Record<string, unknown>),
      NOSTR_SERVICE_KEY: undefined,
    };
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${BASE}/api/events/${eventId}/chat-channel/official`, {
        method: "POST",
        headers: { cookie: a.cookie },
      }),
      keyless as never,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(
      "service_key_unset",
    );
  });

  it("chat-channel: NOSTR_SERVICE_KEY 未設定環境では公式鍵署名でも素通りせず 400", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");

    // servicePubkey() が null の環境で、鍵署名の kind:40 が「公式扱い」で
    // 受理されないこと（null との比較が偽になる境界の回帰テスト）
    const ev = signNostrEvent(SERVICE_KEY.sk, SERVICE_KEY.pubkey, 40, [], "{}");
    const { default: worker } = await import("../src/worker.js");
    const keyless = {
      ...(env as Record<string, unknown>),
      NOSTR_SERVICE_KEY: undefined,
    };
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${BASE}/api/events/${eventId}/chat-channel`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({ channelEvent: ev }),
      }),
      keyless as never,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "invalid_channel_event",
    );
  });
});

describe("チャンネルのリセット (#199)", () => {
  it("staff はチャンネルをクリアでき、参加者は403", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    const member = await makeUser();
    await addMember(eventId, member.userId);

    // 鍵登録→チャンネル登録
    const po = await chatKeyProof(eventId);
    await postJson(`/events/${eventId}/chat-key`, owner.cookie, { proof: po.proof });
    const ev40 = signNostrEvent(po.key.sk, po.key.pubkey, 40, [], "{}");
    await postJson(`/events/${eventId}/chat-channel`, owner.cookie, { channelEvent: ev40 });

    // 参加者のリセットは403
    const forbidden = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-channel`,
      { method: "DELETE", headers: { cookie: member.cookie } },
    );
    expect(forbidden.status).toBe(403);

    // staff はリセットでき、chat-members の channelId が null に戻る
    const ok = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-channel`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
    );
    expect(ok.status).toBe(200);
    const res = await getChatMembers(eventId, owner.cookie);
    expect(((await res.json()) as { channelId: string | null }).channelId).toBeNull();
  });
});

describe("チャットのスタッフ操作はイベントの staff のみ (#275)", () => {
  /** 非表示リストと登録済みチャンネルIDを読む（副作用の有無の確認用） */
  async function chatState(
    eventId: string,
    cookie: string,
  ): Promise<ChatMembersPayload> {
    const res = await getChatMembers(eventId, cookie);
    expect(res.status).toBe(200);
    return (await res.json()) as ChatMembersPayload;
  }

  function del(path: string, cookie: string): Promise<Response> {
    return SELF.fetch(`${BASE}/api${path}`, {
      method: "DELETE",
      headers: { cookie },
    });
  }

  it("コミュニティのオーナーもサイト管理者も、そのイベントの staff でなければ403", async () => {
    const owner = await makeUser();
    const admin = await makeUser(true);
    const communityId = await makeCommunity(owner.userId);
    const staff = await makeUser();
    const eventId = await insertEvent(staff.userId, communityId);
    await addMember(eventId, staff.userId, "staff");

    // 部屋の開設（公式鍵の署名発行）
    expect(
      (await postJson(`/events/${eventId}/chat-channel/official`, owner.cookie, {})).status,
    ).toBe(403);
    expect(
      (await postJson(`/events/${eventId}/chat-channel/official`, admin.cookie, {})).status,
    ).toBe(403);

    // staff が発行した kind:40 を横から登録することもできない
    const issued = await postJson(
      `/events/${eventId}/chat-channel/official`,
      staff.cookie,
      {},
    );
    expect(issued.status).toBe(200);
    const { channelEvent } = (await issued.json()) as {
      channelEvent: { id: string };
    };
    for (const cookie of [owner.cookie, admin.cookie]) {
      expect(
        (await postJson(`/events/${eventId}/chat-channel`, cookie, { channelEvent }))
          .status,
      ).toBe(403);
    }
    // 403 が素通りしていない（部屋は未開設のまま）
    expect((await chatState(eventId, staff.cookie)).channelId).toBeNull();

    // staff は開設できる
    const opened = await postJson(`/events/${eventId}/chat-channel`, staff.cookie, {
      channelEvent,
    });
    expect(opened.status).toBe(200);
    expect((await chatState(eventId, staff.cookie)).channelId).toBe(channelEvent.id);

    // チャンネルの作り直し（リセット）
    for (const cookie of [owner.cookie, admin.cookie]) {
      expect((await del(`/events/${eventId}/chat-channel`, cookie)).status).toBe(403);
    }
    expect((await chatState(eventId, staff.cookie)).channelId).toBe(channelEvent.id);

    // メッセージの非表示
    for (const cookie of [owner.cookie, admin.cookie]) {
      expect(
        (await postJson(`/events/${eventId}/chat-hidden`, cookie, { noteId: hex64("a") }))
          .status,
      ).toBe(403);
    }
    expect((await chatState(eventId, staff.cookie)).hiddenNoteIds).toEqual([]);

    // 非表示の解除（staff が非表示にしたものを外せない）
    expect(
      (await postJson(`/events/${eventId}/chat-hidden`, staff.cookie, { noteId: hex64("a") }))
        .status,
    ).toBe(200);
    for (const cookie of [owner.cookie, admin.cookie]) {
      expect(
        (await del(`/events/${eventId}/chat-hidden/${hex64("a")}`, cookie)).status,
      ).toBe(403);
    }
    expect((await chatState(eventId, staff.cookie)).hiddenNoteIds).toEqual([hex64("a")]);

    // イベントの staff に加われば操作できる
    await addMember(eventId, owner.userId, "staff");
    expect(
      (await del(`/events/${eventId}/chat-hidden/${hex64("a")}`, owner.cookie)).status,
    ).toBe(200);
    expect((await chatState(eventId, owner.cookie)).hiddenNoteIds).toEqual([]);
    expect((await del(`/events/${eventId}/chat-channel`, owner.cookie)).status).toBe(200);
    expect((await chatState(eventId, owner.cookie)).channelId).toBeNull();
  });

  it("参加が確定していない staff もスタッフ操作は403", async () => {
    const owner = await makeUser();
    const onHold = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    await addMember(eventId, onHold.userId, "staff", "waitlist");

    expect(
      (await postJson(`/events/${eventId}/chat-channel/official`, onHold.cookie, {})).status,
    ).toBe(403);
    expect(
      (await postJson(`/events/${eventId}/chat-hidden`, onHold.cookie, { noteId: hex64("b") }))
        .status,
    ).toBe(403);
    expect(
      (await del(`/events/${eventId}/chat-hidden/${hex64("b")}`, onHold.cookie)).status,
    ).toBe(403);
    expect((await del(`/events/${eventId}/chat-channel`, onHold.cookie)).status).toBe(403);

    // 何も起きていない（確定 staff から見ても非表示リストは空）
    expect((await chatState(eventId, owner.cookie)).hiddenNoteIds).toEqual([]);
  });
});
