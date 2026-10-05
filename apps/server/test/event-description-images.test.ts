import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { EventDescriptionImage } from "@eventer/shared";
import { EVENT_DESCRIPTION_IMAGE } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * イベント説明文・参加者限定文章に差し込む画像 (D-DESC-IMAGE)。固定したい契約:
 *
 * - 追加・一覧・削除は編集できる人（staff）だけ。参加者・他人は 403
 * - WebP / JPEG・1MB 以内だけ。Content-Length を偽っても実際の量で弾く
 * - 1イベント10枚まで
 * - 削除で行も R2 の実体も消える。イベント削除でも実体が残らない
 * - 配信はイベントを見られる人に。公開イベントは未ログインでも見える。
 *   非公開イベントでは見られない人に 404
 */

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `d_${uid.slice(0, 8)}`, null, Date.now())
    .run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function insertEvent(
  ownerId: string,
  opts: { status?: "draft" | "published"; visibility?: "public" | "private" } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, scheduling, visibility, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', ?, 0, ?, ?, ?)`,
  )
    .bind(
      id,
      `説明画像_${id.slice(0, 6)}`,
      now + 86400_000,
      now + 90000_000,
      opts.status ?? "published",
      opts.visibility ?? "public",
      ownerId,
      now,
    )
    .run();
  return id;
}

async function addMember(eventId: string, userId: string, role: "participant" | "staff") {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, Date.now())
    .run();
}

/** WebP の最小ヘッダ（RIFF....WEBP）を持つバイト列 */
function webpBytes(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
}
function jpegBytes(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff], 0);
  return b;
}
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"),
  (c) => c.charCodeAt(0),
);

/** 応答本文を読み切ってから status を返す。R2 の本文を読み残すと
 * テスト用ストレージの巻き戻し（isolatedStorage）が失敗する */
async function statusOf(res: Response | Promise<Response>): Promise<number> {
  const r = await res;
  await r.arrayBuffer();
  return r.status;
}

const listUrl = (eventId: string) => `${BASE}/api/events/${eventId}/description-images`;

function upload(
  eventId: string,
  cookie: string,
  body: BodyInit,
  type = "image/webp",
  extraHeaders: Record<string, string> = {},
) {
  return SELF.fetch(listUrl(eventId), {
    method: "POST",
    headers: { cookie, "content-type": type, ...extraHeaders },
    body,
  });
}

async function uploadOk(eventId: string, cookie: string): Promise<EventDescriptionImage> {
  const res = await upload(eventId, cookie, webpBytes());
  expect(res.status).toBe(201);
  return ((await res.json()) as { image: EventDescriptionImage }).image;
}

async function setup() {
  const staff = await makeUser();
  const eventId = await insertEvent(staff.userId);
  await addMember(eventId, staff.userId, "staff");
  return { staff, eventId };
}

describe("説明文画像のアップロード (D-DESC-IMAGE)", () => {
  it("staff は WebP と JPEG を追加でき、一覧に出て、相対URLで配信される", async () => {
    const { staff, eventId } = await setup();
    const webp = await uploadOk(eventId, staff.cookie);
    expect(webp.url).toBe(`/api/events/${eventId}/description-images/${webp.id}`);
    const jpeg = await upload(eventId, staff.cookie, jpegBytes(), "image/jpeg");
    await jpeg.arrayBuffer();
    expect(jpeg.status).toBe(201);

    const list = await SELF.fetch(listUrl(eventId), { headers: { cookie: staff.cookie } });
    expect(list.status).toBe(200);
    const { images } = (await list.json()) as { images: EventDescriptionImage[] };
    expect(images.map((i) => i.id)).toContain(webp.id);
    expect(images).toHaveLength(2);

    expect(await env.BUCKET.head(`event-description-images/${eventId}/${webp.id}`)).not.toBeNull();
  });

  it("参加者・無関係の人・未ログインは追加も一覧もできない", async () => {
    const { eventId } = await setup();
    const participant = await makeUser();
    await addMember(eventId, participant.userId, "participant");
    const stranger = await makeUser();
    for (const cookie of [participant.cookie, stranger.cookie]) {
      expect(await statusOf(upload(eventId, cookie, webpBytes()))).toBe(403);
      expect(await statusOf(SELF.fetch(listUrl(eventId), { headers: { cookie } }))).toBe(403);
    }
    const anon = await SELF.fetch(listUrl(eventId), {
      method: "POST",
      headers: { "content-type": "image/webp" },
      body: webpBytes(),
    });
    await anon.arrayBuffer();
    expect(anon.status).toBe(401);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_description_image WHERE event_id = ?")
      .bind(eventId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("WebP / JPEG 以外と、中身が画像でないものは断る", async () => {
    const { staff, eventId } = await setup();
    expect(await statusOf(upload(eventId, staff.cookie, PNG, "image/png"))).toBe(400);
    expect(await statusOf(upload(eventId, staff.cookie, new Uint8Array([1, 2, 3, 4]), "text/plain"))).toBe(400);
    expect(await statusOf(upload(eventId, staff.cookie, new Uint8Array(64), "image/webp"))).toBe(400);
  });

  it("1MB を超えると 413。Content-Length を小さく偽っても実際の量で断る", async () => {
    const { staff, eventId } = await setup();
    const big = webpBytes(EVENT_DESCRIPTION_IMAGE.maxBytes + 1);
    expect(await statusOf(upload(eventId, staff.cookie, big))).toBe(413);

    // 宣言は小さく、本文はチャンクで上限を超えて流す
    const chunk = webpBytes(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 5) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const lying = await upload(eventId, staff.cookie, stream, "image/webp", { "content-length": "100" });
    expect(lying.status).toBe(413);
    // 全体の上限（8MB）ではなく、この経路のストリーム計数で断っている
    expect(await lying.json()).toEqual({ error: "too_large", maxBytes: EVENT_DESCRIPTION_IMAGE.maxBytes });

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_description_image WHERE event_id = ?")
      .bind(eventId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("ちょうど 1MB は受け付ける", async () => {
    const { staff, eventId } = await setup();
    expect(await statusOf(upload(eventId, staff.cookie, webpBytes(EVENT_DESCRIPTION_IMAGE.maxBytes)))).toBe(201);
  });

  it("1イベント10枚まで。11枚目は 409 で、実体も残さない", async () => {
    const { staff, eventId } = await setup();
    for (let i = 0; i < EVENT_DESCRIPTION_IMAGE.maxPerEvent; i++) await uploadOk(eventId, staff.cookie);
    const over = await upload(eventId, staff.cookie, webpBytes());
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: string }).error).toBe("limit_reached");
    const listed = await env.BUCKET.list({ prefix: `event-description-images/${eventId}/` });
    expect(listed.objects).toHaveLength(EVENT_DESCRIPTION_IMAGE.maxPerEvent);
  });

  it("同時に送っても10枚を超えない", async () => {
    const { staff, eventId } = await setup();
    for (let i = 0; i < 8; i++) await uploadOk(eventId, staff.cookie);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => upload(eventId, staff.cookie, webpBytes())),
    );
    await Promise.all(results.map((r) => r.arrayBuffer()));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_description_image WHERE event_id = ?")
      .bind(eventId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(EVENT_DESCRIPTION_IMAGE.maxPerEvent);
    const listed = await env.BUCKET.list({ prefix: `event-description-images/${eventId}/` });
    expect(listed.objects).toHaveLength(EVENT_DESCRIPTION_IMAGE.maxPerEvent);
  });
});

describe("説明文画像の削除と配信 (D-DESC-IMAGE)", () => {
  it("staff が消すと行も実体も消え、配信は 404 になる。参加者は消せない", async () => {
    const { staff, eventId } = await setup();
    const image = await uploadOk(eventId, staff.cookie);
    const participant = await makeUser();
    await addMember(eventId, participant.userId, "participant");

    const denied = await SELF.fetch(`${BASE}${image.url}`, {
      method: "DELETE",
      headers: { cookie: participant.cookie },
    });
    await denied.arrayBuffer();
    expect(denied.status).toBe(403);

    const del = await SELF.fetch(`${BASE}${image.url}`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    await del.arrayBuffer();
    expect(del.status).toBe(200);
    expect(await env.BUCKET.head(`event-description-images/${eventId}/${image.id}`)).toBeNull();
    expect(await statusOf(SELF.fetch(`${BASE}${image.url}`))).toBe(404);
    const again = await SELF.fetch(`${BASE}${image.url}`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    await again.arrayBuffer();
    expect(again.status).toBe(404);
  });

  it("公開イベントの画像は未ログインでも取れる（nosniff・保存した形式で返す）", async () => {
    const { staff, eventId } = await setup();
    const image = await uploadOk(eventId, staff.cookie);
    const res = await SELF.fetch(`${BASE}${image.url}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webpBytes());
  });

  it("他のイベントの id では取れない・形の違う id は 404", async () => {
    const { staff, eventId } = await setup();
    const image = await uploadOk(eventId, staff.cookie);
    const otherEvent = await insertEvent(staff.userId);
    expect(
      await statusOf(SELF.fetch(`${BASE}/api/events/${otherEvent}/description-images/${image.id}`)),
    ).toBe(404);
    expect(await statusOf(SELF.fetch(`${BASE}/api/events/${eventId}/description-images/not-a-uuid`))).toBe(404);
  });

  it("非公開イベントの画像は見られない人に 404、招待された参加者には返す", async () => {
    const staff = await makeUser();
    const eventId = await insertEvent(staff.userId, { visibility: "private" });
    await addMember(eventId, staff.userId, "staff");
    const image = await uploadOk(eventId, staff.cookie);
    const member = await makeUser();
    await addMember(eventId, member.userId, "participant");
    // 非公開イベントを見られるのは招待を受けた人（参加登録だけでは見えない）
    await env.DB.prepare(
      "INSERT INTO event_access_invite (id, event_id, user_id, status, source, created_at) VALUES (?, ?, ?, 'accepted', 'invite', ?)",
    )
      .bind(crypto.randomUUID(), eventId, member.userId, Date.now())
      .run();
    const stranger = await makeUser();

    expect(await statusOf(SELF.fetch(`${BASE}${image.url}`))).toBe(404);
    expect(
      await statusOf(SELF.fetch(`${BASE}${image.url}`, { headers: { cookie: stranger.cookie } })),
    ).toBe(404);
    const ok = await SELF.fetch(`${BASE}${image.url}`, { headers: { cookie: member.cookie } });
    await ok.arrayBuffer();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
  });

  it("イベントを削除すると説明文画像の実体も消える", async () => {
    const { staff, eventId } = await setup();
    const a = await uploadOk(eventId, staff.cookie);
    const b = await uploadOk(eventId, staff.cookie);
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    await res.arrayBuffer();
    expect(res.status).toBe(200);
    for (const img of [a, b]) {
      expect(await env.BUCKET.head(`event-description-images/${eventId}/${img.id}`)).toBeNull();
    }
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_description_image WHERE event_id = ?")
      .bind(eventId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});
