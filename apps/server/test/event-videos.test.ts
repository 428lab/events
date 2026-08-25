import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  EVENT_PHOTO_LIMIT,
  EVENT_PHOTO_MAX_BYTES,
  EVENT_VIDEO_MAX_BYTES,
  EVENT_VIDEO_MAX_DURATION_MS,
} from "@eventer/shared";
import type { EventPhoto } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 動画投稿 (#408): アップロードの門・Range 配信・公開範囲・削除。
 *
 * 動画は event_photo テーブルに kind='video' で写真と同居する。
 * サーバー側の実体検証は MIME 許可リスト＋マジックバイトまで
 * （Workers でのコンテナ完全パースは重い。lib/videoMime.ts の割り切り）。
 */

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 公開イベントを作る（作成者はメンバー） */
async function setupEvent(
  cookie: string,
  photosPublic = false,
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "動画E2E",
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  if (photosPublic) {
    await env.DB.prepare("UPDATE event SET photos_public = 1 WHERE id = ?")
      .bind(event.id)
      .run();
  }
  return event.id;
}

/** WebM の先頭（EBML ヘッダ）を持つダミーバイト列 */
function webmBytes(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = i % 256;
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
}

/** MP4 の先頭（offset 4 に 'ftyp'）を持つダミーバイト列 */
function mp4Bytes(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
  return b;
}

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

interface UploadOpts {
  bytes?: Uint8Array;
  type?: string;
  /** null で durationMs を送らない */
  durationMs?: number | null;
  /** null で poster を送らない */
  poster?: { bytes: Uint8Array | ArrayBuffer; type: string } | null;
}

async function uploadVideo(
  cookie: string,
  eventId: string,
  opts: UploadOpts = {},
): Promise<Response> {
  const fd = new FormData();
  const bytes = opts.bytes ?? webmBytes();
  const type = opts.type ?? "video/webm";
  fd.append("video", new File([bytes as BlobPart], "v", { type }));
  if (opts.poster !== null) {
    const poster = opts.poster ?? { bytes: PNG, type: "image/png" };
    fd.append(
      "poster",
      new File([poster.bytes as BlobPart], "p", { type: poster.type }),
    );
  }
  if (opts.durationMs !== null) {
    fd.append("durationMs", String(opts.durationMs ?? 30_000));
  }
  return SELF.fetch(`${BASE}/api/events/${eventId}/videos`, {
    method: "POST",
    headers: { cookie },
    body: fd,
  });
}

describe("動画アップロードの門", () => {
  it("正常系 (WebM+poster): 201、行と R2 の実体が揃い、一覧に kind 混在で並ぶ", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const res = await uploadVideo(cookie, eventId, { durationMs: 42_000 });
    expect(res.status).toBe(201);
    const { photo } = (await res.json()) as { photo: EventPhoto };
    expect(photo.kind).toBe("video");
    expect(photo.durationMs).toBe(42_000);

    const row = await env.DB.prepare(
      "SELECT kind, duration_ms, bytes, mime FROM event_photo WHERE id = ?",
    )
      .bind(photo.id)
      .first<{ kind: string; duration_ms: number; bytes: number; mime: string }>();
    expect(row).toEqual({
      kind: "video",
      duration_ms: 42_000,
      bytes: 64,
      mime: "video/webm",
    });
    expect(
      await env.BUCKET.head(`event-videos/${eventId}/${photo.id}`),
    ).not.toBeNull();
    expect(
      await env.BUCKET.head(`event-videos/${eventId}/${photo.id}-poster`),
    ).not.toBeNull();

    // 写真と同じ一覧に混ざる（新しい一覧APIは作らない）
    const list = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie },
    });
    const { photos } = (await list.json()) as { photos: EventPhoto[] };
    expect(photos.map((p) => p.kind)).toContain("video");
  });

  it("MP4 も受ける。poster なしなら poster 配信は 404（プレースホルダ用）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const res = await uploadVideo(cookie, eventId, {
      bytes: mp4Bytes(),
      type: "video/mp4",
      poster: null,
    });
    expect(res.status).toBe(201);
    const { photo } = (await res.json()) as { photo: EventPhoto };
    const poster = await SELF.fetch(
      `${BASE}/api/events/${eventId}/photos/${photo.id}/poster`,
      { headers: { cookie } },
    );
    expect(poster.status).toBe(404);
  });

  it("MIME 許可リスト外（mov 等）は 400", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const res = await uploadVideo(cookie, eventId, { type: "video/quicktime" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "invalid_content_type",
    );
  });

  it("マジックバイトが合わない偽装ファイルは 400（宣言 MIME だけを信じない）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    // PNG の中身に video/mp4 を名乗らせる
    const res = await uploadVideo(cookie, eventId, {
      bytes: PNG,
      type: "video/mp4",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_video");
  });

  it("長さの申告が上限超過・欠落・非整数なら 400", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    for (const durationMs of [EVENT_VIDEO_MAX_DURATION_MS + 1, null, 0.5]) {
      const res = await uploadVideo(cookie, eventId, {
        durationMs: durationMs as number | null,
      });
      expect(res.status, `durationMs=${durationMs}`).toBe(400);
    }
    // ちょうど上限は通す
    const ok = await uploadVideo(cookie, eventId, {
      durationMs: EVENT_VIDEO_MAX_DURATION_MS,
    });
    expect(ok.status).toBe(201);
  });

  it("動画のサイズ上限（40MB）をサーバーでも強制する", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const res = await uploadVideo(cookie, eventId, {
      bytes: webmBytes(EVENT_VIDEO_MAX_BYTES + 1),
    });
    expect(res.status).toBe(413);
  }, 30_000);

  it("bodyLimit の拡張は動画ルートだけ（写真ルートは 8MB のまま 413）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const nineMb = 9 * 1024 * 1024;
    // 写真: 9MB は門（グローバル bodyLimit）で弾かれる
    const photoRes = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      method: "POST",
      headers: { "content-type": "image/png", cookie },
      body: new Uint8Array(nineMb),
    });
    expect(photoRes.status).toBe(413);
    // 動画: 同じ 9MB でも門は通る。durationMs をわざと欠いて 400（=門の後の
    // ルート内検証）で止め、門を通ったことだけを見る。9MB を実際に R2 まで
    // 通すと、テスト環境の isolated storage が大きな書き込みで壊れるため
    // （実際に通ることは正常系テストが小さいファイルで担保している）
    const videoRes = await uploadVideo(cookie, eventId, {
      bytes: webmBytes(nineMb),
      durationMs: null,
    });
    expect(videoRes.status).toBe(400);
  });

  it("ポスターの上限は写真と同じ（サイズ超過 413・SVG 400）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const big = await uploadVideo(cookie, eventId, {
      poster: { bytes: new ArrayBuffer(EVENT_PHOTO_MAX_BYTES + 1), type: "image/png" },
    });
    expect(big.status).toBe(413);
    const svg = await uploadVideo(cookie, eventId, {
      poster: { bytes: PNG, type: "image/svg+xml" },
    });
    expect(svg.status).toBe(400);
  });

  it("本数上限は写真と共有の枠（50件で 409）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const stmt = env.DB.prepare(
      "INSERT INTO event_photo (id, event_id, user_id, created_at) SELECT ?, ?, id, ? FROM user LIMIT 1",
    );
    for (let i = 0; i < EVENT_PHOTO_LIMIT; i++) {
      await stmt.bind(crypto.randomUUID(), eventId, Date.now()).run();
    }
    const res = await uploadVideo(cookie, eventId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("photo_limit");
  });

  it("非メンバーは 403・未ログインは 401", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    // 別ユーザー（イベント非メンバー）
    const uid = crypto.randomUUID();
    const sid = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
    )
      .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
    )
      .bind(sid, uid, Date.now() + 86400000)
      .run();
    const outsider = await uploadVideo(`eventer_session=${sid}`, eventId);
    expect(outsider.status).toBe(403);
    const anon = await SELF.fetch(`${BASE}/api/events/${eventId}/videos`, {
      method: "POST",
      body: new FormData(),
    });
    expect(anon.status).toBe(401);
  });
});

describe("動画の配信 (Range 対応) と公開範囲", () => {
  /** 100 バイトの動画を上げて id を返す */
  async function setupVideo(
    cookie: string,
    eventId: string,
  ): Promise<string> {
    const res = await uploadVideo(cookie, eventId, { bytes: webmBytes(100) });
    expect(res.status).toBe(201);
    return ((await res.json()) as { photo: EventPhoto }).photo.id;
  }

  it("Range なしは 200 全量＋Accept-Ranges", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const id = await setupVideo(cookie, eventId);
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/photos/${id}/video`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("video/webm");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe("100");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("先頭・末尾・suffix の Range は 206＋Content-Range", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const id = await setupVideo(cookie, eventId);
    const url = `${BASE}/api/events/${eventId}/photos/${id}/video`;

    const head = await SELF.fetch(url, {
      headers: { cookie, range: "bytes=0-9" },
    });
    expect(head.status).toBe(206);
    expect(head.headers.get("content-range")).toBe("bytes 0-9/100");
    const headBody = new Uint8Array(await head.arrayBuffer());
    expect(headBody.length).toBe(10);
    // アップロード内容は i % 256 の連番（先頭4バイトだけ EBML マジック）
    expect([...headBody.slice(4)]).toEqual([4, 5, 6, 7, 8, 9]);

    const tail = await SELF.fetch(url, {
      headers: { cookie, range: "bytes=90-" },
    });
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe("bytes 90-99/100");
    expect((await tail.arrayBuffer()).byteLength).toBe(10);

    const suffix = await SELF.fetch(url, {
      headers: { cookie, range: "bytes=-10" },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 90-99/100");
    await suffix.arrayBuffer();
  });

  it("満たせない Range は 416", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const id = await setupVideo(cookie, eventId);
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/photos/${id}/video`,
      { headers: { cookie, range: "bytes=200-300" } },
    );
    expect(res.status).toBe(416);
  });

  it("If-None-Match が一致したら 304", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const id = await setupVideo(cookie, eventId);
    const url = `${BASE}/api/events/${eventId}/photos/${id}/video`;
    const first = await SELF.fetch(url, { headers: { cookie } });
    await first.arrayBuffer(); // R2 ストリームは読み切る（isolated storage 対策）
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    const second = await SELF.fetch(url, {
      headers: { cookie, "if-none-match": etag },
    });
    expect(second.status).toBe(304);
  });

  it("公開範囲は写真と同一: 非公開なら匿名 403、公開なら匿名 200", async () => {
    const cookie = await loginDev();
    const closed = await setupEvent(cookie);
    const closedId = await setupVideo(cookie, closed);
    for (const path of [`video`, `poster`]) {
      const res = await SELF.fetch(
        `${BASE}/api/events/${closed}/photos/${closedId}/${path}`,
      );
      expect(res.status, path).toBe(403);
    }

    const open = await setupEvent(cookie, true);
    const openId = await setupVideo(cookie, open);
    const anon = await SELF.fetch(
      `${BASE}/api/events/${open}/photos/${openId}/video`,
    );
    expect(anon.status).toBe(200);
    // R2 由来のストリームは読み切る（放置すると isolated storage の
    // 後片付けが「開きっぱなしの接続」で失敗する）
    await anon.arrayBuffer();
    const poster = await SELF.fetch(
      `${BASE}/api/events/${open}/photos/${openId}/poster`,
    );
    expect(poster.status).toBe(200);
    expect(poster.headers.get("content-type")).toBe("image/png");
    await poster.arrayBuffer();
  });

  it("写真の id に /video を叩いても 404（動画配信ルートに乗せない）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const up = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      method: "POST",
      headers: { "content-type": "image/png", cookie },
      body: PNG,
    });
    expect(up.status).toBe(201);
    const { photo } = (await up.json()) as { photo: EventPhoto };
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/photos/${photo.id}/video`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(404);
  });
});

describe("動画の削除", () => {
  it("削除すると R2 の本体とポスターが両方消える", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const res = await uploadVideo(cookie, eventId);
    const { photo } = (await res.json()) as { photo: EventPhoto };
    const videoKey = `event-videos/${eventId}/${photo.id}`;
    expect(await env.BUCKET.head(videoKey)).not.toBeNull();
    expect(await env.BUCKET.head(`${videoKey}-poster`)).not.toBeNull();

    const del = await SELF.fetch(
      `${BASE}/api/events/${eventId}/photos/${photo.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(del.status).toBe(200);
    expect(await env.BUCKET.head(videoKey)).toBeNull();
    expect(await env.BUCKET.head(`${videoKey}-poster`)).toBeNull();
    expect(
      await env.DB.prepare("SELECT COUNT(1) AS n FROM event_photo WHERE id = ?")
        .bind(photo.id)
        .first<{ n: number }>()
        .then((r) => r?.n),
    ).toBe(0);
  });
});
