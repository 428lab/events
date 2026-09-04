import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { bindEnv, type Env } from "../src/runtime.js";
import { deleteObjects } from "../src/lib/mediaCleanup.js";

const BASE = "https://example.com";

/**
 * イベント削除と R2 の実体の後始末 (#424)。固定したい契約:
 *
 * - イベントを消したら、そのイベントが持つ R2 オブジェクト（表紙画像・写真・
 *   動画の本体＋ポスター・景品画像）も消える。D1 は FK CASCADE で消えるが
 *   R2 は誰も消さないため、放っておくと全部が孤児になる
 * - 掃除の対象は **D1 から** 列挙する。運営が非表示にした写真 (#278) も含める
 *   （表示用の SELECT を通すと、非表示ぶんの実体だけが残る）
 * - 失敗方向は「孤児」であって「参照先が無い行」ではない。順序は
 *   キー収集 → D1 削除 → R2 削除（lib/mediaCleanup.ts の契約）。
 *   R2 が落ちても削除自体は成立させる
 */

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 公開イベントを作る（作成者は staff メンバー） */
async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "掃除E2E",
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
  });
  expect(create.status).toBe(201);
  return ((await create.json()) as { event: { id: string } }).event.id;
}

/** 1x1 の PNG（MIME 許可リストとマジックバイト検査を通る最小の実体） */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

/** WebM の先頭（EBML ヘッダ）を持つダミーバイト列 */
function webmBytes(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = i % 256;
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
}

async function putCoverImage(eventId: string, cookie: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/image`, {
    method: "PUT",
    headers: { cookie, "content-type": "image/png" },
    body: PNG,
  });
  expect(res.status).toBe(200);
}

async function uploadPhoto(eventId: string, cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
    method: "POST",
    headers: { cookie, "content-type": "image/png" },
    body: PNG,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { photo: { id: string } }).photo.id;
}

async function uploadVideo(eventId: string, cookie: string): Promise<string> {
  const form = new FormData();
  form.set("video", new File([webmBytes()], "v.webm", { type: "video/webm" }));
  form.set("poster", new File([PNG], "p.png", { type: "image/png" }));
  form.set("durationMs", "1000");
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/videos`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { photo: { id: string } }).photo.id;
}

/** 景品と画像を1件仕込む。景品作成 API は「出会い」機能を有効にした
 * イベントでしか通らないが、ここで確かめたいのは掃除なので行と実体を直接置く */
async function seedPrizeImage(eventId: string): Promise<string> {
  const prizeId = crypto.randomUUID();
  const key = `prize-images/${prizeId}/${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO event_prize
       (id, event_id, name, description, condition_type, threshold, stock, image_key, created_at)
     VALUES (?, ?, '景品', '', 'meet_count', 1, 1, ?, ?)`,
  )
    .bind(prizeId, eventId, key, Date.now())
    .run();
  await env.BUCKET.put(key, "prize-bytes");
  return key;
}

/** 画像を持たない景品（`image_key` が NULL）を1件仕込む。
 * 掃除用の SELECT が NULL を弾いていないと、キー配列に null が混ざって
 * R2 の multi-delete がまるごと失敗する（`deleteObjects` が握り潰すので
 * 静かに全部が孤児になる）。画像ありの景品と並べて置くことでその穴を塞ぐ */
async function seedPrizeWithoutImage(eventId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_prize
       (id, event_id, name, description, condition_type, threshold, stock, image_key, created_at)
     VALUES (?, ?, '画像なし景品', '', 'meet_count', 1, 1, NULL, ?)`,
  )
    .bind(crypto.randomUUID(), eventId, Date.now())
    .run();
}

/** 運営が非表示にした写真 (#278) にする */
async function hidePhoto(photoId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE event_photo SET admin_hidden_at = ? WHERE id = ?",
  )
    .bind(Date.now(), photoId)
    .run();
}

async function deleteEvent(eventId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}`, {
    method: "DELETE",
    headers: { cookie },
  });
}

async function rowCount(sql: string, ...args: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const coverKey = (eventId: string) => `event-images/${eventId}`;
const photoKey = (eventId: string, id: string) =>
  `event-photos/${eventId}/${id}`;
const videoKey = (eventId: string, id: string) =>
  `event-videos/${eventId}/${id}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("イベント削除で R2 の実体も消す (#424)", () => {
  it("表紙画像・写真・動画（本体＋ポスター）・景品画像がすべて消える", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await putCoverImage(eventId, cookie);
    const photoId = await uploadPhoto(eventId, cookie);
    const videoId = await uploadVideo(eventId, cookie);
    const prizeKey = await seedPrizeImage(eventId);
    // 画像を持たない景品 (#434) を混ぜる。列挙が NULL を弾いていないと
    // キー配列に null が入る。本番の R2 は null キーを受け付けず multi-delete が
    // まるごと落ちる（`deleteObjects` が握り潰すので静かに全部が孤児になる）が、
    // テスト環境の R2 は素通しするので「実体が消えたか」では捕まらない。
    // R2 に渡ったキーそのものを見る
    await seedPrizeWithoutImage(eventId);

    // 前提: 実体が揃っている
    expect(await env.BUCKET.head(coverKey(eventId))).not.toBeNull();
    expect(await env.BUCKET.head(photoKey(eventId, photoId))).not.toBeNull();
    expect(await env.BUCKET.head(videoKey(eventId, videoId))).not.toBeNull();
    expect(
      await env.BUCKET.head(`${videoKey(eventId, videoId)}-poster`),
    ).not.toBeNull();
    expect(await env.BUCKET.head(prizeKey)).not.toBeNull();

    const passedKeys: unknown[] = [];
    const originalDelete = env.BUCKET.delete.bind(env.BUCKET);
    vi.spyOn(env.BUCKET, "delete").mockImplementation(async (keys) => {
      passedKeys.push(...(Array.isArray(keys) ? keys : [keys]));
      return originalDelete(keys as string | string[]);
    });

    const res = await deleteEvent(eventId, cookie);
    expect(res.status).toBe(200);

    // R2 に渡すのは文字列のキーだけ（画像なしの景品ぶんの null を混ぜない）
    expect(passedKeys.length).toBeGreaterThan(0);
    expect(
      passedKeys.filter((k) => typeof k !== "string"),
      "R2 に文字列でないキーを渡している",
    ).toEqual([]);

    expect(await env.BUCKET.head(coverKey(eventId))).toBeNull();
    expect(await env.BUCKET.head(photoKey(eventId, photoId))).toBeNull();
    expect(await env.BUCKET.head(videoKey(eventId, videoId))).toBeNull();
    expect(
      await env.BUCKET.head(`${videoKey(eventId, videoId)}-poster`),
    ).toBeNull();
    expect(await env.BUCKET.head(prizeKey)).toBeNull();
    // D1 側は FK CASCADE
    expect(await rowCount("SELECT COUNT(1) AS n FROM event WHERE id = ?", eventId)).toBe(0);
    expect(
      await rowCount("SELECT COUNT(1) AS n FROM event_photo WHERE event_id = ?", eventId),
    ).toBe(0);
  });

  it("運営が非表示にした写真・動画の実体も消える（表示用の絞り込みを通さない）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const photoId = await uploadPhoto(eventId, cookie);
    const videoId = await uploadVideo(eventId, cookie);
    await hidePhoto(photoId);
    await hidePhoto(videoId);

    expect((await deleteEvent(eventId, cookie)).status).toBe(200);

    expect(await env.BUCKET.head(photoKey(eventId, photoId))).toBeNull();
    expect(await env.BUCKET.head(videoKey(eventId, videoId))).toBeNull();
    expect(
      await env.BUCKET.head(`${videoKey(eventId, videoId)}-poster`),
    ).toBeNull();
  });

  it("R2 の削除が落ちても削除は成立する（残るのは孤児であって、参照先の無い行ではない）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await putCoverImage(eventId, cookie);
    const photoId = await uploadPhoto(eventId, cookie);

    const spy = vi
      .spyOn(env.BUCKET, "delete")
      .mockRejectedValue(new Error("R2 down"));

    const res = await deleteEvent(eventId, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // 掃除を試みた上で握り潰していること（そもそも呼んでいないなら
    // 「落ちても成立する」は何も確かめていない）
    expect(spy).toHaveBeenCalled();
    // D1 の行は消えている（消せなかったことにして行を残すと、実体の無い
    // 参照が一覧に出続ける。孤児のほうが後から掃除できる）
    expect(await rowCount("SELECT COUNT(1) AS n FROM event WHERE id = ?", eventId)).toBe(0);
    expect(
      await rowCount("SELECT COUNT(1) AS n FROM event_photo WHERE event_id = ?", eventId),
    ).toBe(0);
    // 実体は残る（孤児）
    expect(await env.BUCKET.head(coverKey(eventId))).not.toBeNull();
    expect(await env.BUCKET.head(photoKey(eventId, photoId))).not.toBeNull();
  });

  it("R2 を消しに行く時点で D1 の行は既に消えている（順序そのものを固定する）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await uploadPhoto(eventId, cookie);

    // R2 の削除が呼ばれた瞬間に event 行がまだ在るかを記録する。
    // R2 が先だと「実体は消えたのに行が残っている」状態が一瞬でも生まれ、
    // そこで D1 が落ちれば参照先の無い行が確定する
    const eventRowsAtDelete: number[] = [];
    const original = env.BUCKET.delete.bind(env.BUCKET);
    vi.spyOn(env.BUCKET, "delete").mockImplementation(async (keys) => {
      eventRowsAtDelete.push(
        await rowCount("SELECT COUNT(1) AS n FROM event WHERE id = ?", eventId),
      );
      return original(keys as string | string[]);
    });

    expect((await deleteEvent(eventId, cookie)).status).toBe(200);
    expect(eventRowsAtDelete).toEqual([0]);
  });
});

describe("表紙画像の単体削除でも実体を残さない (#424)", () => {
  it("R2 を消しに行く時点で D1 の行は既に消えている（順序そのものを固定する）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await putCoverImage(eventId, cookie);

    const rowsAtDelete: number[] = [];
    const original = env.BUCKET.delete.bind(env.BUCKET);
    vi.spyOn(env.BUCKET, "delete").mockImplementation(async (keys) => {
      rowsAtDelete.push(
        await rowCount(
          "SELECT COUNT(1) AS n FROM event_image WHERE event_id = ?",
          eventId,
        ),
      );
      return original(keys as string | string[]);
    });

    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/image`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(rowsAtDelete).toEqual([0]);
  });

  it("R2 の削除が落ちても ok を返し、D1 の行は消える", async () => {
    // #424 以前は R2 の失敗がそのまま 500 になり、行だけ消えた状態で
    // 呼び出し側にはエラーが返っていた。今は他の削除経路と同じ
    // ベストエフォート（握り潰して孤児に倒す）に揃えてある。
    // 意図した契約なので、握り潰していること自体をここで固定する
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await putCoverImage(eventId, cookie);
    expect(
      await rowCount("SELECT COUNT(1) AS n FROM event_image WHERE event_id = ?", eventId),
    ).toBe(1);

    const spy = vi
      .spyOn(env.BUCKET, "delete")
      .mockRejectedValue(new Error("R2 down"));

    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/image`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    // 参照（D1）は消える。残るのは誰からも参照されない実体だけ
    expect(
      await rowCount("SELECT COUNT(1) AS n FROM event_image WHERE event_id = ?", eventId),
    ).toBe(0);
    expect(await env.BUCKET.head(coverKey(eventId))).not.toBeNull();
  });
});

describe("写真1枚の削除でも実体を残さない (#424)", () => {
  it("動画は本体とポスターの両方が消え、R2 を消す時点で行は既に消えている", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const videoId = await uploadVideo(eventId, cookie);

    // イベント削除と同じ順序（行 → 実体）であることを、削除の瞬間の行数で見る
    const rowsAtDelete: number[] = [];
    const original = env.BUCKET.delete.bind(env.BUCKET);
    vi.spyOn(env.BUCKET, "delete").mockImplementation(async (keys) => {
      rowsAtDelete.push(
        await rowCount("SELECT COUNT(1) AS n FROM event_photo WHERE id = ?", videoId),
      );
      return original(keys as string | string[]);
    });

    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/photos/${videoId}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(res.status).toBe(200);
    expect(rowsAtDelete).toEqual([0]);
    expect(await env.BUCKET.head(videoKey(eventId, videoId))).toBeNull();
    expect(
      await env.BUCKET.head(`${videoKey(eventId, videoId)}-poster`),
    ).toBeNull();
    expect(
      await rowCount("SELECT COUNT(1) AS n FROM event_photo WHERE id = ?", videoId),
    ).toBe(0);
  });

  it("R2 の削除が落ちても行は消える（参照先の無い行を作らない）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const videoId = await uploadVideo(eventId, cookie);

    vi.spyOn(env.BUCKET, "delete").mockRejectedValue(new Error("R2 down"));

    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/photos/${videoId}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(res.status).toBe(200);
    expect(
      await rowCount("SELECT COUNT(1) AS n FROM event_photo WHERE id = ?", videoId),
    ).toBe(0);
    expect(await env.BUCKET.head(videoKey(eventId, videoId))).not.toBeNull();
  });
});

describe("deleteObjects の分割契約 (#424)", () => {
  /** 本番の R2 は multi-delete 1回につき 1000 キーまでで、超えると丸ごと拒否する。
   * テスト環境の R2 は何個でも受け取るので、「実体が消えたか」を見ても
   * 上限超えには気づけない（`deleteObjects` は例外を握り潰すため、
   * 本番では全部が静かに孤児になる）。R2 に渡した配列そのものを見る。
   *
   * 返り値の回数も同時に固定する。退会の掃除 (#244) はこれをサブリクエスト
   * 予算に積んでおり、少なく返すと MIN_COST_PER_USER の見積もりが壊れて
   * 上限 50 を超え、同じリクエスト内の以降の呼び出しが全部失敗する */
  it("1回の delete に 1000 キーを超えて渡さず、投げた回数を返す", async () => {
    bindEnv(env as unknown as Env);
    const keys = Array.from(
      { length: 2500 },
      (_, i) => `event-photos/e/${i}`,
    );
    const sizes: number[] = [];
    vi.spyOn(env.BUCKET, "delete").mockImplementation(async (k) => {
      sizes.push(Array.isArray(k) ? k.length : 1);
    });

    const calls = await deleteObjects(keys, "[test]");

    expect(Math.max(...sizes)).toBeLessThanOrEqual(1000);
    expect(sizes).toEqual([1000, 1000, 500]);
    // 予算に積む数＝実際に投げた回数
    expect(calls).toBe(3);
    expect(calls).toBe(sizes.length);
  });

  it("空配列ならサブリクエストを使わず 0 を返す", async () => {
    bindEnv(env as unknown as Env);
    const spy = vi.spyOn(env.BUCKET, "delete");
    expect(await deleteObjects([], "[test]")).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("失敗しても投げた回数を返す（予算は必ず積まれる）", async () => {
    bindEnv(env as unknown as Env);
    vi.spyOn(env.BUCKET, "delete").mockRejectedValue(new Error("R2 down"));
    expect(await deleteObjects(["event-images/e"], "[test]")).toBe(1);
  });
});
