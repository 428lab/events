import {
  SELF,
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { ChatMembersPayload, Event } from "@eventer/shared";

const BASE = "https://example.com";

/** 一般ユーザーを1人作る（セッション付き） */
async function makeUser(): Promise<{
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
    .bind(uid, `nostr:${uid}`, username, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

/** イベント行を直接作る（既定は公開・開催中） */
async function insertEvent(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', ?, ?)`,
  )
    .bind(id, `チャットE2E_${id.slice(0, 6)}`, now - 3600_000, now + 3600_000, ownerId, now)
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

    // 本人による別鍵への再登録 → 置き換え
    const p2 = await chatKeyProof(eventId);
    const r2 = await postJson(`/events/${eventId}/chat-key`, a.cookie, {
      proof: p2.proof,
    });
    expect(r2.status).toBe(200);
    const res = await getChatMembers(eventId, a.cookie);
    const members = ((await res.json()) as { members: { userId: string; pubkey: string }[] })
      .members;
    const mine = members.filter((m) => m.userId === a.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0].pubkey).toBe(p2.key.pubkey);
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
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // owner/a/b がそれぞれ鍵を登録
    const po = await chatKeyProof(eventId);
    await postJson(`/events/${eventId}/chat-key`, owner.cookie, { proof: po.proof });
    const pa = await chatKeyProof(eventId);
    await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: pa.proof });
    const pb = await chatKeyProof(eventId);
    await postJson(`/events/${eventId}/chat-key`, b.cookie, { proof: pb.proof });

    // 参加者本人の登録鍵で署名した kind:40 → 400（旧仕様では受理していたが、
    // 参加者個人の鍵にチャンネルを紐付けない #199）
    const evParticipant = signNostrEvent(pa.key.sk, pa.key.pubkey, 40, [["-"]], "{}");
    const rParticipant = await postJson(`/events/${eventId}/chat-channel`, a.cookie, {
      channelEvent: evParticipant,
    });
    expect(rParticipant.status).toBe(400);

    // 未登録鍵で署名した kind:40 → 400（無関係チャンネルの紐付け防止）
    const stranger = makeNostrKey();
    const evStranger = signNostrEvent(stranger.sk, stranger.pubkey, 40, [["-"]], "{}");
    const rBad = await postJson(`/events/${eventId}/chat-channel`, a.cookie, {
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

    // 後着（b が公式鍵署名の kind:40 を持ってきても）は無視され、既存IDが返る
    const evOfficial = signNostrEvent(SERVICE_KEY.sk, SERVICE_KEY.pubkey, 40, [], "{}");
    const r2 = await postJson(`/events/${eventId}/chat-channel`, b.cookie, {
      channelEvent: evOfficial,
    });
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { channelId: string }).channelId).toBe(ev1.id);
  });

  it("chat-channel: 公式鍵署名の kind:40 は参加者からの登録でも受理", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);

    const evOfficial = signNostrEvent(SERVICE_KEY.sk, SERVICE_KEY.pubkey, 40, [], "{}");
    const r = await postJson(`/events/${eventId}/chat-channel`, a.cookie, {
      channelEvent: evOfficial,
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { channelId: string }).channelId).toBe(
      evOfficial.id,
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

  it("chatEnabled: 既定は true で、イベント更新（PATCH）でオンオフできる", async () => {
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
    await addMember(eventId, a.userId);

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

  it("official: 非メンバー・未確定メンバーは403", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const waitlisted = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, waitlisted.userId, "participant", "waitlist");

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
    await addMember(eventId, a.userId);

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
