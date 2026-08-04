import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";
const GHOST_DISCORD_ID = "system:deleted-user";

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
    "INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at) VALUES (?, '退会テスト', 1, 2, 'offline', 'published', ?, ?)",
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

async function requestDelete(
  cookie: string | null,
  body: unknown = { confirm: true },
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function ghostRow(): Promise<{ id: string; username: string } | null> {
  return env.DB.prepare(
    "SELECT id, username FROM user WHERE discord_id = ?",
  )
    .bind(GHOST_DISCORD_ID)
    .first<{ id: string; username: string }>();
}

describe("退会（アカウント削除） (#244)", () => {
  it("共有コンテンツは「退会済みユーザー」名義で残り、本人の活動記録・資産・ログイン情報は消える", async () => {
    const a = await makeUser(); // 退会する本人
    const b = await makeUser(); // 第三者

    // 共有コンテンツ: A の主催イベント・コミュニティ・会場・たまご・会場オファー
    const eventId = await makeEvent(a.userId);
    await joinEvent(eventId, a.userId);
    await joinEvent(eventId, b.userId);

    const communityId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO community (id, slug, name, owner_id, created_at) VALUES (?, ?, 'コミュ', ?, ?)",
    )
      .bind(communityId, `c-${communityId.slice(0, 8)}`, a.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    )
      .bind(crypto.randomUUID(), communityId, a.userId, Date.now())
      .run();

    const venueId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO venue (id, owner_id, name, created_at, updated_at) VALUES (?, ?, '会場', ?, ?)",
    )
      .bind(venueId, a.userId, Date.now(), Date.now())
      .run();

    const requestId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_request (id, title, created_by, created_at) VALUES (?, 'たまご', ?, ?)",
    )
      .bind(requestId, a.userId, Date.now())
      .run();

    const offerId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO venue_offer (id, venue_id, request_id, direction, created_by, created_at) VALUES (?, ?, ?, 'venue_to_event', ?, ?)",
    )
      .bind(offerId, venueId, requestId, a.userId, Date.now())
      .run();

    // 活動記録: いいね（した/もらった）・コメント・チャット鍵・フォロー
    await env.DB.prepare(
      "INSERT INTO event_like (id, event_id, user_id, kind, target_key, created_at) VALUES (?, ?, ?, 'event', '', ?)",
    )
      .bind(crypto.randomUUID(), eventId, a.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_like (id, event_id, user_id, kind, target_key, created_at) VALUES (?, ?, ?, 'host', ?, ?)",
    )
      .bind(crypto.randomUUID(), eventId, b.userId, a.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_comment (id, event_id, user_id, body, created_at) VALUES (?, ?, ?, 'こんにちは', ?)",
    )
      .bind(crypto.randomUUID(), eventId, a.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_chat_pubkey (event_id, user_id, pubkey, created_at) VALUES (?, ?, 'pk-a', ?)",
    )
      .bind(eventId, a.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO user_follow (follower_id, followee_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(a.userId, b.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO user_follow (follower_id, followee_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(b.userId, a.userId, Date.now())
      .run();

    // 個人資産: live_set（FK RESTRICT）・deck・bgm_track（R2オブジェクト付き）
    const liveSetId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO live_set (id, owner_id, community_id, name, content, created_at, updated_at) VALUES (?, ?, NULL, 'セット', '{}', ?, ?)",
    )
      .bind(liveSetId, a.userId, Date.now(), Date.now())
      .run();
    // live_set を参照する配信状態（SET NULL で live_set 削除をブロックしないこと）
    await env.DB.prepare(
      "INSERT INTO event_live_state (event_id, live_set_id, updated_at) VALUES (?, ?, ?)",
    )
      .bind(eventId, liveSetId, Date.now())
      .run();

    const deckId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO deck (id, slug, owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, 'スライド', '{\"slides\":[]}', ?, ?)",
    )
      .bind(deckId, `d-${deckId.slice(0, 8)}`, a.userId, Date.now(), Date.now())
      .run();
    const deckImageKey = `deck-images/${deckId}/${crypto.randomUUID()}`;
    await env.BUCKET.put(deckImageKey, "png-bytes");

    const bgmId = crypto.randomUUID();
    const bgmKey = `bgm/${bgmId}`;
    await env.DB.prepare(
      "INSERT INTO bgm_track (id, owner_id, name, credit_text, r2_key, created_at) VALUES (?, ?, '曲', 'credit', ?, ?)",
    )
      .bind(bgmId, a.userId, bgmKey, Date.now())
      .run();
    await env.BUCKET.put(bgmKey, "audio-bytes");

    // ログイン情報: identity と予備セッション
    await env.DB.prepare(
      "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'google', ?, NULL, ?)",
    )
      .bind(crypto.randomUUID(), a.userId, `g-${a.userId}`, Date.now())
      .run();

    // 退会実行
    const res = await requestDelete(a.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    // 「退会済みユーザー」が作られ、共有コンテンツの名義がそこへ移っている
    const ghost = await ghostRow();
    expect(ghost).not.toBeNull();
    for (const [sql, id] of [
      ["SELECT created_by AS o FROM event WHERE id = ?", eventId],
      ["SELECT owner_id AS o FROM community WHERE id = ?", communityId],
      ["SELECT owner_id AS o FROM venue WHERE id = ?", venueId],
      ["SELECT created_by AS o FROM event_request WHERE id = ?", requestId],
      ["SELECT created_by AS o FROM venue_offer WHERE id = ?", offerId],
    ] as const) {
      const row = await env.DB.prepare(sql).bind(id).first<{ o: string }>();
      expect(row?.o).toBe(ghost!.id);
    }

    // 本人の活動記録・資産・ログイン情報は消えている
    const gone: Array<[string, ...unknown[]]> = [
      ["SELECT COUNT(*) AS n FROM user WHERE id = ?", a.userId],
      ["SELECT COUNT(*) AS n FROM event_member WHERE user_id = ?", a.userId],
      ["SELECT COUNT(*) AS n FROM community_member WHERE user_id = ?", a.userId],
      [
        "SELECT COUNT(*) AS n FROM event_like WHERE user_id = ? OR target_key = ?",
        a.userId,
        a.userId,
      ],
      ["SELECT COUNT(*) AS n FROM event_comment WHERE user_id = ?", a.userId],
      ["SELECT COUNT(*) AS n FROM event_chat_pubkey WHERE user_id = ?", a.userId],
      [
        "SELECT COUNT(*) AS n FROM user_follow WHERE follower_id = ? OR followee_id = ?",
        a.userId,
        a.userId,
      ],
      ["SELECT COUNT(*) AS n FROM live_set WHERE owner_id = ?", a.userId],
      ["SELECT COUNT(*) AS n FROM deck WHERE owner_id = ?", a.userId],
      ["SELECT COUNT(*) AS n FROM bgm_track WHERE owner_id = ?", a.userId],
      ["SELECT COUNT(*) AS n FROM session WHERE user_id = ?", a.userId],
      ["SELECT COUNT(*) AS n FROM identity WHERE user_id = ?", a.userId],
    ];
    for (const [sql, ...args] of gone) {
      expect(await count(sql, ...args), sql).toBe(0);
    }

    // 配信状態は live_set 参照だけ外れて残る（SET NULL）
    const liveState = await env.DB.prepare(
      "SELECT live_set_id FROM event_live_state WHERE event_id = ?",
    )
      .bind(eventId)
      .first<{ live_set_id: string | null }>();
    expect(liveState).not.toBeNull();
    expect(liveState!.live_set_id).toBeNull();

    // R2 のオブジェクトも消えている
    expect(await env.BUCKET.get(deckImageKey)).toBeNull();
    expect(await env.BUCKET.get(bgmKey)).toBeNull();

    // 第三者 B の参加行は残る
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM event_member WHERE event_id = ? AND user_id = ?",
        eventId,
        b.userId,
      ),
    ).toBe(1);

    // 本人のセッションは無効（cookie も破棄されている）
    const meRes = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { cookie: a.cookie },
    });
    expect(meRes.status).toBe(401);
  });

  it("個人参加のエントリーと成果物は削除され、チーム参加は残る", async () => {
    const a = await makeUser();
    const owner = await makeUser();
    const mate = await makeUser();
    const eventId = await makeEvent(owner.userId);

    // 個人エントリー（本人名義・成果物つき）
    const solo = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO entry (id, event_id, kind, name, created_at) VALUES (?, ?, 'individual', '退会する人', ?)",
    )
      .bind(solo, eventId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO entry_member (id, entry_id, user_id, is_leader) VALUES (?, ?, ?, 1)",
    )
      .bind(crypto.randomUUID(), solo, a.userId)
      .run();
    await env.DB.prepare(
      "INSERT INTO submission (id, entry_id, presentation_url, source_code_url, updated_at) VALUES (?, ?, 'https://example.com/slides', NULL, ?)",
    )
      .bind(crypto.randomUUID(), solo, Date.now())
      .run();

    // チームエントリー（他のメンバーが居るので共有物として残す）
    const team = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO entry (id, event_id, kind, name, created_at) VALUES (?, ?, 'team', 'チームA', ?)",
    )
      .bind(team, eventId, Date.now())
      .run();
    for (const uid of [a.userId, mate.userId]) {
      await env.DB.prepare(
        "INSERT INTO entry_member (id, entry_id, user_id, is_leader) VALUES (?, ?, ?, 0)",
      )
        .bind(crypto.randomUUID(), team, uid)
        .run();
    }

    expect((await requestDelete(a.cookie)).status).toBe(200);

    expect(await count("SELECT COUNT(*) n FROM entry WHERE id = ?", solo)).toBe(0);
    expect(
      await count("SELECT COUNT(*) n FROM submission WHERE entry_id = ?", solo),
    ).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM entry WHERE id = ?", team)).toBe(1);
    expect(
      await count("SELECT COUNT(*) n FROM entry_member WHERE entry_id = ?", team),
    ).toBe(1); // 本人の行だけ消える
  });

  it("会場・オファーの連絡先は消え、未応答のオファーは辞退になる", async () => {
    const a = await makeUser();
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const venueId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO venue (id, owner_id, name, address, contact, status, created_at, updated_at) VALUES (?, ?, '会場', '住所', 'contact@example.com', 'open', ?, ?)",
    )
      .bind(venueId, a.userId, Date.now(), Date.now())
      .run();
    const otherVenue = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO venue (id, owner_id, name, address, contact, status, created_at, updated_at) VALUES (?, ?, '会場2', '住所2', 'c2@example.com', 'open', ?, ?)",
    )
      .bind(otherVenue, owner.userId, Date.now(), Date.now())
      .run();
    const offerId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO venue_offer (id, venue_id, event_id, request_id, direction, status, organizer_contact, created_by, created_at) VALUES (?, ?, ?, NULL, 'event_to_venue', 'pending', 'tel:090-0000-0000', ?, ?)",
    )
      .bind(offerId, otherVenue, eventId, a.userId, Date.now())
      .run();

    expect((await requestDelete(a.cookie)).status).toBe(200);

    const offer = await env.DB.prepare(
      "SELECT organizer_contact, status FROM venue_offer WHERE id = ?",
    )
      .bind(offerId)
      .first<{ organizer_contact: string; status: string }>();
    expect(offer?.organizer_contact).toBe("");
    expect(offer?.status).toBe("declined");

    const venue = await env.DB.prepare(
      "SELECT contact, status FROM venue WHERE id = ?",
    )
      .bind(venueId)
      .first<{ contact: string; status: string }>();
    expect(venue?.contact).toBe("");
    expect(venue?.status).toBe("closed"); // 管理者が居ないので募集を止める
    // 第三者の会場は無傷
    const untouched = await env.DB.prepare(
      "SELECT contact, status FROM venue WHERE id = ?",
    )
      .bind(otherVenue)
      .first<{ contact: string; status: string }>();
    expect(untouched?.contact).toBe("c2@example.com");
    expect(untouched?.status).toBe("open");
  });

  it("退会済みユーザーのプロフィールは 500 にならない", async () => {
    // 少なくとも1人退会させて ghost を確実に作る
    const a = await makeUser();
    await makeEvent(a.userId);
    expect((await requestDelete(a.cookie)).status).toBe(200);

    const ghost = await ghostRow();
    expect(ghost).not.toBeNull();
    const res = await SELF.fetch(
      `${BASE}/api/public/users/${encodeURIComponent(ghost!.username)}`,
    );
    expect([200, 404]).toContain(res.status);
  });

  it("confirm なしは 400・未認証は 401", async () => {
    const a = await makeUser();
    expect((await requestDelete(a.cookie, {})).status).toBe(400);
    expect((await requestDelete(a.cookie, { confirm: false })).status).toBe(400);
    expect((await requestDelete(null)).status).toBe(401);
    // アカウントは残っている
    expect(
      await count("SELECT COUNT(*) AS n FROM user WHERE id = ?", a.userId),
    ).toBe(1);
  });

  it("2人目の退会でも同じ「退会済みユーザー」が再利用される", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const eventA = await makeEvent(a.userId);
    const eventB = await makeEvent(b.userId);

    expect((await requestDelete(a.cookie)).status).toBe(200);
    expect((await requestDelete(b.cookie)).status).toBe(200);

    expect(
      await count(
        "SELECT COUNT(*) AS n FROM user WHERE discord_id = ?",
        GHOST_DISCORD_ID,
      ),
    ).toBe(1);
    const ghost = await ghostRow();
    for (const eventId of [eventA, eventB]) {
      const row = await env.DB.prepare(
        "SELECT created_by FROM event WHERE id = ?",
      )
        .bind(eventId)
        .first<{ created_by: string }>();
      expect(row?.created_by).toBe(ghost!.id);
    }
  });
});
