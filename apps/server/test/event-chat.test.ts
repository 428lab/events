import {
  SELF,
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { ChatMembersPayload, Event } from "@eventer/shared";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";

const BASE = "https://example.com";

// /chat-channel/create のテストはリレー発行を spy で差し替える
// （外向きの実 WebSocket はテスト環境で張らない。docs/nip70-protected-chat.md 4.1）
afterEach(() => {
  vi.restoreAllMocks();
});

/** リレー発行の spy。ok なら全リレー受理、そうでなければ全滅の報告を返す */
function spyPublish(ok: boolean) {
  return vi
    .spyOn(nostrRelay, "publishToRelays")
    .mockImplementation(async (relayUrls): Promise<PublishReport> => {
      return {
        ok,
        relays: relayUrls.map((url) => ({
          url,
          outcome: ok ? ("ok" as const) : ("rejected" as const),
          ...(ok ? {} : { message: "blocked: unsupported" }),
        })),
      };
    });
}

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

/** その鍵を「このアカウントに登録された鍵」にする (#332)。
 * 本番ではサインイン（または連携）のときに作られる紐付けを、テストでは直接作る。
 * これが無い鍵は chat-key の登録で 403 (key_not_linked) になる */
async function linkKey(userId: string, pubkey: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at)
     VALUES (?, ?, 'nostr', ?, NULL, ?)`,
  )
    .bind(crypto.randomUUID(), userId, pubkey, Date.now())
    .run();
}

/** 紐付けを別のアカウントへ移す（鍵を手放して別の人が登録し直した状態） */
async function relinkKey(userId: string, pubkey: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM identity WHERE provider = 'nostr' AND provider_user_id = ?",
  )
    .bind(pubkey)
    .run();
  await linkKey(userId, pubkey);
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

    // 正しい所有証明つき、かつアカウントに登録された鍵 → 登録できる
    const p1 = await chatKeyProof(eventId);
    await linkKey(a.userId, p1.key.pubkey);
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

    // アカウントに登録されていない鍵 → 403 (#332)。所有証明が通っていても、
    // 「この鍵の持ち主」であることと「このアカウントの人」であることは別
    const pStray = await chatKeyProof(eventId);
    const rStray = await postJson(`/events/${eventId}/chat-key`, a.cookie, {
      proof: pStray.proof,
    });
    expect(rStray.status).toBe(403);
    expect(await rStray.json()).toEqual({ error: "key_not_linked" });

    // 他人のアカウントに登録されている鍵 → 同じく 403（鍵を共有していても、
    // その鍵の発言を自分のものとして表示させることはできない）
    const pOthers = await chatKeyProof(eventId, p1.key);
    const rOthers = await postJson(`/events/${eventId}/chat-key`, b.cookie, {
      proof: pOthers.proof,
    });
    expect(rOthers.status).toBe(403);
    expect(await rOthers.json()).toEqual({ error: "key_not_linked" });

    // 紐付けを B へ移しても、そのイベントで A が使った鍵は B が登録できない → 409
    // （その鍵の過去の発言を横取りさせない。イベント内では先着で押さえる）
    await relinkKey(b.userId, p1.key.pubkey);
    const pSame = await chatKeyProof(eventId, p1.key);
    const rTaken = await postJson(`/events/${eventId}/chat-key`, b.cookie, {
      proof: pSame.proof,
    });
    expect(rTaken.status).toBe(409);
    await relinkKey(a.userId, p1.key.pubkey);

    // 本人による別鍵の登録 → 前の鍵も表示許可リストに残る
    // （過去の自分の発言が消えないように #332）
    const p2 = await chatKeyProof(eventId);
    await linkKey(a.userId, p2.key.pubkey);
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

  /** #332: スマホなど自分の鍵が使えない端末で入り直すと、以前に自分の鍵で
   * 署名して書いた発言が画面から消えていた。表示は許可リストで絞られていて、
   * 鍵を登録し直すと前の鍵が許可リストから消えていたため。
   * 同じアカウントである限り、発言の手段が変わっても過去の鍵は残り続ける */
  it("chat-key: 発言の手段を変えても過去の自分の鍵が表示許可リストに残る (#332)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // 自分の鍵が使える端末で登録して発言していた状態
    const p1 = await chatKeyProof(eventId);
    await linkKey(a.userId, p1.key.pubkey);
    expect(
      (await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: p1.proof }))
        .status,
    ).toBe(200);

    // 自分の鍵が使えない端末で入り直す（＝一時鍵での参加）
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

    // 一時鍵を配ったあとに自分の鍵へ戻しても、一時鍵の行は消えない
    expect(
      (await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: (await chatKeyProof(eventId, p1.key)).proof }))
        .status,
    ).toBe(200);
    const again = await postJson(
      `/events/${eventId}/chat-key/ephemeral`,
      a.cookie,
      {},
    );
    expect((await again.json()) as object).toEqual(ephemeral);

    // 他人の鍵はそのイベントの許可リストにも載らないまま
    const p3 = await chatKeyProof(eventId);
    await linkKey(b.userId, p3.key.pubkey);
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

  /** #332 の核心。自分の鍵が使える端末と使えない端末を行き来しても、
   * サーバーが保管する一時鍵は**イベント×ユーザーで1つのまま**でなければならない。
   * 入り直すたびに発行していると、その人の鍵（＝表示許可リストの行）が
   * 際限なく増える。リストは全参加者が数秒ごとに取るので、そのまま全員の負担になる */
  it("chat-key/ephemeral: 端末を行き来しても一時鍵は1つしか作られない (#332)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);

    // 一時鍵で参加 → 自分の鍵に切替 → また一時鍵、を2往復する
    const first = (await (
      await postJson(`/events/${eventId}/chat-key/ephemeral`, a.cookie, {})
    ).json()) as { secret: string; pubkey: string };
    const ownKeys: string[] = [];
    for (let i = 0; i < 2; i++) {
      const p = await chatKeyProof(eventId);
      await linkKey(a.userId, p.key.pubkey);
      expect(
        (await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: p.proof }))
          .status,
      ).toBe(200);
      ownKeys.push(p.key.pubkey);
      const back = await postJson(
        `/events/${eventId}/chat-key/ephemeral`,
        a.cookie,
        {},
      );
      // 秘密ごと同じ鍵が返る（新しい鍵が発行されていない）
      expect((await back.json()) as object).toEqual(first);
    }

    // 増えたのは登録した自分の鍵ぶんだけ。一時鍵は最初の1つのまま
    const members = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(
      members.members
        .filter((m) => m.userId === a.userId)
        .map((m) => m.pubkey)
        .sort(),
    ).toEqual([first.pubkey, ...ownKeys].sort());
  });

  /** 移行 (0066) で運ばれてくる形の行が、そのまま使い続けられること。
   * 移行前は「イベント×ユーザーで1行」だったので、運ばれてくるのは
   * 一時鍵の行（secret 付き）か自分の鍵の行（secret NULL）のどちらか1行。
   * 一時鍵の秘密が引き継がれないと、移行の直後に全員へ新しい鍵が配られ、
   * それまでの発言が画面から消える */
  it("移行で運ばれた鍵はそのまま使い続けられる (#332)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // 移行前から持っていた一時鍵（A）と自分の鍵（B）を、移行後の形で置く
    const carried = makeNostrKey();
    const carriedSecret = bytesToHex(carried.sk);
    await env.DB.prepare(
      `INSERT INTO event_chat_key (event_id, user_id, pubkey, secret, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(eventId, a.userId, carried.pubkey, carriedSecret, Date.now() - 1000)
      .run();
    const oldOwn = makeNostrKey();
    await env.DB.prepare(
      `INSERT INTO event_chat_key (event_id, user_id, pubkey, secret, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
    )
      .bind(eventId, b.userId, oldOwn.pubkey, Date.now() - 1000)
      .run();

    // 一時鍵は再発行されず、そのまま配られる
    const got = await postJson(
      `/events/${eventId}/chat-key/ephemeral`,
      a.cookie,
      {},
    );
    expect(got.status).toBe(200);
    expect((await got.json()) as object).toEqual({
      pubkey: carried.pubkey,
      secret: carriedSecret,
    });

    // 移行前の鍵はどちらも表示許可リストに残っている（過去の発言が消えない）
    const members = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(members.members.find((m) => m.pubkey === carried.pubkey)?.userId).toBe(
      a.userId,
    );
    expect(members.members.find((m) => m.pubkey === oldOwn.pubkey)?.userId).toBe(
      b.userId,
    );
  });

  /** 鍵は消えないので、増える経路には上限が要る。
   * アカウントに登録された鍵しか登録できない (#332) ので普通は届かないが、
   * 鍵を登録し直せば増やせる以上、上限そのものが無いのは穴 */
  it("chat-key: 1人が使える鍵の数には上限がある (#332)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);

    // 上限（10）まで使い切った状態を直接作る
    for (let i = 0; i < 10; i++) {
      await env.DB.prepare(
        `INSERT INTO event_chat_key (event_id, user_id, pubkey, secret, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      )
        .bind(eventId, a.userId, makeNostrKey().pubkey, Date.now())
        .run();
    }

    const p = await chatKeyProof(eventId);
    await linkKey(a.userId, p.key.pubkey);
    const res = await postJson(`/events/${eventId}/chat-key`, a.cookie, {
      proof: p.proof,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "too_many_keys" });
  });

  /** アカウント紐付けの確認を入れる前に登録していた人 (#332)。
   * 別の手段でサインインしていると鍵はアカウントに登録されていないので、
   * 紐付けを先に見ると「自分の鍵なのに登録されていません」と言われてしまう。
   * 行が増えない登録し直しは、なりすましにも許可リストの肥大にも寄与しない */
  it("chat-key: 既に自分のものになっている鍵は、紐付けが無くても登録し直せる (#332)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);

    // 紐付けの確認より前に登録されていた鍵（アカウントには登録されていない）
    const old = makeNostrKey();
    await env.DB.prepare(
      `INSERT INTO event_chat_key (event_id, user_id, pubkey, secret, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
    )
      .bind(eventId, a.userId, old.pubkey, Date.now())
      .run();

    const proof = await chatKeyProof(eventId, old);
    expect(
      (await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: proof.proof }))
        .status,
    ).toBe(200);
    // 行は増えない（同じ鍵のまま）
    const members = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(members.members.filter((m) => m.userId === a.userId)).toHaveLength(1);

    // 上限を使い切っていても、登録し直しは通る（何も増やさないので）
    for (let i = 0; i < 10; i++) {
      await env.DB.prepare(
        `INSERT INTO event_chat_key (event_id, user_id, pubkey, secret, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      )
        .bind(eventId, a.userId, makeNostrKey().pubkey, Date.now())
        .run();
    }
    const again = await chatKeyProof(eventId, old);
    expect(
      (await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: again.proof }))
        .status,
    ).toBe(200);
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

    // 自分の鍵（所有証明つき登録）に切り替えても、保管してある一時鍵は残る (#332)。
    // ここで消すと、次に自分の鍵が使えない端末で入ったときに別の鍵が発行され、
    // 一時鍵で書いた発言が全員の画面から消える
    const p = await chatKeyProof(eventId);
    await linkKey(a.userId, p.key.pubkey);
    await postJson(`/events/${eventId}/chat-key`, a.cookie, { proof: p.proof });
    const afterOwnKey = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-key/ephemeral`,
      { headers: { cookie: a.cookie } },
    );
    expect(afterOwnKey.status).toBe(200);
    expect((await afterOwnKey.json()) as object).toEqual(k1);

    // 一時鍵に戻しても同じ鍵のまま（発行はイベント×ユーザーで1回だけ）
    const r3 = await postJson(`/events/${eventId}/chat-key/ephemeral`, a.cookie, {});
    expect((await r3.json()) as object).toEqual(k1);

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

    // owner/a がそれぞれ鍵を登録（登録できるのはアカウントに登録された鍵だけ #332）
    const po = await chatKeyProof(eventId);
    await linkKey(owner.userId, po.key.pubkey);
    await postJson(`/events/${eventId}/chat-key`, owner.cookie, { proof: po.proof });
    const pa = await chatKeyProof(eventId);
    await linkKey(a.userId, pa.key.pubkey);
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

  it("chat-channel: NIP-70 の [\"-\"] タグが無い kind:40 は登録できない (#460)", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    const po = await chatKeyProof(eventId);
    await linkKey(owner.userId, po.key.pubkey);
    await postJson(`/events/${eventId}/chat-key`, owner.cookie, { proof: po.proof });

    // 主催者の登録鍵で署名していても、タグ無しは 400（protected でない
    // チャンネル作成イベントを新規に増やさない）
    const evNoTag = signNostrEvent(po.key.sk, po.key.pubkey, 40, [], "{}");
    const r = await postJson(`/events/${eventId}/chat-channel`, owner.cookie, {
      channelEvent: evNoTag,
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe(
      "invalid_channel_event",
    );
    // 登録されていない
    const members = (await (
      await getChatMembers(eventId, owner.cookie)
    ).json()) as ChatMembersPayload;
    expect(members.channelId).toBeNull();
  });

  it("chat-channel: 公式鍵署名の body は staff でも登録できない (#460 持ち込み防止)", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");

    // 公式鍵の kind:40 はサーバーがリレーへ発行するので第三者も読める。
    // それを HTTP 登録の body に流用する経路（#221 が pending で塞いでいた穴）は、
    // pending 廃止後は「HTTP 登録の許可著者から公式鍵を外す」ことで塞ぐ
    const official = signNostrEvent(
      SERVICE_KEY.sk,
      SERVICE_KEY.pubkey,
      40,
      [["-"]],
      "{}",
    );
    const r = await postJson(`/events/${eventId}/chat-channel`, owner.cookie, {
      channelEvent: official,
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe(
      "invalid_channel_event",
    );

    // 境界の回帰テスト: 公式鍵が（何かの誤りで）主催者の発言鍵として DB に
    // 載っていても、HTTP 登録の公式鍵拒否は**それより前**で効く。
    // 「登録済みの主催者鍵」判定に公式鍵が紛れ込んでも素通りしないこと
    await env.DB.prepare(
      "INSERT OR IGNORE INTO event_chat_key (event_id, user_id, pubkey, secret, created_at) VALUES (?, ?, ?, NULL, ?)",
    )
      .bind(eventId, owner.userId, SERVICE_KEY.pubkey, Date.now())
      .run();
    const r2 = await postJson(`/events/${eventId}/chat-channel`, owner.cookie, {
      channelEvent: official,
    });
    expect(r2.status).toBe(400);
  });

  it("chat-channel/create: チャット無効イベントでは開設できない (#221)", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");

    // staff がチャットをオフにすると /create は 409（公式鍵の署名オラクル化防止）
    await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ chatEnabled: false }),
    });
    const publish = spyPublish(true);
    const res = await postJson(
      `/events/${eventId}/chat-channel/create`,
      owner.cookie,
      {},
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "chat_disabled",
    );
    expect(publish).not.toHaveBeenCalled();
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

describe("公式チャンネル開設 (#460)", () => {
  interface SignedNostrEvent {
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }

  it("create: 公式鍵で [\"-\"] 付き kind:40 を署名・リレー発行し、受理確認後に登録する", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    // 開設は staff のみ (#221)
    await addMember(eventId, a.userId, "staff");

    const publish = spyPublish(true);
    const res = await postJson(
      `/events/${eventId}/chat-channel/create`,
      a.cookie,
      {},
    );
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledTimes(1);
    const [relayUrls, channelEvent] = publish.mock.calls[0] as unknown as [
      string[],
      SignedNostrEvent,
    ];
    // 接続先は運用設定の実効値のみ（テスト環境は既定の2台）
    expect(relayUrls).toEqual(["wss://r.kojira.io", "wss://x.kojira.io"]);

    // kind:40・NIP-70 の ["-"] タグ・公式鍵の pubkey
    expect(channelEvent.kind).toBe(40);
    expect(channelEvent.tags).toEqual([["-"]]);
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

    // 発行イベントの id がそのまま channelId として登録されている
    expect(((await res.json()) as { channelId: string }).channelId).toBe(
      channelEvent.id,
    );
    const members = (await (
      await getChatMembers(eventId, a.cookie)
    ).json()) as ChatMembersPayload;
    expect(members.channelId).toBe(channelEvent.id);
  });

  it("create: 全リレー失敗なら 502 で、DB には登録しない", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");

    spyPublish(false);
    const res = await postJson(
      `/events/${eventId}/chat-channel/create`,
      owner.cookie,
      {},
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      error: string;
      relays: { url: string; outcome: string; message?: string }[];
    };
    expect(body.error).toBe("relay_publish_failed");
    // staff 向けのデバッグ情報としてリレーごとの内訳が返る
    expect(body.relays.map((r) => r.outcome)).toEqual(["rejected", "rejected"]);

    // 受理確認前に登録しない不変条件: channelId は未設定のまま
    const members = (await (
      await getChatMembers(eventId, owner.cookie)
    ).json()) as ChatMembersPayload;
    expect(members.channelId).toBeNull();
  });

  it("create: 既存チャンネルがあれば発行せず既存IDを返す", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");

    const publish = spyPublish(true);
    const first = await postJson(
      `/events/${eventId}/chat-channel/create`,
      owner.cookie,
      {},
    );
    const { channelId } = (await first.json()) as { channelId: string };

    const second = await postJson(
      `/events/${eventId}/chat-channel/create`,
      owner.cookie,
      {},
    );
    expect(second.status).toBe(200);
    expect(((await second.json()) as { channelId: string }).channelId).toBe(
      channelId,
    );
    // 2回目はリレーへ発行していない
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("create: 非メンバー・未確定メンバー・参加者は403", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const waitlisted = await makeUser();
    const participant = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, waitlisted.userId, "participant", "waitlist");
    await addMember(eventId, participant.userId);

    const publish = spyPublish(true);
    // 確定済み参加者でも開設は staff のみ (#221)
    for (const cookie of [
      participant.cookie,
      outsider.cookie,
      waitlisted.cookie,
    ]) {
      expect(
        (
          await postJson(`/events/${eventId}/chat-channel/create`, cookie, {})
        ).status,
      ).toBe(403);
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it("create: NOSTR_SERVICE_KEY 未設定なら 503 (service_key_unset)", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId, "staff");

    // SELF のバインディングは変えられないため、worker.fetch を鍵なしの env で直接呼ぶ
    const publish = spyPublish(true);
    const { default: worker } = await import("../src/worker.js");
    const keyless = {
      ...(env as Record<string, unknown>),
      NOSTR_SERVICE_KEY: undefined,
    };
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${BASE}/api/events/${eventId}/chat-channel/create`, {
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
    expect(publish).not.toHaveBeenCalled();
  });

  it("chat-channel/official は廃止 (#460)。旧クライアントには 404", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    const res = await postJson(
      `/events/${eventId}/chat-channel/official`,
      owner.cookie,
      {},
    );
    expect(res.status).toBe(404);
  });

  it("chat-channel: NOSTR_SERVICE_KEY 未設定環境では公式鍵署名でも素通りせず 400", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");

    // servicePubkey() が null の環境で、鍵署名の kind:40 が「公式扱い」で
    // 受理されないこと（null との比較が偽になる境界の回帰テスト）
    const ev = signNostrEvent(
      SERVICE_KEY.sk,
      SERVICE_KEY.pubkey,
      40,
      [["-"]],
      "{}",
    );
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
    await linkKey(owner.userId, po.key.pubkey);
    await postJson(`/events/${eventId}/chat-key`, owner.cookie, { proof: po.proof });
    const ev40 = signNostrEvent(po.key.sk, po.key.pubkey, 40, [["-"]], "{}");
    const reg = await postJson(`/events/${eventId}/chat-channel`, owner.cookie, { channelEvent: ev40 });
    expect(reg.status).toBe(200);

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

    // 部屋の開設（公式鍵経路のサーバー発行 #460）
    const publish = spyPublish(true);
    expect(
      (await postJson(`/events/${eventId}/chat-channel/create`, owner.cookie, {})).status,
    ).toBe(403);
    expect(
      (await postJson(`/events/${eventId}/chat-channel/create`, admin.cookie, {})).status,
    ).toBe(403);
    expect(publish).not.toHaveBeenCalled();

    // 署名済みの kind:40 を持っていても、staff でなければ登録もできない
    const stray = makeNostrKey();
    const channelEvent = signNostrEvent(stray.sk, stray.pubkey, 40, [["-"]], "{}");
    for (const cookie of [owner.cookie, admin.cookie]) {
      expect(
        (await postJson(`/events/${eventId}/chat-channel`, cookie, { channelEvent }))
          .status,
      ).toBe(403);
    }
    // 403 が素通りしていない（部屋は未開設のまま）
    expect((await chatState(eventId, staff.cookie)).channelId).toBeNull();

    // staff は開設できる
    const opened = await postJson(
      `/events/${eventId}/chat-channel/create`,
      staff.cookie,
      {},
    );
    expect(opened.status).toBe(200);
    const { channelId } = (await opened.json()) as { channelId: string };
    expect((await chatState(eventId, staff.cookie)).channelId).toBe(channelId);

    // チャンネルの作り直し（リセット）
    for (const cookie of [owner.cookie, admin.cookie]) {
      expect((await del(`/events/${eventId}/chat-channel`, cookie)).status).toBe(403);
    }
    expect((await chatState(eventId, staff.cookie)).channelId).toBe(channelId);

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
      (await postJson(`/events/${eventId}/chat-channel/create`, onHold.cookie, {})).status,
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
