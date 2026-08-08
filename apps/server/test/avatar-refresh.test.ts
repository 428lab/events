import { SELF, env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "https://example.com";

/** 連携先が返すアイコン本体。中身は問わないのでバイト列が区別できれば十分 */
const IMAGE_A = "IMAGE-BYTES-A";
const IMAGE_B = "IMAGE-BYTES-B-DIFFERENT";

/** X のプロフィール応答。テストごとに差し替える（intercept 自体は使い回す） */
let xProfile: Record<string, unknown> = {};

let seq = 0;
/** 連携先の識別子とアイコン配信ホストをテストごとに変える。
 * ホストを分けるのは、undici のモックが origin ごとに独立していて
 * テスト間で intercept が干渉しないため */
function newCase() {
  seq += 1;
  return {
    providerUserId: `x-user-${seq}`,
    /** プロバイダ側で _normal → _400x400 に差し替えられる (auth/providers.ts) */
    sourceUrl: `https://avatars-${seq}.example.net/icon_normal.png`,
    origin: `https://avatars-${seq}.example.net`,
    path: "/icon_400x400.png",
    /** プロバイダが実際に保存するURL（_400x400 へ差し替えたあと） */
    fetchedUrl: `https://avatars-${seq}.example.net/icon_400x400.png`,
  };
}

/** X のプロフィールが返すアイコンURLを設定する */
function setXProfile(providerUserId: string, avatarUrl: string | null) {
  xProfile = {
    id: providerUserId,
    name: "テスト太郎",
    username: `xuser${providerUserId.replace(/\D/g, "")}`,
    ...(avatarUrl ? { profile_image_url: avatarUrl } : {}),
  };
}

/** アイコン本体の配信を差し替える */
function mockAvatar(
  origin: string,
  path: string,
  status: number,
  body: string | Uint8Array,
  headers: Record<string, string> = { "content-type": "image/png" },
) {
  fetchMock
    .get(origin)
    .intercept({ path })
    .reply(status, body, { headers })
    .persist();
}

/** X でログインする（新規なら作成、既存ならログイン）。callback の応答を返す */
async function loginWithX(): Promise<Response> {
  const login = await SELF.fetch(`${BASE}/api/auth/x/login`, {
    redirect: "manual",
  });
  const cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const state = new URL(login.headers.get("location")!).searchParams.get(
    "state",
  );
  return SELF.fetch(`${BASE}/api/auth/x/callback?code=dummy&state=${state}`, {
    headers: { cookie },
    redirect: "manual",
  });
}

interface Row {
  id: string;
  avatar_url: string | null;
  avatar_image_updated_at: number | null;
  avatar_image_mime: string | null;
  avatar_image_hash: string | null;
}

async function userRow(userId: string): Promise<Row | null> {
  return env.DB.prepare("SELECT * FROM user WHERE id = ?")
    .bind(userId)
    .first<Row>();
}

/** identity から、その provider_user_id のユーザー行を引く */
async function userByProvider(providerUserId: string): Promise<Row> {
  const row = await env.DB.prepare(
    "SELECT user_id FROM identity WHERE provider = 'x' AND provider_user_id = ?",
  )
    .bind(providerUserId)
    .first<{ user_id: string }>();
  if (!row) throw new Error(`no identity for ${providerUserId}`);
  const user = await userRow(row.user_id);
  if (!user) throw new Error(`no user for ${providerUserId}`);
  return user;
}

const bodyOf = async (path: string) =>
  (await SELF.fetch(`${BASE}${path}`)).text();

beforeAll(() => {
  fetchMock.activate();
  // 意図しない外向き通信をテストで踏まないようにする
  fetchMock.disableNetConnect();
  // X の OAuth（トークン交換＋プロフィール取得）は全テストで使い回し、
  // 応答内容だけ xProfile で差し替える
  const x = fetchMock.get("https://api.x.com");
  x.intercept({ path: "/2/oauth2/token", method: "POST" })
    .reply(200, () => ({ access_token: "test-token" }))
    .persist();
  x.intercept({ path: (p: string) => p.startsWith("/2/users/me") })
    .reply(200, () => ({ data: xProfile }))
    .persist();
});

describe("連携先アイコンの取り込みと配信 (#312)", () => {
  it("ログイン時に取り込み、avatar_url を自ドメインのURLに差し替える", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);

    await loginWithX();

    const row = await userByProvider(t.providerUserId);
    expect(row.avatar_url).toBe(
      `/api/users/${row.id}/avatar?v=${row.avatar_image_updated_at}`,
    );
    // 連携先のホストは URL に一切残らない（変更されても 404 にならない）
    expect(row.avatar_url).not.toContain("example.net");
    expect(row.avatar_image_mime).toBe("image/png");
    expect(row.avatar_image_hash).toMatch(/^[0-9a-f]{64}$/);

    // 自分のドメインから同じバイト列が返る
    const img = await SELF.fetch(`${BASE}${row.avatar_url}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await img.text()).toBe(IMAGE_A);
  });

  it("連携先でアイコンが変わったら、2回目のログインで差し替わる（未設定時だけの補完ではない）", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await loginWithX();
    const before = await userByProvider(t.providerUserId);
    expect(await bodyOf(before.avatar_url!)).toBe(IMAGE_A);

    // 連携先がアイコンを差し替えた（URLも中身も変わる）
    const t2 = newCase();
    setXProfile(t.providerUserId, t2.sourceUrl);
    mockAvatar(t2.origin, t2.path, 200, IMAGE_B);
    await loginWithX();

    const after = await userByProvider(t.providerUserId);
    expect(after.id).toBe(before.id); // 同じユーザーで再ログインしている
    expect(after.avatar_image_hash).not.toBe(before.avatar_image_hash);
    // 更新時刻が進む＝配信URLの ?v= が変わり、クライアントが取り直す
    expect(after.avatar_image_updated_at).toBeGreaterThan(
      before.avatar_image_updated_at!,
    );
    expect(after.avatar_url).not.toBe(before.avatar_url);
    expect(await bodyOf(after.avatar_url!)).toBe(IMAGE_B);
    // 旧URLを掴んでいるクライアントにも新しい画像が返る（古い画像は残らない）
    expect(await bodyOf(before.avatar_url!)).toBe(IMAGE_B);
  });

  it("中身が同じなら更新時刻を進めない（毎ログインで再ダウンロードさせない）", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await loginWithX();
    const before = await userByProvider(t.providerUserId);

    await loginWithX();
    const after = await userByProvider(t.providerUserId);
    expect(after.avatar_image_updated_at).toBe(before.avatar_image_updated_at);
    expect(after.avatar_url).toBe(before.avatar_url);
  });

  it("取得に失敗してもログインは成功し、既存のアイコンが残る", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await loginWithX();
    const before = await userByProvider(t.providerUserId);

    // 連携先のアイコンURLが 404 になった（アイコン差し替え後の旧URL相当）。
    // content-type は image/png のまま（エラーページを画像として掴まないこと）
    const t2 = newCase();
    setXProfile(t.providerUserId, t2.sourceUrl);
    mockAvatar(t2.origin, t2.path, 404, "not found");
    const res = await loginWithX();

    // ログインは通る（セッション発行＋/me へのリダイレクト）
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/me");
    expect(
      res.headers.getSetCookie().some((v) => v.startsWith("eventer_session=")),
    ).toBe(true);
    const after = await userByProvider(t.providerUserId);
    expect(after.avatar_url).toBe(before.avatar_url);
    expect(after.avatar_image_updated_at).toBe(before.avatar_image_updated_at);
    // 保管済みの画像はそのまま配信できる
    expect(await bodyOf(after.avatar_url!)).toBe(IMAGE_A);
  });

  it("連携先が落ちていてもログインは成功する", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    fetchMock
      .get(t.origin)
      .intercept({ path: t.path })
      .replyWithError(new Error("connection refused"))
      .persist();

    const res = await loginWithX();
    expect(res.status).toBe(302);
    const row = await userByProvider(t.providerUserId);
    expect(row.avatar_image_updated_at).toBeNull();
    // 取り込めなかった新規ユーザーは連携先のURLのまま（従来どおりの見え方）
    expect(row.avatar_url).toBe(t.fetchedUrl);
    const img = await SELF.fetch(`${BASE}/api/users/${row.id}/avatar`);
    expect(img.status).toBe(404);
    await img.arrayBuffer();
  });

  it("画像でない Content-Type は取り込まない（SVG も含む）", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, "<svg onload=alert(1)></svg>", {
      "content-type": "image/svg+xml",
    });

    const res = await loginWithX();
    expect(res.status).toBe(302);
    expect(
      (await userByProvider(t.providerUserId)).avatar_image_updated_at,
    ).toBeNull();
  });

  it("上限を超える画像は取り込まない", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, new Uint8Array(1024 * 1024 + 16));

    const res = await loginWithX();
    expect(res.status).toBe(302);
    expect(
      (await userByProvider(t.providerUserId)).avatar_image_updated_at,
    ).toBeNull();
  });

  it("Content-Length を詐称した巨大レスポンスも取り込まない", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    // 申告は 16B、実体は 1MB 超。ヘッダを信じて丸ごと読むと上限が効かない
    mockAvatar(t.origin, t.path, 200, new Uint8Array(1024 * 1024 + 16), {
      "content-type": "image/png",
      "content-length": "16",
    });

    const res = await loginWithX();
    expect(res.status).toBe(302);
    expect(
      (await userByProvider(t.providerUserId)).avatar_image_updated_at,
    ).toBeNull();
  });

  it("http のアイコンURLは取りに行かない（Nostr の kind:0 は本人が中身を書ける）", async () => {
    const t = newCase();
    const httpUrl = t.sourceUrl.replace("https://", "http://");
    setXProfile(t.providerUserId, httpUrl);
    // http でも取得できる状態にしておく。それでも取り込まれないことを見る
    // （https 限定のガードを外すと、ここが取り込まれてテストが落ちる）
    mockAvatar(t.origin.replace("https://", "http://"), t.path, 200, IMAGE_A);
    const res = await loginWithX();
    expect(res.status).toBe(302);
    expect(
      (await userByProvider(t.providerUserId)).avatar_image_updated_at,
    ).toBeNull();
  });

  it("配信は ETag で 304 を返す", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await loginWithX();
    const row = await userByProvider(t.providerUserId);

    const first = await SELF.fetch(`${BASE}${row.avatar_url}`);
    const etag = first.headers.get("etag")!;
    // R2 のストリームを開いたままにしない（テスト間のストレージ隔離が壊れる）
    await first.arrayBuffer();
    expect(etag).toBe(`"${row.avatar_image_updated_at}"`);
    const second = await SELF.fetch(`${BASE}${row.avatar_url}`, {
      headers: { "if-none-match": etag },
    });
    expect(second.status).toBe(304);
  });

  it("退会申請中のアイコンは配信しない", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await loginWithX();
    const row = await userByProvider(t.providerUserId);

    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), row.id)
      .run();
    const res = await SELF.fetch(`${BASE}${row.avatar_url}`);
    expect(res.status).toBe(404);
    await res.arrayBuffer();
  });

  it("完全削除でアイコンの実体も片付く", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await loginWithX();
    const row = await userByProvider(t.providerUserId);
    // head を使う（get はボディのストリームが開いたままになり、
    // テスト間のストレージ隔離の後片付けに失敗する）
    expect(await env.BUCKET.head(`avatars/${row.id}`)).not.toBeNull();

    // 猶予期間 (#250) を過ぎた状態にして日次バッチを走らせる
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now() - 400 * 24 * 3600 * 1000, row.id)
      .run();
    const purge = await SELF.fetch(`${BASE}/api/cron/purge-deleted`, {
      method: "POST",
      headers: { "x-cron-key": "test-cron-secret" },
    });
    expect(purge.status).toBe(200);
    await purge.arrayBuffer();

    expect(await userRow(row.id)).toBeNull();
    expect(await env.BUCKET.head(`avatars/${row.id}`)).toBeNull();
  });
});
