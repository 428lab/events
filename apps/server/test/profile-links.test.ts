import { SELF, env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { npubEncode, profileLinkFor } from "@eventer/shared";

/**
 * 公開プロフィールの連携アカウントリンク (docs/profile-social-links.md)。
 * オプトイン（既定オフ）・本人だけが切り替えられる・オフの連携の ID は公開APIに出ない、
 * を見張る。
 */

const BASE = "https://example.com";

async function makeUser(): Promise<{ userId: string; cookie: string; handle: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const handle = `pl_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, `t:${uid}`, handle, Date.now())
    .run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}`, handle };
}

async function addIdentity(
  userId: string,
  provider: string,
  providerUserId: string,
  publicHandle: string | null,
  email: string | null = null,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at, public_handle) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), userId, provider, providerUserId, email, Date.now(), publicHandle)
    .run();
}

const PUBKEY = "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";
const DID = "did:plc:abcdefghijklmnopqrstuvwx";

async function profile(handle: string) {
  const res = await SELF.fetch(`${BASE}/api/public/users/${handle}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { links: { provider: string; url: string; label: string }[] };
}

async function setPublic(cookie: string, provider: string, profilePublic: boolean) {
  return SELF.fetch(`${BASE}/api/auth/identities/${provider}/profile-public`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ profilePublic }),
  });
}

/** 6種類の連携を1人に付ける。provider_user_id は UNIQUE なので人ごとに変える */
async function seedAll(userId: string) {
  const n = userId.replace(/-/g, "");
  await addIdentity(userId, "github", `gh-${n}`, "octo-cat", "secret@example.com");
  await addIdentity(userId, "x", `${parseInt(n.slice(0, 8), 16)}`, "x_user");
  await addIdentity(userId, "bluesky", `did:web:${n}.example`, "alice.bsky.social");
  await addIdentity(userId, "nostr", (n + n).slice(0, 64), null);
  await addIdentity(userId, "google", `g-${n}`, null, "google@example.com");
  await addIdentity(userId, "discord", `d-${n}`, "disco");
}

describe("公開プロフィールの連携アカウントリンク", () => {
  it("既定はオフ: 連携があっても公開プロフィールにリンクも ID も出ない", async () => {
    const u = await makeUser();
    await seedAll(u.userId);
    const res = await SELF.fetch(`${BASE}/api/public/users/${u.handle}`);
    const text = await res.text();
    const body = JSON.parse(text) as { links: unknown[] };
    expect(body.links).toEqual([]);
    // オフの連携の ID・メール・名前は応答のどこにも出ない
    for (const leaked of ["octo-cat", "x_user", "alice.bsky.social", "secret@example.com", "google@example.com", "disco", `gh-${u.userId.replace(/-/g, "")}`]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("本人がオンにした連携だけ、連携先ごとの URL で出る（未ログインでも見える）", async () => {
    const u = await makeUser();
    await addIdentity(u.userId, "github", `gh-${u.userId}`, "octo-cat");
    await addIdentity(u.userId, "x", "1234567890123", "x_user");
    await addIdentity(u.userId, "bluesky", DID, "alice.bsky.social");
    await addIdentity(u.userId, "nostr", PUBKEY, null);

    expect((await setPublic(u.cookie, "github", true)).status).toBe(200);
    expect((await setPublic(u.cookie, "bluesky", true)).status).toBe(200);
    expect((await setPublic(u.cookie, "nostr", true)).status).toBe(200);

    const { links } = await profile(u.handle);
    expect(links).toEqual([
      { provider: "github", url: "https://github.com/octo-cat", label: "@octo-cat" },
      { provider: "bluesky", url: `https://bsky.app/profile/${DID}`, label: "@alice.bsky.social" },
      expect.objectContaining({ provider: "nostr", url: `https://njump.me/${npubEncode(PUBKEY)}` }),
    ]);
    // X はオフのまま → 出ない
    expect(links.some((l) => l.provider === "x")).toBe(false);

    // オフに戻すとすぐ消える
    expect((await setPublic(u.cookie, "github", false)).status).toBe(200);
    expect((await profile(u.handle)).links.map((l) => l.provider)).toEqual(["bluesky", "nostr"]);
  });

  it("他人の連携は切り替えられない（自分に無い連携は 404）", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await addIdentity(owner.userId, "github", `gh-${owner.userId}`, "owner-gh");
    // other は github を連携していないので、自分の行が無い → 404。owner の行は動かない
    expect((await setPublic(other.cookie, "github", true)).status).toBe(404);
    expect((await profile(owner.handle)).links).toEqual([]);
    // 未ログインは 401
    expect((await setPublic("", "github", true)).status).toBe(401);
  });

  it("リンクを出せない連携先（Google・Discord）はオンにできない", async () => {
    const u = await makeUser();
    await addIdentity(u.userId, "google", `g-${u.userId}`, null, "g@example.com");
    await addIdentity(u.userId, "discord", `d-${u.userId}`, "disco");
    expect((await setPublic(u.cookie, "google", true)).status).toBe(400);
    expect((await setPublic(u.cookie, "discord", true)).status).toBe(400);
    // 直接 DB でオンにしても、公開APIはリンクを作れない連携を出さない
    await env.DB.prepare("UPDATE identity SET profile_public = 1 WHERE user_id = ?").bind(u.userId).run();
    expect((await profile(u.handle)).links).toEqual([]);
  });

  it("本人の連携一覧に、公開状態と出したときのリンクが付く", async () => {
    const u = await makeUser();
    await addIdentity(u.userId, "github", `gh-${u.userId}`, "octo-cat");
    await addIdentity(u.userId, "google", `g-${u.userId}`, null, "g@example.com");
    const res = await SELF.fetch(`${BASE}/api/auth/identities`, { headers: { cookie: u.cookie } });
    const { identities } = (await res.json()) as {
      identities: { provider: string; profilePublic: boolean; profileLink: { url: string } | null }[];
    };
    expect(identities.find((i) => i.provider === "github")).toMatchObject({
      profilePublic: false,
      profileLink: { url: "https://github.com/octo-cat" },
    });
    expect(identities.find((i) => i.provider === "google")).toMatchObject({ profilePublic: false, profileLink: null });
  });

  it("連携を解除するとリンクも消える", async () => {
    const u = await makeUser();
    await addIdentity(u.userId, "github", `gh-${u.userId}`, "octo-cat");
    await addIdentity(u.userId, "nostr", PUBKEY.replace(/^7e/, "6e"), null);
    await setPublic(u.cookie, "github", true);
    expect((await profile(u.handle)).links.map((l) => l.provider)).toEqual(["github"]);
    const del = await SELF.fetch(`${BASE}/api/auth/identities/github`, {
      method: "DELETE",
      headers: { cookie: u.cookie },
    });
    expect(del.status).toBe(200);
    expect((await profile(u.handle)).links).toEqual([]);
  });

  it("アカウント統合では、公開の選択ごと連携が勝ち側へ移る", async () => {
    const loser = await makeUser();
    const winner = await makeUser();
    await addIdentity(loser.userId, "github", `gh-${loser.userId}`, "loser-gh");
    await setPublic(loser.cookie, "github", true);
    const codeRes = await SELF.fetch(`${BASE}/api/me/merge-code`, { method: "POST", headers: { cookie: loser.cookie } });
    const { code } = (await codeRes.json()) as { code: string };
    const merge = await SELF.fetch(`${BASE}/api/me/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: winner.cookie },
      body: JSON.stringify({ code, keep: "me" }),
    });
    expect(merge.status).toBe(200);
    expect((await profile(winner.handle)).links).toEqual([
      { provider: "github", url: "https://github.com/loser-gh", label: "@loser-gh" },
    ]);
  });
});

describe("ログインのたびに連携先のユーザー名を取り直す", () => {
  let xUsername = "first_name";
  const xId = `${Date.now()}`;
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    const x = fetchMock.get("https://api.x.com");
    x.intercept({ path: "/2/oauth2/token", method: "POST" })
      .reply(200, () => ({ access_token: "t" }))
      .persist();
    x.intercept({ path: (p: string) => p.startsWith("/2/users/me") })
      .reply(200, () => ({ data: { id: xId, name: "テスト", username: xUsername } }))
      .persist();
  });

  async function loginWithX(cookie = ""): Promise<Response> {
    const login = await SELF.fetch(`${BASE}/api/auth/x/login`, { redirect: "manual", headers: cookie ? { cookie } : {} });
    const oauthCookie = login.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
    const state = new URL(login.headers.get("location")!).searchParams.get("state");
    return SELF.fetch(`${BASE}/api/auth/x/callback?code=dummy&state=${state}`, {
      headers: { cookie: [oauthCookie, cookie].filter(Boolean).join("; ") },
      redirect: "manual",
    });
  }

  it("新規作成で保存し、名前を変えて再ログインすると追いつく。公開の選択は変わらない", async () => {
    await loginWithX();
    const row = () =>
      env.DB.prepare("SELECT user_id, public_handle, profile_public FROM identity WHERE provider = 'x' AND provider_user_id = ?")
        .bind(xId)
        .first<{ user_id: string; public_handle: string | null; profile_public: number }>();
    expect((await row())?.public_handle).toBe("first_name");
    expect((await row())?.profile_public).toBe(0);

    await env.DB.prepare("UPDATE identity SET profile_public = 1 WHERE provider = 'x' AND provider_user_id = ?").bind(xId).run();
    xUsername = "renamed_name";
    await loginWithX();
    expect((await row())?.public_handle).toBe("renamed_name");
    expect((await row())?.profile_public).toBe(1);
  });
});

describe("profileLinkFor / npubEncode", () => {
  it("NIP-19 の既知の値と一致する", () => {
    // NIP-19 の例: 3bf0c63f… → npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6
    expect(npubEncode("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")).toBe(
      "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
    );
    expect(npubEncode("xyz")).toBeNull();
  });

  it("名前が分からない・形が違う連携はリンクにしない", () => {
    expect(profileLinkFor("github", "123", null)).toBeNull();
    expect(profileLinkFor("github", "123", "bad name/../x")).toBeNull();
    // X は username が無ければ数値IDの URL
    expect(profileLinkFor("x", "123456", null)?.url).toBe("https://x.com/i/user/123456");
    expect(profileLinkFor("x", "not-numeric", null)).toBeNull();
    expect(profileLinkFor("bluesky", "not-a-did", "alice.bsky.social")).toBeNull();
    expect(profileLinkFor("google", "sub", "name")).toBeNull();
    expect(profileLinkFor("discord", "1", "disco")).toBeNull();
  });
});
