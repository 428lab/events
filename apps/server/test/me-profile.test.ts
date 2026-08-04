import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/** 一般ユーザーを1人作る（セッション付き） */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `p_${uid.slice(0, 8)}`, "初期名", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function putDisplayName(
  cookie: string | null,
  displayName: unknown,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/display-name`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ displayName }),
  });
}

describe("ハンドルの変更 (#236)", () => {
  async function putUsername(cookie: string, username: string): Promise<Response> {
    return SELF.fetch(`${BASE}/api/me/username`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ username }),
    });
  }

  it("内部スペースは許可、漢字・前後スペース構造は拒否", async () => {
    const u = await makeUser();
    const sp = await putUsername(u.cookie, `merry shino ${crypto.randomUUID().slice(0, 6)}`);
    expect(sp.status).toBe(200);
    expect((await putUsername(u.cookie, "近藤昭雄")).status).toBe(400);
    // 前後スペースは zod の trim で落ちた上でパターン判定される
    const trimmed = await putUsername(u.cookie, `  ab${crypto.randomUUID().slice(0, 6)}  `);
    expect(trimmed.status).toBe(200);
  });
});

describe("表示名の変更 (#232)", () => {
  it("PUT /me/display-name で表示名を変更でき、trimして保存される", async () => {
    const u = await makeUser();
    const res = await putDisplayName(u.cookie, "  新しい名前  ");
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { displayName: string }).displayName,
    ).toBe("新しい名前");
    const row = await env.DB.prepare(
      "SELECT global_name FROM user WHERE id = ?",
    )
      .bind(u.userId)
      .first<{ global_name: string }>();
    expect(row?.global_name).toBe("新しい名前");
  });

  it("ちょうど50文字は保存でき、絵文字合成（ZWJ）も通る", async () => {
    const u = await makeUser();
    expect((await putDisplayName(u.cookie, "あ".repeat(50))).status).toBe(200);
    expect((await putDisplayName(u.cookie, "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} 家族")).status).toBe(
      200,
    );
  });

  it("空文字・50文字超・制御/不可視文字・未ログインは拒否される", async () => {
    const u = await makeUser();
    expect((await putDisplayName(u.cookie, "")).status).toBe(400);
    expect((await putDisplayName(u.cookie, "   ")).status).toBe(400);
    expect((await putDisplayName(u.cookie, "あ".repeat(51))).status).toBe(400);
    // ゼロ幅スペースのみ（見た目が空の名前）・bidi制御・改行/制御文字
    expect((await putDisplayName(u.cookie, "\u200b")).status).toBe(400);
    expect((await putDisplayName(u.cookie, "abc\u202edef")).status).toBe(400);
    expect((await putDisplayName(u.cookie, "a\nb")).status).toBe(400);
    expect((await putDisplayName(null, "名無し")).status).toBe(401);
    // 失敗しても元の表示名のまま
    const row = await env.DB.prepare(
      "SELECT global_name FROM user WHERE id = ?",
    )
      .bind(u.userId)
      .first<{ global_name: string }>();
    expect(row?.global_name).toBe("初期名");
  });
});
