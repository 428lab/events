import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import type { UserPhotosPage } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 公開プロフィールの写真ギャラリーのページングとフィルタ (#407)。
 *
 * これは公開 API（未ログイン可）なので、最重要リスクは下書き・非公開イベントの
 * 写真の漏えい。フィルタの新パラメータは公開範囲の条件（リポジトリの
 * PUBLIC_USER_PHOTO_COND）に AND されるだけであることを、
 * **下書きイベントの id を直接指定しても 0 件**になることで固定する。
 * facets（フィルタの選択肢）にも下書き・非公開イベントの名前が漏れないこと。
 */

/** dev-login してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** イベントを作る（作成直後は下書き）。photos_public は DB で直接立てる */
async function createEvent(cookie: string, title: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title,
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
  });
  expect(res.status).toBe(201);
  const { event } = (await res.json()) as { event: { id: string } };
  return event.id;
}

async function publish(cookie: string, eventId: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(res.status).toBe(200);
}

/** 写真の行を直接入れる（R2 の実体はこのテストでは見ないのでメタだけ） */
async function insertPhoto(
  id: string,
  eventId: string,
  userId: string,
  createdAt: number,
  adminHiddenAt: number | null = null,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_photo (id, event_id, user_id, created_at, admin_hidden_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, eventId, userId, createdAt, adminHiddenAt)
    .run();
}

interface Fixture {
  userId: string;
  /** 公開・写真公開・コミュニティ c1。写真2枚（1枚はコメントあり） */
  pubA: string;
  /** 公開・写真公開・コミュニティ無し。写真1枚 */
  pubB: string;
  /** 下書き（status=draft）・写真公開設定・コミュニティ c2。写真1枚 */
  draftE: string;
  /** 公開だが写真非公開（photos_public=0）。写真1枚 */
  privE: string;
  c1: string;
  c2: string;
}

let fx: Fixture;

/** 未ログインで公開ギャラリーを引く */
async function fetchPhotos(qs = ""): Promise<UserPhotosPage> {
  const res = await SELF.fetch(
    `${BASE}/api/public/users/${fx.userId}/photos${qs}`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as UserPhotosPage;
}

const ids = (page: UserPhotosPage) => page.photos.map((p) => p.id);

beforeAll(async () => {
  const cookie = await loginDev();
  const meRes = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  const { user } = (await meRes.json()) as { user: { id: string } };

  const pubA = await createEvent(cookie, "公開イベントA");
  const pubB = await createEvent(cookie, "公開イベントB");
  const draftE = await createEvent(cookie, "下書きイベント");
  const privE = await createEvent(cookie, "写真非公開イベント");
  await publish(cookie, pubA);
  await publish(cookie, pubB);
  await publish(cookie, privE);
  // draftE は公開しない（status=draft のまま）

  // コミュニティ2つ。c1 は公開イベントA、c2 は下書きイベントに紐づける
  const c1 = crypto.randomUUID();
  const c2 = crypto.randomUUID();
  for (const [id, slug, name] of [
    [c1, "pub-com", "公開コミュニティ"],
    [c2, "draft-com", "下書き側コミュニティ"],
  ] as const) {
    await env.DB.prepare(
      "INSERT INTO community (id, slug, name, owner_id, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(id, slug, name, user.id, Date.now())
      .run();
  }
  await env.DB.prepare(
    "UPDATE event SET photos_public = 1, community_id = ? WHERE id = ?",
  )
    .bind(c1, pubA)
    .run();
  await env.DB.prepare(
    "UPDATE event SET photos_public = 1 WHERE id = ?",
  )
    .bind(pubB)
    .run();
  // 下書きでも「写真公開」設定とコミュニティは付けておく。status の絞りだけが
  // 漏えいを防いでいる状態を作る（photos_public で偶然守られないように）
  await env.DB.prepare(
    "UPDATE event SET photos_public = 1, community_id = ? WHERE id = ?",
  )
    .bind(c2, draftE)
    .run();
  // 公開イベントだが写真は非公開のまま（photos_public は既定 0）

  // 写真: 公開Aに2枚（古い方にコメント）＋運営非表示1枚、公開Bに1枚、
  // 下書き・写真非公開に1枚ずつ
  await insertPhoto("pA1", pubA, user.id, 1000);
  await insertPhoto("pA2", pubA, user.id, 2000);
  await insertPhoto("pHidden", pubA, user.id, 2500, 9999);
  await insertPhoto("pB1", pubB, user.id, 3000);
  await insertPhoto("pDraft", draftE, user.id, 4000);
  await insertPhoto("pPriv", privE, user.id, 5000);

  // pA1 にコメント1件（コメントありのみフィルタ用）
  await env.DB.prepare(
    "INSERT INTO event_photo_comment (id, photo_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), "pA1", user.id, "いい写真", Date.now())
    .run();

  fx = { userId: user.id, pubA, pubB, draftE, privE, c1, c2 };
});

describe("下書き・非公開の写真が漏れない（最重要 #407）", () => {
  it("素の一覧は公開ぶんだけ（下書き・写真非公開・運営非表示は不在）", async () => {
    const page = await fetchPhotos();
    expect(ids(page)).toEqual(["pB1", "pA2", "pA1"]);
    expect(page.total).toBe(3);
  });

  it("下書きイベントの id を直接指定しても 0 件（公開条件は AND のまま）", async () => {
    const page = await fetchPhotos(`?eventId=${fx.draftE}`);
    expect(page.photos).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("写真非公開イベントの id 直指定も 0 件", async () => {
    const page = await fetchPhotos(`?eventId=${fx.privE}`);
    expect(page.photos).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("下書き側コミュニティの id 直指定も 0 件", async () => {
    const page = await fetchPhotos(`?communityId=${fx.c2}`);
    expect(page.photos).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("どのフィルタを組み合わせても下書き・非公開は出ない", async () => {
    for (const qs of [
      `?eventId=${fx.draftE}&commented=1`,
      `?eventId=${fx.draftE}&from=0&to=99999999999999`,
      `?communityId=${fx.c2}&commented=1`,
      "?from=3500", // 期間だけなら下書きの写真(4000)・非公開(5000)の時刻に重なる
    ]) {
      const page = await fetchPhotos(qs);
      expect(ids(page)).not.toContain("pDraft");
      expect(ids(page)).not.toContain("pPriv");
      expect(ids(page)).not.toContain("pHidden");
    }
  });

  it("facets にも下書き・非公開イベントとそのコミュニティは出ない", async () => {
    const { facets } = await fetchPhotos();
    expect(facets.events.map((e) => e.id).sort()).toEqual(
      [fx.pubA, fx.pubB].sort(),
    );
    const titles = facets.events.map((e) => e.title);
    expect(titles).not.toContain("下書きイベント");
    expect(titles).not.toContain("写真非公開イベント");
    expect(facets.communities.map((c) => c.id)).toEqual([fx.c1]);
    expect(facets.communities[0]).toEqual({
      id: fx.c1,
      name: "公開コミュニティ",
      count: 2,
    });
  });
});

describe("ページング (#407)", () => {
  it("page/limit/total/hasMore の契約（/events/search と同型）", async () => {
    const page1 = await fetchPhotos("?limit=2");
    expect(ids(page1)).toEqual(["pB1", "pA2"]);
    expect(page1).toMatchObject({ total: 3, page: 1, limit: 2, hasMore: true });

    const page2 = await fetchPhotos("?limit=2&page=2");
    expect(ids(page2)).toEqual(["pA1"]);
    expect(page2).toMatchObject({ total: 3, page: 2, limit: 2, hasMore: false });
  });

  it("limit は 50 に頭打ち・不正値は既定に落ちる", async () => {
    const big = await fetchPhotos("?limit=999");
    expect(big.limit).toBe(50);
    const bad = await fetchPhotos("?limit=abc&page=xyz");
    expect(bad.limit).toBe(24);
    expect(bad.page).toBe(1);
    expect(bad.total).toBe(3);
  });

  it("旧クライアント互換: photos キーは残る（素のリクエストで1ページ目が出る）", async () => {
    const page = await fetchPhotos();
    expect(Array.isArray(page.photos)).toBe(true);
    expect(page.photos[0]).toMatchObject({
      id: "pB1",
      eventId: fx.pubB,
      eventTitle: "公開イベントB",
    });
  });
});

describe("フィルタ (#407)", () => {
  it("イベント別", async () => {
    const page = await fetchPhotos(`?eventId=${fx.pubA}`);
    expect(ids(page)).toEqual(["pA2", "pA1"]);
    expect(page.total).toBe(2);
  });

  it("コミュニティ別", async () => {
    const page = await fetchPhotos(`?communityId=${fx.c1}`);
    expect(ids(page)).toEqual(["pA2", "pA1"]);
  });

  it("コメントありのみ", async () => {
    const page = await fetchPhotos("?commented=1");
    expect(ids(page)).toEqual(["pA1"]);
    expect(page.total).toBe(1);
  });

  it("期間（写真の投稿日時に対して効く）", async () => {
    expect(ids(await fetchPhotos("?from=1500"))).toEqual(["pB1", "pA2"]);
    expect(ids(await fetchPhotos("?to=1500"))).toEqual(["pA1"]);
    expect(ids(await fetchPhotos("?from=1500&to=2500"))).toEqual(["pA2"]);
  });

  it("組み合わせ（イベント×期間）と、フィルタ適用中も facets は母集団のまま", async () => {
    const page = await fetchPhotos(`?eventId=${fx.pubA}&from=1500`);
    expect(ids(page)).toEqual(["pA2"]);
    // 絞った結果で選択肢が痩せない（イベントBが選択肢から消えない）
    expect(page.facets.events.map((e) => e.id).sort()).toEqual(
      [fx.pubA, fx.pubB].sort(),
    );
  });
});

/**
 * 動画 (#408) も同じ公開範囲の断片（PUBLIC_USER_PHOTO_COND）に乗ることの固定。
 * 写真と別ユーザーで独立させ、上のフィクスチャの厳密一致を壊さない。
 * 断片から絞り（例: e.status = 'published'）を外すと、
 * ここの「不在」の検証が落ちる（#407 PR2 と同じ型の実証）。
 */
describe("動画も同じ公開範囲に乗る (#408)", () => {
  /** 動画の行を直接入れる（R2 実体はこのテストでは見ない） */
  async function insertVideo(
    id: string,
    eventId: string,
    userId: string,
    createdAt: number,
    adminHiddenAt: number | null = null,
  ): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO event_photo (id, event_id, user_id, created_at, admin_hidden_at, kind, duration_ms, bytes, mime) VALUES (?, ?, ?, ?, ?, 'video', 42000, 100, 'video/webm')",
    )
      .bind(id, eventId, userId, createdAt, adminHiddenAt)
      .run();
  }

  it("公開イベントの動画だけが kind つきで出る。下書き・写真非公開・運営非表示は不在", async () => {
    const uid = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
    )
      .bind(uid, `nostr:${uid}`, `v_${uid.slice(0, 6)}`, Date.now())
      .run();
    await insertVideo("vPub", fx.pubA, uid, 1000);
    await insertVideo("vDraft", fx.draftE, uid, 2000);
    await insertVideo("vPriv", fx.privE, uid, 3000);
    await insertVideo("vHidden", fx.pubA, uid, 4000, 9999);

    const res = await SELF.fetch(`${BASE}/api/public/users/${uid}/photos`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as UserPhotosPage;
    expect(page.photos.map((p) => p.id)).toEqual(["vPub"]);
    expect(page.total).toBe(1);
    expect(page.photos[0]).toMatchObject({ kind: "video", durationMs: 42000 });
    // facets にも下書き・非公開イベントの名前が漏れない
    expect(page.facets.events.map((e) => e.id)).toEqual([fx.pubA]);

    // 下書きイベントの id 直指定でも 0 件（公開条件は AND のまま）
    const direct = await SELF.fetch(
      `${BASE}/api/public/users/${uid}/photos?eventId=${fx.draftE}`,
    );
    const directPage = (await direct.json()) as UserPhotosPage;
    expect(directPage.photos).toEqual([]);
    expect(directPage.total).toBe(0);
  });
});
