import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";
const sql = (q: string, ...v: unknown[]) => env.DB.prepare(q).bind(...v).run();

/** DBへ直接ユーザーとセッションを作る */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await sql(
    "INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, 1)",
    uid,
    `nostr:${uid}`,
    `u_${uid.slice(0, 8)}`,
  );
  await sql(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
    sid,
    uid,
    Date.now() + 86400000,
  );
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** DBへ直接イベントを作り、作成者をスタッフにする */
async function makeEvent(
  ownerId: string,
  title: string,
  visibility: "public" | "unlisted" | "private",
  status: "published" | "draft",
): Promise<{ id: string; slug: string }> {
  const id = crypto.randomUUID();
  const slug = id.slice(0, 8);
  await sql(
    "INSERT INTO event (id, slug, title, created_by, created_at, starts_at, ends_at, venue_type, status, visibility) VALUES (?, ?, ?, ?, 1, ?, ?, 'online', ?, ?)",
    id,
    slug,
    title,
    ownerId,
    Date.now() + 60000,
    Date.now() + 3600000,
    status,
    visibility,
  );
  await sql(
    "INSERT INTO event_member (id, event_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'staff', 'confirmed', 1)",
    crypto.randomUUID(),
    id,
    ownerId,
  );
  return { id, slug };
}

const fetchHtml = async (path: string, cookie?: string) => {
  const res = await SELF.fetch(`${BASE}${path}`, {
    headers: { accept: "text/html", ...(cookie ? { cookie } : {}) },
  });
  expect(res.status).toBe(200);
  return res.text();
};

describe("/events/:id・/e/:slug のページタイトル (#676)", () => {
  it("公開・公開済みイベントは <title> にイベント名、og:site_name が入る", async () => {
    const owner = await makeUser();
    const e = await makeEvent(owner.userId, "タイトル入りイベント", "public", "published");
    for (const path of [`/events/${e.id}`, `/e/${e.slug}`]) {
      const html = await fetchHtml(path);
      expect(html).toContain("<title>タイトル入りイベント ・ events lab</title>");
      expect(html).toContain(`<meta property="og:site_name" content="events lab" />`);
      // og:title はイベント名のまま
      expect(html).toContain(`<meta property="og:title" content="タイトル入りイベント" />`);
    }
  });

  it("題名の HTML 特殊文字はエスケープされる", async () => {
    const owner = await makeUser();
    const e = await makeEvent(owner.userId, "<b>A&B</b> $& 会", "public", "published");
    const html = await fetchHtml(`/events/${e.id}`);
    expect(html).not.toContain("<b>A&B</b>");
    expect(html).toContain(
      "<title>&lt;b&gt;A&amp;B&lt;/b&gt; $&amp; 会 ・ events lab</title>",
    );
  });

  it("限定公開・下書きは <title> を差し替えず、イベント名を含まない", async () => {
    const owner = await makeUser();
    const unlisted = await makeEvent(owner.userId, "限定公開の秘密題名", "unlisted", "published");
    const draft = await makeEvent(owner.userId, "下書きの秘密題名", "public", "draft");
    for (const [e, name] of [
      [unlisted, "限定公開の秘密題名"],
      [draft, "下書きの秘密題名"],
    ] as const) {
      for (const path of [`/events/${e.id}`, `/e/${e.slug}`]) {
        // 下書きはスタッフにしか見えないので作成者で開く
        const html = await fetchHtml(path, owner.cookie);
        // テスト用 index.html の既定タイトルのまま
        expect(html).toContain("<title>events lab (test)</title>");
        expect(html).not.toContain(name);
        expect(html).not.toContain("og:site_name");
      }
    }
  });
});
