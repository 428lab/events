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

  it("空文字・50文字超・未ログインは拒否される", async () => {
    const u = await makeUser();
    expect((await putDisplayName(u.cookie, "")).status).toBe(400);
    expect((await putDisplayName(u.cookie, "   ")).status).toBe(400);
    expect((await putDisplayName(u.cookie, "あ".repeat(51))).status).toBe(400);
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
