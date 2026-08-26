import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { MeetPrize, MeetPrizeList } from "@eventer/shared";
import { MEET_PRIZE_IMAGE } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 景品画像 (#434)。固定したい契約:
 *
 * - アップロードは staff のみ。MIME 許可リスト＋マジックバイト＋1MB 上限
 * - 差し替え・景品削除で旧 R2 オブジェクトが残らない（孤児を作らない）
 * - 複製は R2 オブジェクトをコピーして**別のキー**（共有すると共倒れ）
 * - 公開応答に載るのは imageUrl だけ（R2 キーは staff 向け応答のみ）
 * - オフのイベントの画像は staff 以外に 404（存在ごと隠す門と同じ姿勢）
 */

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `i_${uid.slice(0, 8)}`, null, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function insertEvent(ownerId: string, meetPrizes: 0 | 1): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, scheduling, meet_prizes, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', 0, ?, ?, ?)`,
  )
    .bind(id, `画像E2E_${id.slice(0, 6)}`, now - 3600_000, now + 3600_000, meetPrizes, ownerId, now)
    .run();
  return id;
}

async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" = "staff",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, Date.now())
    .run();
}

const prizesUrl = (eventId: string) => `${BASE}/api/events/${eventId}/meet-prizes`;

async function createPrize(eventId: string, cookie: string): Promise<string> {
  const res = await SELF.fetch(prizesUrl(eventId), {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "画像つき景品",
      description: "",
      conditionType: "meet_count",
      threshold: 1,
      stock: 1,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { prize: { id: string } }).prize.id;
}

/** 正しい PNG 先頭シグネチャ + 中身は適当（マジックバイト検査は先頭だけを見る契約） */
function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
}

function putImage(
  eventId: string,
  prizeId: string,
  cookie: string,
  body: BodyInit,
  contentType: string,
): Promise<Response> {
  return SELF.fetch(`${prizesUrl(eventId)}/${prizeId}/image`, {
    method: "PUT",
    headers: { cookie, "content-type": contentType },
    body,
  });
}

/** staff 用の定義一覧から imageKey を読む */
async function imageKeyOf(
  eventId: string,
  prizeId: string,
  cookie: string,
): Promise<string | null> {
  const res = await SELF.fetch(`${prizesUrl(eventId)}/list`, {
    headers: { cookie },
  });
  const { prizes } = (await res.json()) as { prizes: MeetPrize[] };
  return prizes.find((p) => p.id === prizeId)?.imageKey ?? null;
}

async function setup(meetPrizes: 0 | 1 = 1) {
  const staff = await makeUser();
  const eventId = await insertEvent(staff.userId, meetPrizes);
  await addMember(eventId, staff.userId, "staff");
  const prizeId = await createPrize(eventId, staff.cookie);
  return { staff, eventId, prizeId };
}

describe("景品画像のアップロード (#434)", () => {
  it("staff 以外は 403。MIME 許可リスト外は 400。マジックバイト不一致は 400", async () => {
    const { staff, eventId, prizeId } = await setup();
    const participant = await makeUser();
    await addMember(eventId, participant.userId, "participant");

    const forbidden = await putImage(eventId, prizeId, participant.cookie, pngBytes(), "image/png");
    expect(forbidden.status).toBe(403);

    const badMime = await putImage(eventId, prizeId, staff.cookie, pngBytes(), "text/html");
    expect(badMime.status).toBe(400);
    expect(await badMime.json()).toEqual({ error: "invalid_content_type" });

    // PNG を名乗るがシグネチャが違う（HTML等の偽装）
    const fake = await putImage(
      eventId, prizeId, staff.cookie,
      new TextEncoder().encode("<html>not a png</html>"), "image/png",
    );
    expect(fake.status).toBe(400);
    expect(await fake.json()).toEqual({ error: "invalid_image" });
    expect(await imageKeyOf(eventId, prizeId, staff.cookie)).toBeNull();
  });

  it("1MB を超える画像は 413（上限の契約は MEET_PRIZE_IMAGE の1か所）", async () => {
    const { staff, eventId, prizeId } = await setup();
    const big = new Uint8Array(MEET_PRIZE_IMAGE.maxBytes + 1);
    big.set(pngBytes()); // 先頭は正しい PNG シグネチャ（サイズだけで弾かれること）
    const res = await putImage(eventId, prizeId, staff.cookie, big, "image/png");
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "too_large",
      maxBytes: MEET_PRIZE_IMAGE.maxBytes,
    });
    expect(await imageKeyOf(eventId, prizeId, staff.cookie)).toBeNull();
  });

  it("アップロードで公開一覧に imageUrl が出て、画像が配信される。R2 キーは公開応答に無い", async () => {
    const { staff, eventId, prizeId } = await setup();
    const ok = await putImage(eventId, prizeId, staff.cookie, pngBytes(), "image/png");
    expect(ok.status).toBe(200);

    const key = await imageKeyOf(eventId, prizeId, staff.cookie);
    expect(key).toMatch(new RegExp(`^prize-images/${prizeId}/`));
    expect(await env.BUCKET.head(key!)).not.toBeNull();

    const pubRaw = await (await SELF.fetch(prizesUrl(eventId))).text();
    const pub = JSON.parse(pubRaw) as MeetPrizeList;
    expect(pub.prizes[0].imageUrl).toBe(
      `/api/events/${eventId}/meet-prizes/${prizeId}/image?v=${key!.split("/").pop()}`,
    );
    expect(pubRaw).not.toContain("prize-images/"); // キーそのものは公開応答に載せない

    // 配信（未ログイン可・Content-Type 固定・nosniff）
    const img = await SELF.fetch(`${BASE}${pub.prizes[0].imageUrl}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(pngBytes());
  });

  it("差し替えで旧オブジェクトが消え、新キーに変わる", async () => {
    const { staff, eventId, prizeId } = await setup();
    await putImage(eventId, prizeId, staff.cookie, pngBytes(), "image/png");
    const oldKey = (await imageKeyOf(eventId, prizeId, staff.cookie))!;

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
    const replace = await putImage(eventId, prizeId, staff.cookie, jpeg, "image/jpeg");
    expect(replace.status).toBe(200);

    const newKey = (await imageKeyOf(eventId, prizeId, staff.cookie))!;
    expect(newKey).not.toBe(oldKey);
    expect(await env.BUCKET.head(newKey)).not.toBeNull();
    expect(await env.BUCKET.head(oldKey)).toBeNull(); // 旧は掃除済み
  });

  it("画像の削除・景品の削除で R2 オブジェクトが残らない", async () => {
    const { staff, eventId, prizeId } = await setup();
    await putImage(eventId, prizeId, staff.cookie, pngBytes(), "image/png");
    const key1 = (await imageKeyOf(eventId, prizeId, staff.cookie))!;
    const del = await SELF.fetch(`${prizesUrl(eventId)}/${prizeId}/image`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect(del.status).toBe(200);
    expect(await imageKeyOf(eventId, prizeId, staff.cookie)).toBeNull();
    expect(await env.BUCKET.head(key1)).toBeNull();

    // 景品ごと削除しても孤児を残さない
    await putImage(eventId, prizeId, staff.cookie, pngBytes(), "image/png");
    const key2 = (await imageKeyOf(eventId, prizeId, staff.cookie))!;
    const delPrize = await SELF.fetch(`${prizesUrl(eventId)}/${prizeId}`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect(delPrize.status).toBe(200);
    expect(await env.BUCKET.head(key2)).toBeNull();
  });

  it("イベント複製で画像はコピーされ、キーは別物（片方を消しても共倒れしない）", async () => {
    const { staff, eventId, prizeId } = await setup();
    await putImage(eventId, prizeId, staff.cookie, pngBytes(), "image/png");
    const srcKey = (await imageKeyOf(eventId, prizeId, staff.cookie))!;

    const dup = await SELF.fetch(`${BASE}/api/events/${eventId}/duplicate`, {
      method: "POST",
      headers: { cookie: staff.cookie },
    });
    expect(dup.status).toBe(201);
    const copiedEventId = ((await dup.json()) as { event: { id: string } }).event.id;

    const list = await SELF.fetch(`${prizesUrl(copiedEventId)}/list`, {
      headers: { cookie: staff.cookie },
    });
    const { prizes } = (await list.json()) as { prizes: MeetPrize[] };
    expect(prizes).toHaveLength(1);
    const dstKey = prizes[0].imageKey!;
    expect(dstKey).not.toBe(srcKey);
    expect(dstKey).toMatch(new RegExp(`^prize-images/${prizes[0].id}/`));
    expect(await env.BUCKET.head(srcKey)).not.toBeNull();
    expect(await env.BUCKET.head(dstKey)).not.toBeNull();

    // 元の画像を消しても複製側は生きている（キー共有していない証明）
    await SELF.fetch(`${prizesUrl(eventId)}/${prizeId}/image`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect(await env.BUCKET.head(dstKey)).not.toBeNull();
  });

  it("オフのイベントの画像は staff 以外に 404（staff はプレビューできる）", async () => {
    const { staff, eventId, prizeId } = await setup(0);
    await putImage(eventId, prizeId, staff.cookie, pngBytes(), "image/png");
    const key = (await imageKeyOf(eventId, prizeId, staff.cookie))!;
    const url = `${prizesUrl(eventId)}/${prizeId}/image?v=${key.split("/").pop()}`;

    expect((await SELF.fetch(url)).status).toBe(404); // 未ログイン
    const outsider = await makeUser();
    expect(
      (await SELF.fetch(url, { headers: { cookie: outsider.cookie } })).status,
    ).toBe(404);
    const preview = await SELF.fetch(url, { headers: { cookie: staff.cookie } });
    expect(preview.status).toBe(200); // 仕込み中のプレビュー
    await preview.arrayBuffer(); // R2 ストリームは読み切る（isolated storage 対策）
  });
});
