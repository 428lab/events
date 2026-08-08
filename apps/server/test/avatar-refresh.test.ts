import {
  SELF,
  env,
  fetchMock,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const BASE = "https://example.com";

/** PNG のシグネチャ。宣言 MIME と実バイト列の突き合わせ (#313) を通すために
 * 本物の先頭バイトが要る。以降のバイトは区別さえつけば中身は問わない */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG として通るバイト列を作る（tag で中身を区別する） */
function pngBytes(tag: string, extra = 0): Uint8Array {
  const tail = [...tag].map((ch) => ch.charCodeAt(0));
  return new Uint8Array([...PNG_MAGIC, ...tail, ...new Array(extra).fill(0)]);
}

/** 連携先が返すアイコン本体。中身は問わないのでバイト列が区別できれば十分 */
const IMAGE_A = pngBytes("IMAGE-BYTES-A");
const IMAGE_B = pngBytes("IMAGE-BYTES-B-DIFFERENT");

/** レスポンス本文を IMAGE_A / IMAGE_B と比較するための文字列化 */
const asText = (b: Uint8Array) => new TextDecoder().decode(b);

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

/** worker を直接叩く。SELF.fetch ではなくこちらを使うのは、アイコンの取り込みが
 * waitUntil に載っている (#313) ため、waitOnExecutionContext で完了を待たないと
 * 「取り込まれたか」を安定して検証できないから（sleep 待ちは遅いCIで偽グリーンになる） */
async function hit(path: string, init: RequestInit = {}): Promise<Response> {
  const { default: worker } = await import("../src/worker.js");
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${BASE}${path}`, { redirect: "manual", ...init }),
    env as never,
    ctx,
  );
  // ここが返った時点でバックグラウンドの取り込みも完了している
  await waitOnExecutionContext(ctx);
  return res;
}

/** X でログインする（新規なら作成、既存ならログイン）。callback の応答を返す */
async function loginWithX(): Promise<Response> {
  const login = await hit("/api/auth/x/login");
  const cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const state = new URL(login.headers.get("location")!).searchParams.get(
    "state",
  );
  return hit(`/api/auth/x/callback?code=dummy&state=${state}`, {
    headers: { cookie },
  });
}

/** Nostr のイベントに署名する（kind と content は呼び出し側が決める） */
function signEvent(
  sk: Uint8Array,
  kind: number,
  tags: string[][],
  content: string,
): object {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const created_at = Math.floor(Date.now() / 1000);
  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { id, pubkey, sig, kind, created_at, tags, content };
}

/** Nostr でログインしてセッション cookie を返す */
async function loginWithNostr(sk: Uint8Array): Promise<string> {
  const res = await hit("/api/auth/nostr/challenge");
  const { challenge } = (await res.json()) as { challenge: string };
  const event = signEvent(
    sk,
    22242,
    [
      ["relay", BASE],
      ["challenge", challenge],
    ],
    "",
  );
  const login = await hit("/api/auth/nostr/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  });
  await login.arrayBuffer();
  return login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}

/** kind:0（プロフィール）を投げてアイコンの取り込みを走らせる */
async function postNostrProfile(
  sk: Uint8Array,
  cookie: string,
  picture: string,
): Promise<Response> {
  const event = signEvent(sk, 0, [], JSON.stringify({ name: "n", picture }));
  const res = await hit("/api/auth/nostr/profile", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ event }),
  });
  await res.arrayBuffer();
  return res;
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
    // ?v= 付きのURLは中身が変わらないので長くキャッシュさせる (#313)
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(await img.text()).toBe(asText(IMAGE_A));
  });

  it("連携先でアイコンが変わったら、2回目のログインで差し替わる（未設定時だけの補完ではない）", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await loginWithX();
    const before = await userByProvider(t.providerUserId);
    expect(await bodyOf(before.avatar_url!)).toBe(asText(IMAGE_A));

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
    expect(await bodyOf(after.avatar_url!)).toBe(asText(IMAGE_B));
    // 旧URL（古い ?v=）でも 404 にはならない。中身はその ?v= の時点のものが
    // 返り得る（エッジキャッシュに載るため #313）が、avatar_url は D1 から
    // 読まれるので、次に画面を開いた時点で新しい ?v= のURLに切り替わる
    const stale = await SELF.fetch(`${BASE}${before.avatar_url}`);
    expect(stale.status).toBe(200);
    await stale.arrayBuffer();
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
    expect(await bodyOf(after.avatar_url!)).toBe(asText(IMAGE_A));
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

  it("リダイレクトで http やローカルアドレスへ飛ばされたら取り込まない", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    // 公開ホスト → 302 → 内部アドレス。ホップごとに再検証していないと、
    // https 限定のガードを 302 ひとつで迂回できてしまう
    fetchMock
      .get(t.origin)
      .intercept({ path: t.path })
      .reply(302, "", { headers: { location: "http://169.254.169.254/latest" } })
      .persist();

    const res = await loginWithX();
    expect(res.status).toBe(302);
    expect(
      (await userByProvider(t.providerUserId)).avatar_image_updated_at,
    ).toBeNull();
  });

  it("リダイレクト先が https でもローカルアドレスなら取り込まない", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    fetchMock
      .get(t.origin)
      .intercept({ path: t.path })
      .reply(302, "", { headers: { location: "https://169.254.169.254/" } })
      .persist();

    const res = await loginWithX();
    expect(res.status).toBe(302);
    expect(
      (await userByProvider(t.providerUserId)).avatar_image_updated_at,
    ).toBeNull();
  });

  it("Content-Type が image/png でも中身が画像でなければ取り込まない", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    // 宣言だけ画像にして任意のバイト列を自ドメインでホストさせる手口を塞ぐ
    mockAvatar(t.origin, t.path, 200, "<html>not an image</html>");

    const res = await loginWithX();
    expect(res.status).toBe(302);
    expect(
      (await userByProvider(t.providerUserId)).avatar_image_updated_at,
    ).toBeNull();
  });

  it("取り込み元のURLを残す（切り戻せるようにする）", async () => {
    const t = newCase();
    setXProfile(t.providerUserId, t.sourceUrl);
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await loginWithX();

    const row = await env.DB.prepare(
      `SELECT u.avatar_source_url AS src FROM user u
         JOIN identity i ON i.user_id = u.id
        WHERE i.provider = 'x' AND i.provider_user_id = ?`,
    )
      .bind(t.providerUserId)
      .first<{ src: string | null }>();
    // avatar_url は自ドメインのURLで上書きされるので、元のURLはここにしか残らない
    expect(row!.src).toBe(t.fetchedUrl);
  });

  it("プロフィール更新の連打では取り込み直さない（毎回違う画像でも）", async () => {
    const sk = schnorr.utils.randomSecretKey();
    const cookie = await loginWithNostr(sk);
    const t = newCase();
    mockAvatar(t.origin, t.path, 200, IMAGE_A);
    await postNostrProfile(sk, cookie, t.fetchedUrl);

    const userId = (
      await env.DB.prepare(
        "SELECT user_id FROM identity WHERE provider = 'nostr' AND provider_user_id = ?",
      )
        .bind(bytesToHex(schnorr.getPublicKey(sk)))
        .first<{ user_id: string }>()
    )!.user_id;
    const before = await userRow(userId);
    expect(before!.avatar_image_updated_at).not.toBeNull();

    // 取得元URLは本人が自由に書けるので、毎回違うバイト列を返すURLを指定すれば
    // ハッシュ比較が効かず「1MB取得＋R2 put＋D1 update」を連打できてしまう
    const t2 = newCase();
    mockAvatar(t2.origin, t2.path, 200, IMAGE_B);
    await postNostrProfile(sk, cookie, t2.fetchedUrl);

    const after = await userRow(userId);
    expect(after!.avatar_image_updated_at).toBe(before!.avatar_image_updated_at);
    expect(after!.avatar_image_hash).toBe(before!.avatar_image_hash);
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
