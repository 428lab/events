import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/** PNGのマジックナンバー付きの小さなダミーバイナリ（デコードはしないので中身は問わない） */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04,
]);

/** DBへ直接ユーザーとセッションを作る（globalName に危険文字列も入れられる） */
async function makeUser(
  globalName: string | null = "テスト",
): Promise<{ userId: string; username: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, globalName, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

/** カードPNGをアップロードする（ヘッダ・ボディは上書き可能） */
async function putCard(
  cookie: string | null,
  body: BodyInit = PNG_BYTES,
  contentType = "image/png",
) {
  return SELF.fetch(`${BASE}/api/me/card-image?k=rosette-indigo`, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

describe("プロフィールカードPNGのアップロード/配信 (#193)", () => {
  it("PUT は要認証（未ログインは 401）", async () => {
    const res = await putCard(null);
    expect(res.status).toBe(401);
  });

  it("PUT で保存され、公開 GET で同じバイト列が返る", async () => {
    const u = await makeUser();
    const put = await putCard(u.cookie);
    expect(put.status).toBe(200);
    const { updatedAt } = (await put.json()) as { updatedAt: number };
    expect(updatedAt).toBeGreaterThan(0);

    // 公開エンドポイント（認証不要）から取得できる
    const get = await SELF.fetch(`${BASE}/api/users/${u.userId}/card-image`);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(get.headers.get("cache-control")).toContain("max-age=3600");
    const bytes = new Uint8Array(await get.arrayBuffer());
    expect(bytes).toEqual(PNG_BYTES);
  });

  it("未生成ユーザーの GET は 404", async () => {
    const u = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/users/${u.userId}/card-image`);
    expect(res.status).toBe(404);
  });

  it("2MB超のボディは 413", async () => {
    const u = await makeUser();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const res = await putCard(u.cookie, big);
    expect(res.status).toBe(413);
  });

  it("PNG以外の content-type は 400", async () => {
    const u = await makeUser();
    const res = await putCard(u.cookie, PNG_BYTES, "image/jpeg");
    expect(res.status).toBe(400);
  });

  it("公開プロフィールに cardImageUpdatedAt が出る（未生成は null）", async () => {
    const u = await makeUser();
    const before = await SELF.fetch(`${BASE}/api/public/users/${u.username}`);
    expect(
      ((await before.json()) as { cardImageUpdatedAt: number | null })
        .cardImageUpdatedAt,
    ).toBeNull();

    await putCard(u.cookie);
    const after = await SELF.fetch(`${BASE}/api/public/users/${u.username}`);
    const body = (await after.json()) as { cardImageUpdatedAt: number | null };
    expect(body.cardImageUpdatedAt).toBeGreaterThan(0);
  });

  it("公開プロフィールに持ち主が選んだ見た目が出る (#334)", async () => {
    // これが欠けていると、プロフィールに載せるカードを見る人の配色で描くしかなくなる
    const u = await makeUser();
    const before = await SELF.fetch(`${BASE}/api/public/users/${u.username}`);
    expect(
      ((await before.json()) as { cardImageKey: string | null }).cardImageKey,
    ).toBeNull();

    const put = await SELF.fetch(`${BASE}/api/me/card-image?k=arcs-rose`, {
      method: "PUT",
      headers: { "content-type": "image/png", cookie: u.cookie },
      body: PNG_BYTES,
    });
    expect(put.status).toBe(200);

    // 未ログイン（＝他人）から見ても持ち主の値が返る
    const after = await SELF.fetch(`${BASE}/api/public/users/${u.username}`);
    expect(
      ((await after.json()) as { cardImageKey: string | null }).cardImageKey,
    ).toBe("arcs-rose");
  });
});

describe("/users/:handle の OG メタ注入 (#193)", () => {
  const fetchHtml = async (path: string) => {
    const res = await SELF.fetch(`${BASE}${path}`, {
      headers: { accept: "text/html" },
    });
    expect(res.status).toBe(200);
    return res.text();
  };

  it("カード未生成は既定OG画像 + summary カード", async () => {
    const u = await makeUser("表示 名前");
    const html = await fetchHtml(`/users/${u.username}`);
    expect(html).toContain(
      `<meta property="og:title" content="表示 名前 ・ events lab" />`,
    );
    expect(html).toContain("og-default.png");
    expect(html).toContain(`<meta name="twitter:card" content="summary" />`);
    // 実績サマリー（Lv・主催・登壇・参加）が description に入る
    expect(html).toMatch(/og:description" content="Lv\.\d+ ・ 主催\d+ ・ 登壇\d+ ・ 参加\d+"/);
    expect(html).toContain(
      `<meta property="og:url" content="http://localhost/users/${u.username}" />`,
    );
  });

  it("カード生成済みはカードPNG + summary_large_image", async () => {
    const u = await makeUser();
    const put = await putCard(u.cookie);
    const { updatedAt } = (await put.json()) as { updatedAt: number };
    const html = await fetchHtml(`/users/${u.username}`);
    expect(html).toContain(
      `content="http://localhost/api/users/${u.userId}/card-image?k=rosette-indigo&amp;v=${updatedAt}"`,
    );
    expect(html).toContain(
      `<meta name="twitter:card" content="summary_large_image" />`,
    );
  });

  it("UUID直指定でも解決される（後方互換）", async () => {
    const u = await makeUser("ゆーざー");
    const html = await fetchHtml(`/users/${u.userId}`);
    expect(html).toContain("ゆーざー ・ events lab");
  });

  it("存在しないユーザーは素の index.html（OG注入なし）", async () => {
    const html = await fetchHtml(`/users/no-such-user-${crypto.randomUUID()}`);
    expect(html).not.toContain("og:title");
    expect(html).toContain('<div id="root">');
  });

  it("表示名のHTML特殊文字はエスケープされる（XSS対策）", async () => {
    const u = await makeUser("<script>alert(1)</script>");
    const html = await fetchHtml(`/users/${u.username}`);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("組み合わせ別キー (#201)", () => {
  it("k なしPUTは400、別kは別ファイル、GETのk指定で切替、OGは選択中のkを指す", async () => {
    const u = await makeUser();
    const png = PNG_BYTES;

    const noK = await SELF.fetch(`${BASE}/api/me/card-image`, {
      method: "PUT",
      headers: { "content-type": "image/png", cookie: u.cookie },
      body: png,
    });
    expect(noK.status).toBe(400);

    const badK = await SELF.fetch(`${BASE}/api/me/card-image?k=evil-key`, {
      method: "PUT",
      headers: { "content-type": "image/png", cookie: u.cookie },
      body: png,
    });
    expect(badK.status).toBe(400);

    // 2種類アップロード → 最後の選択が記録される
    await putCard(u.cookie, png);
    const png2 = new Uint8Array(PNG_BYTES);
    png2[8] = 0x42;
    const second = await SELF.fetch(`${BASE}/api/me/card-image?k=topo-rose`, {
      method: "PUT",
      headers: { "content-type": "image/png", cookie: u.cookie },
      body: png2,
    });
    expect(second.status).toBe(200);

    // k指定でそれぞれのファイルが取れる
    const g1 = await SELF.fetch(
      `${BASE}/api/users/${u.userId}/card-image?k=rosette-indigo`,
    );
    const g2 = await SELF.fetch(
      `${BASE}/api/users/${u.userId}/card-image?k=topo-rose`,
    );
    expect(new Uint8Array(await g1.arrayBuffer())[8]).not.toBe(
      new Uint8Array(await g2.arrayBuffer())[8],
    );

    // k なしGETは選択中（topo-rose）を返す
    const gDefault = await SELF.fetch(
      `${BASE}/api/users/${u.userId}/card-image`,
    );
    expect(new Uint8Array(await gDefault.arrayBuffer())[8]).toBe(
      new Uint8Array(await (await SELF.fetch(`${BASE}/api/users/${u.userId}/card-image?k=topo-rose`)).arrayBuffer())[8],
    );

    // OG は選択中の k を含む
    const html = await (
      await SELF.fetch(`${BASE}/users/${u.username}`)
    ).text();
    expect(html).toContain("k=topo-rose");
  });
});
