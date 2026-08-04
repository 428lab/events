import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/** 一般ユーザーを1人作る（セッション付き） */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, `t:${uid}`, `t_${uid.slice(0, 8)}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function makeEvent(createdBy: string): Promise<string> {
  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at) VALUES (?, '統合テスト', 1, 2, 'offline', 'published', ?, ?)",
  )
    .bind(eventId, createdBy, Date.now())
    .run();
  return eventId;
}

async function joinEvent(eventId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, Date.now())
    .run();
}

async function like(
  eventId: string,
  userId: string,
  kind: string,
  targetKey: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_like (id, event_id, user_id, kind, target_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, kind, targetKey, Date.now())
    .run();
}

async function follow(followerId: string, followeeId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO user_follow (follower_id, followee_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(followerId, followeeId, Date.now())
    .run();
}

/** 出会いを (小,大) に正規化して記録する（アプリの保存形と同じ） */
async function meet(eventId: string, a: string, b: string): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await env.DB.prepare(
    "INSERT INTO event_meet (id, event_id, user_low, user_high, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, low, high, Date.now())
    .run();
}

async function issueCode(cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/me/merge-code`, {
    method: "POST",
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { code: string }).code;
}

async function postMerge(cookie: string, body: object): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/merge`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("アカウント統合 (#240)", () => {
  it("負け側の全データが勝ち側へ移り、衝突は勝ち側優先で破棄される (keep: me)", async () => {
    const a = await makeUser(); // コード発行側（負け）
    const b = await makeUser(); // 実行側（勝ち）
    const c = await makeUser(); // 第三者

    // A の予備セッション（統合後に消えることの検証用）
    const aSid2 = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
    )
      .bind(aSid2, a.userId, Date.now() + 86400000)
      .run();

    // イベント: A が作成し、A・B 両方が参加（= 参加行の衝突）
    const eventId = await makeEvent(a.userId);
    await joinEvent(eventId, a.userId);
    await joinEvent(eventId, b.userId);
    await joinEvent(eventId, c.userId);

    // いいね: A と B が同じイベントに「いいね」（衝突）。
    // C は A と B を主催者としていいね（付け替え後に重複）。
    // A は B を主催者としていいね（統合後は自分へのいいねになるので消える）
    await like(eventId, a.userId, "event", "");
    await like(eventId, b.userId, "event", "");
    await like(eventId, c.userId, "host", a.userId);
    await like(eventId, c.userId, "host", b.userId);
    await like(eventId, a.userId, "host", b.userId);

    // フォロー: A⇔B 相互（統合後は自己フォロー）・C→A/C→B（重複）・A→C/B→C（重複）
    await follow(a.userId, b.userId);
    await follow(b.userId, a.userId);
    await follow(c.userId, a.userId);
    await follow(c.userId, b.userId);
    await follow(a.userId, c.userId);
    await follow(b.userId, c.userId);

    // 出会い: A-C と B-C（統合後は同じペアで重複）・A-B（統合後は自己ペア）
    await meet(eventId, a.userId, c.userId);
    await meet(eventId, b.userId, c.userId);
    await meet(eventId, a.userId, b.userId);

    // ユーザー資産: A の配信セット（FK RESTRICT。移行漏れだと削除が失敗する）
    await env.DB.prepare(
      "INSERT INTO live_set (id, owner_id, community_id, name, content, created_at, updated_at) VALUES (?, ?, NULL, 'セット', '{}', ?, ?)",
    )
      .bind(crypto.randomUUID(), a.userId, Date.now(), Date.now())
      .run();

    // 通知設定: 両方に行がある（勝ち側 B の設定を優先）
    await env.DB.prepare(
      "INSERT INTO notification_pref (user_id, followee_created, followee_joined, email_enabled, updated_at) VALUES (?, 1, 1, 1, ?)",
    )
      .bind(a.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO notification_pref (user_id, followee_created, followee_joined, email_enabled, updated_at) VALUES (?, 0, 1, 0, ?)",
    )
      .bind(b.userId, Date.now())
      .run();

    // ログイン方法: A は discord（実ID）、B は別プロバイダのみ
    await env.DB.prepare(
      "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'discord', 'd-123', NULL, ?)",
    )
      .bind(crypto.randomUUID(), a.userId, Date.now())
      .run();
    await env.DB.prepare("UPDATE user SET discord_id = 'd-123' WHERE id = ?")
      .bind(a.userId)
      .run();
    await env.DB.prepare(
      "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'google', 'g-1', NULL, ?)",
    )
      .bind(crypto.randomUUID(), b.userId, Date.now())
      .run();

    // A でコード発行 → B で統合（B を残す）
    const code = await issueCode(a.cookie);
    const res = await postMerge(b.cookie, { code, keep: "me" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; winnerId: string };
    expect(body.ok).toBe(true);
    expect(body.winnerId).toBe(b.userId);

    // 負け側 A のユーザー行・セッションは消えている
    expect(
      await env.DB.prepare("SELECT id FROM user WHERE id = ?")
        .bind(a.userId)
        .first(),
    ).toBeNull();
    expect(
      await count("SELECT COUNT(*) AS n FROM session WHERE user_id = ?", a.userId),
    ).toBe(0);

    // イベント作成者は B へ。参加行は衝突分が破棄されて B は1行だけ
    const ev = await env.DB.prepare("SELECT created_by FROM event WHERE id = ?")
      .bind(eventId)
      .first<{ created_by: string }>();
    expect(ev?.created_by).toBe(b.userId);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_member WHERE event_id = ? AND user_id = ?",
        eventId,
        b.userId,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_member WHERE user_id = ?",
        a.userId,
      ),
    ).toBe(0);

    // いいね: B のイベントいいねは1行。主催者いいねは C→B の1行に集約。
    // 統合で自分へのいいねになる行は消えている
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_like WHERE event_id = ? AND user_id = ? AND kind = 'event'",
        eventId,
        b.userId,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_like WHERE kind = 'host' AND target_key = ?",
        b.userId,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_like WHERE user_id = ? OR target_key = ?",
        a.userId,
        a.userId,
      ),
    ).toBe(0);

    // フォロー: 自己フォローなし・A の痕跡なし・C⇔B は各1行
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM user_follow WHERE follower_id = followee_id",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM user_follow WHERE follower_id = ? OR followee_id = ?",
        a.userId,
        a.userId,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM user_follow WHERE follower_id = ? AND followee_id = ?",
        c.userId,
        b.userId,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM user_follow WHERE follower_id = ? AND followee_id = ?",
        b.userId,
        c.userId,
      ),
    ).toBe(1);

    // 出会い: B-C の正規化ペアが1行だけ。自己ペア・A の痕跡なし
    const [low, high] =
      b.userId < c.userId ? [b.userId, c.userId] : [c.userId, b.userId];
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_meet WHERE event_id = ? AND user_low = ? AND user_high = ?",
        eventId,
        low,
        high,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_meet WHERE user_low = ? OR user_high = ?",
        a.userId,
        a.userId,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_meet WHERE user_low = user_high",
      ),
    ).toBe(0);

    // 資産（live_set）は B へ
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM live_set WHERE owner_id = ?",
        b.userId,
      ),
    ).toBe(1);

    // 通知設定は勝ち側 B の値が残る
    const pref = await env.DB.prepare(
      "SELECT followee_created, email_enabled FROM notification_pref WHERE user_id = ?",
    )
      .bind(b.userId)
      .first<{ followee_created: number; email_enabled: number }>();
    expect(pref).toEqual({ followee_created: 0, email_enabled: 0 });

    // ログイン方法は両方 B に付き、discord_id は実IDに揃う
    const providers = (
      await env.DB.prepare(
        "SELECT provider FROM identity WHERE user_id = ? ORDER BY provider",
      )
        .bind(b.userId)
        .all<{ provider: string }>()
    ).results.map((r) => r.provider);
    expect(providers).toEqual(["discord", "google"]);
    const bUser = await env.DB.prepare(
      "SELECT discord_id FROM user WHERE id = ?",
    )
      .bind(b.userId)
      .first<{ discord_id: string }>();
    expect(bUser?.discord_id).toBe("d-123");

    // B のセッションは生きている
    const meRes = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { cookie: b.cookie },
    });
    expect(meRes.status).toBe(200);
  });

  it("keep: other でコード発行側が残り、実行側は削除されてログアウトになる", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await makeEvent(a.userId);
    await joinEvent(eventId, b.userId);

    const code = await issueCode(a.cookie);
    const res = await postMerge(b.cookie, { code, keep: "other" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { winnerId: string }).winnerId).toBe(a.userId);

    // B は削除され、参加行は A へ移っている
    expect(
      await env.DB.prepare("SELECT id FROM user WHERE id = ?")
        .bind(b.userId)
        .first(),
    ).toBeNull();
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_member WHERE event_id = ? AND user_id = ?",
        eventId,
        a.userId,
      ),
    ).toBe(1);

    // 実行側（負け）のセッションは無効
    const meRes = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { cookie: b.cookie },
    });
    expect(meRes.status).toBe(401);
  });

  it("コードは1回限り（2回目は400）", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();

    const code = await issueCode(a.cookie);
    const first = await postMerge(b.cookie, { code, keep: "me" });
    expect(first.status).toBe(200);

    const second = await postMerge(c.cookie, { code, keep: "me" });
    expect(second.status).toBe(400);
    expect(((await second.json()) as { error: string }).error).toBe(
      "invalid_code",
    );
  });

  it("自分自身のコードでは統合できない（コードは消費されない）", async () => {
    const a = await makeUser();
    const b = await makeUser();

    const code = await issueCode(a.cookie);
    const res = await postMerge(a.cookie, { code, keep: "me" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "same_account",
    );

    // 消費されていないので、正しい相手からなら引き続き使える
    const ok = await postMerge(b.cookie, { code, keep: "me" });
    expect(ok.status).toBe(200);
  });

  it("でたらめなコードは400", async () => {
    const b = await makeUser();
    const res = await postMerge(b.cookie, { code: "not-a-code", keep: "me" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "invalid_code",
    );
  });
});
