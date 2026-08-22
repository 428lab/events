import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { StaffChatPayload } from "@eventer/shared";
import {
  BASE,
  HOUR,
  makeMember,
  makeUser,
  loginDev,
  type TestUser,
} from "./lib/staffDutyHelpers.js";

/**
 * イベントスタッフ用のチャットルーム (#382)。設計は docs/staff-chat.md 11。
 *
 * 主眼は3つ。
 *
 * 1. **参加者に部屋の存在ごと見えないこと。** roomId・鍵・signer のどれも
 *    staff 以外に返る経路が無く、403 の応答が部屋の有無で変わらない
 * 2. **公開前から使えること。** 下書き（draft）のまま部屋を作り鍵を受け取れる
 * 3. **資格喪失の3経路（降格・参加解除・退会 purge）すべてで鍵が1世代進むこと。**
 *    フックを1つ外すと、その経路のテストが落ちる（「抜けた人が新しい鍵を
 *    取れてしまう」は GET 403 の検査が落とす）
 *
 * 3表を触る SQL が1か所に閉じていることは `staff-chat-sql-audit.test.ts`、
 * アカウント統合の登録漏れは `merge-user-columns.test.ts` が見張る。
 * 暗号化・復号（NIP-44）はブラウザだけが行うので、web 側の
 * `staffChatCrypto.test.ts` が受け持つ。
 */

const DAY = 24 * HOUR;

/** 下書きイベントを作る（作成者は自動で staff / confirmed になる）。
 * **公開しない**のが既定: 「公開前から使える」が本件の一番の要件 */
async function createDraftEvent(owner: TestUser): Promise<string> {
  const startsAt = Date.now() + 7 * DAY;
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({
      title: `スタッフチャットの検証_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "offline",
      startsAt,
      endsAt: startsAt + 4 * HOUR,
    }),
  });
  expect(res.status).toBe(201);
  const { event } = (await res.json()) as { event: { id: string } };
  return event.id;
}

function getChat(eventId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/staff-chat`, {
    headers: { cookie },
  });
}

function postChat(eventId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/staff-chat`, {
    method: "POST",
    headers: { cookie },
  });
}

async function payload(res: Response): Promise<StaffChatPayload> {
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as StaffChatPayload;
}

/** DB の生の鍵世代（世代番号の昇順） */
async function keyVersions(eventId: string): Promise<number[]> {
  const rows = await env.DB.prepare(
    "SELECT version FROM event_group_chat_key WHERE event_id = ? ORDER BY version",
  )
    .bind(eventId)
    .all<{ version: number }>();
  return rows.results.map((r) => r.version);
}

async function signerRow(
  eventId: string,
  userId: string,
): Promise<{ pubkey: string; revoked_at: number | null } | null> {
  return env.DB.prepare(
    "SELECT pubkey, revoked_at FROM event_group_chat_signer WHERE event_id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<{ pubkey: string; revoked_at: number | null }>();
}

async function setRole(
  eventId: string,
  by: TestUser,
  userId: string,
  role: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/members/${userId}/role`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: by.cookie },
    body: JSON.stringify({ role }),
  });
}

/* ===== 11.1 参加者に部屋の存在ごと見えない（最重要）===== */

describe("staff 以外は部屋の存在ごと見えない (#382 11.1)", () => {
  /** 役割ごとに**1本ずつ**書く。まとめない（#383 の
   * 「4か所のうち1か所だけ直っていた」事故の再発防止） */
  for (const role of ["participant", "judge", "observer"] as const) {
    it(`${role} は GET も POST も 403`, async () => {
      const owner = await makeUser();
      const eventId = await createDraftEvent(owner);
      await payload(await postChat(eventId, owner.cookie)); // 部屋あり
      const other = await makeMember(eventId, role);
      const got = await getChat(eventId, other.cookie);
      expect(got.status).toBe(403);
      expect(await got.json()).toEqual({ error: "forbidden" });
      expect((await postChat(eventId, other.cookie)).status).toBe(403);
    });
  }

  it("メンバーでない利用者は 403", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    const stranger = await makeUser();
    expect((await getChat(eventId, stranger.cookie)).status).toBe(403);
    expect((await postChat(eventId, stranger.cookie)).status).toBe(403);
  });

  it("アプリ運営管理者でも、そのイベントの staff でなければ 403 (#275)", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    await payload(await postChat(eventId, owner.cookie));
    const adminCookie = await loginDev();
    expect((await getChat(eventId, adminCookie)).status).toBe(403);
    expect((await postChat(eventId, adminCookie)).status).toBe(403);
  });

  it("未確定（status != confirmed）の staff は 403", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    const pendingStaff = await makeMember(eventId, "staff", "applied");
    expect((await getChat(eventId, pendingStaff.cookie)).status).toBe(403);
    expect((await postChat(eventId, pendingStaff.cookie)).status).toBe(403);
  });

  it("未ログインは 401", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staff-chat`);
    expect(res.status).toBe(401);
  });

  it("403 の応答が部屋の有無で変わらない（存在の秘匿）", async () => {
    const owner = await makeUser();
    const withRoom = await createDraftEvent(owner);
    await payload(await postChat(withRoom, owner.cookie));
    const withoutRoom = await createDraftEvent(owner);
    const p1 = await makeMember(withRoom, "participant");
    const p2 = await makeMember(withoutRoom, "participant");

    const a = await getChat(withRoom, p1.cookie);
    const b = await getChat(withoutRoom, p2.cookie);
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());

    const c1 = await postChat(withRoom, p1.cookie);
    const c2 = await postChat(withoutRoom, p2.cookie);
    expect(c1.status).toBe(c2.status);
    expect(await c1.text()).toBe(await c2.text());
  });
});

/* ===== 11.2 既存のイベント API から鍵が漏れない ===== */

describe("イベント API の応答に部屋の痕跡が無い (#382 11.2)", () => {
  it("イベント詳細・公開詳細・chat-members に roomId / secret / pubkey が現れない", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    const room = await payload(await postChat(eventId, owner.cookie));

    // このイベントの秘密ぜんぶ（roomId・全世代の共通鍵・signer の鍵）
    const secrets = [
      room.roomId,
      ...room.keys.map((k) => k.secret),
      room.myKey!.pubkey,
      room.myKey!.secret,
    ];
    const assertClean = (text: string) => {
      for (const s of secrets) expect(text).not.toContain(s);
    };

    // 下書きのイベント詳細（staff 本人が読む＝一番多くの列が返る側）
    const draft = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(draft.status).toBe(200);
    assertClean(await draft.text());

    // 公開後の詳細（未ログイン）と参加者向けの chat-members
    await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ status: "published" }),
    });
    const pub = await SELF.fetch(`${BASE}/api/events/${eventId}`);
    expect(pub.status).toBe(200);
    assertClean(await pub.text());

    const participant = await makeMember(eventId, "participant");
    const members = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-members`,
      { headers: { cookie: participant.cookie } },
    );
    expect(members.status).toBe(200);
    assertClean(await members.text());
  });
});

/* ===== 11.3 / 11.4 staff は公開前から部屋を作れる ===== */

describe("staff は下書きのまま部屋を作れる (#382 11.3)", () => {
  it("POST で部屋・v1 鍵・自分の signer ができ、GET で同じものが返る", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner); // 公開しない
    expect((await getChat(eventId, owner.cookie)).status).toBe(404); // 未開設

    const created = await payload(await postChat(eventId, owner.cookie));
    expect(created.roomId).toMatch(/^[0-9a-f]{64}$/);
    expect(created.keys).toHaveLength(1);
    expect(created.keys[0]).toMatchObject({ version: 1 });
    expect(created.keys[0]!.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(created.myKey!.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(created.members.map((m) => m.userId)).toEqual([owner.userId]);
    expect(created.members[0]!.revokedAt).toBeNull();
    expect(created.relays.length).toBeGreaterThan(0);

    const got = await payload(await getChat(eventId, owner.cookie));
    expect(got).toEqual(created); // 冪等（roomId も鍵もそのまま）

    // 2回 POST しても同じ（部屋も鍵も作り直さない）
    const again = await payload(await postChat(eventId, owner.cookie));
    expect(again.roomId).toBe(created.roomId);
    expect(again.keys).toEqual(created.keys);
    expect(again.myKey).toEqual(created.myKey);
  });

  it("2人目の staff は GET では myKey が null、POST で自分の鍵を受け取る", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    await payload(await postChat(eventId, owner.cookie));
    const second = await makeMember(eventId, "staff");

    const before = await payload(await getChat(eventId, second.cookie));
    expect(before.myKey).toBeNull();
    expect(before.keys).toHaveLength(1); // 共通鍵は配られる

    const after = await payload(await postChat(eventId, second.cookie));
    expect(after.myKey).not.toBeNull();
    expect(after.roomId).toBe(before.roomId);
    expect(after.members.map((m) => m.userId).sort()).toEqual(
      [owner.userId, second.userId].sort(),
    );
  });

  it("2人同時に POST しても部屋と v1 は1つ（先勝ち #382 11.4）", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    const second = await makeMember(eventId, "staff");
    const [a, b] = await Promise.all([
      postChat(eventId, owner.cookie),
      postChat(eventId, second.cookie),
    ]);
    const pa = await payload(a);
    const pb = await payload(b);
    expect(pa.roomId).toBe(pb.roomId);
    expect(await keyVersions(eventId)).toEqual([1]);
    // 各自の signer は別の鍵
    expect(pa.myKey!.pubkey).not.toBe(pb.myKey!.pubkey);
  });
});

/* ===== 11.5 資格喪失の3経路すべてでローテーションが効く ===== */

describe("資格喪失でローテーションが効く (#382 11.5)", () => {
  /** 部屋あり・staff 2人（owner と second。second は鍵を受け取り済み）を作る */
  async function setupTwoStaff(): Promise<{
    eventId: string;
    owner: TestUser;
    second: TestUser;
  }> {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    await payload(await postChat(eventId, owner.cookie));
    const second = await makeMember(eventId, "staff");
    await payload(await postChat(eventId, second.cookie));
    return { eventId, owner, second };
  }

  /** 3経路共通の検査: (a) 鍵が1世代進む (b) 対象者の signer に revoked_at が付く
   * (c) 対象者の GET / POST が 403（＝新しい鍵を取れない） */
  async function assertRotated(eventId: string, lost: TestUser): Promise<void> {
    expect(await keyVersions(eventId)).toEqual([1, 2]);
    const signer = await signerRow(eventId, lost.userId);
    expect(signer!.revoked_at).not.toBeNull();
    expect((await getChat(eventId, lost.cookie)).status).toBe(403);
    expect((await postChat(eventId, lost.cookie)).status).toBe(403);
  }

  it("降格（staff → judge）で鍵が1世代進み、抜けた人は新しい鍵を取れない", async () => {
    const { eventId, owner, second } = await setupTwoStaff();
    expect((await setRole(eventId, owner, second.userId, "judge")).status).toBe(
      200,
    );
    await assertRotated(eventId, second);
    // 残った staff は全世代を受け取り、抜けた人は revokedAt 付きで一覧に残る
    const mine = await payload(await getChat(eventId, owner.cookie));
    expect(mine.keys.map((k) => k.version)).toEqual([1, 2]);
    const gone = mine.members.find((m) => m.userId === second.userId);
    expect(gone!.revokedAt).not.toBeNull();
  });

  it("本人の参加解除（DELETE /join）で鍵が1世代進む", async () => {
    const { eventId, second } = await setupTwoStaff();
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
      method: "DELETE",
      headers: { cookie: second.cookie },
    });
    expect(res.status).toBe(200);
    await assertRotated(eventId, second);
  });

  it("ロール変更 → participant（leaveEvent 経由）でも鍵が1世代進む", async () => {
    const { eventId, owner, second } = await setupTwoStaff();
    expect(
      (await setRole(eventId, owner, second.userId, "participant")).status,
    ).toBe(200);
    await assertRotated(eventId, second);
  });

  it("退会 purge で鍵が1世代進む（ルートを通らない経路 #250）", async () => {
    const { eventId, second } = await setupTwoStaff();
    // 退会申請 → 猶予31日経過 → 日次バッチが完全削除
    const del = await SELF.fetch(`${BASE}/api/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: second.cookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(del.status).toBe(200);
    await env.DB.prepare(
      "UPDATE user SET deleted_at = deleted_at - ? WHERE id = ?",
    )
      .bind(31 * DAY, second.userId)
      .run();
    const purge = await SELF.fetch(`${BASE}/api/cron/purge-deleted`, {
      method: "POST",
      headers: { "x-cron-key": "test-cron-secret" },
    });
    expect(purge.status).toBe(200);
    expect(((await purge.json()) as { purged: number }).purged).toBe(1);

    expect(await keyVersions(eventId)).toEqual([1, 2]);
    // signer 行は user 削除の FK CASCADE で消える（表示許可リストからも消える）
    expect(await signerRow(eventId, second.userId)).toBeNull();
  });

  it("部屋が無いイベントでは資格を失っても何も起きない", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    const second = await makeMember(eventId, "staff");
    expect((await setRole(eventId, owner, second.userId, "judge")).status).toBe(
      200,
    );
    expect(await keyVersions(eventId)).toEqual([]);
  });
});

/* ===== 11.6 再招待 → 再承諾で戻れる ===== */

describe("再招待で戻った人は同じ signer と全世代を受け取る (#382 11.6)", () => {
  it("承諾後の POST で revoked_at が消え、全 version が返る", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    await payload(await postChat(eventId, owner.cookie));
    const second = await makeMember(eventId, "staff");
    const firstKey = (await payload(await postChat(eventId, second.cookie)))
      .myKey!;

    // 参加解除で資格を失う（ローテーション）
    await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
      method: "DELETE",
      headers: { cookie: second.cookie },
    });
    expect(await keyVersions(eventId)).toEqual([1, 2]);

    // 再招待 → 本人が承諾（承諾フローに配布処理は無い。設計 4）
    const invite = await SELF.fetch(
      `${BASE}/api/events/${eventId}/staff-invites`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({ handle: second.username }),
      },
    );
    expect(invite.status).toBe(201);
    const { invites } = (await invite.json()) as {
      invites: Array<{ id: string; user: { id: string } }>;
    };
    const inviteId = invites.find((i) => i.user.id === second.userId)!.id;
    const accept = await SELF.fetch(
      `${BASE}/api/me/staff-invites/${inviteId}/accept`,
      { method: "POST", headers: { cookie: second.cookie } },
    );
    expect(accept.status).toBe(200);

    // 次に開いた時点でゲートを通る。GET は失効中の鍵を配らない（myKey null）
    const back = await payload(await getChat(eventId, second.cookie));
    expect(back.myKey).toBeNull();
    // POST で同じ signer が再有効化され、全世代（不在中に進んだ v2 も）が届く
    const restored = await payload(await postChat(eventId, second.cookie));
    expect(restored.myKey).toEqual(firstKey);
    expect(restored.keys.map((k) => k.version)).toEqual([1, 2]);
    expect((await signerRow(eventId, second.userId))!.revoked_at).toBeNull();
  });
});

/* ===== 11.7 招待の状態遷移との突き合わせ ===== */

describe("承諾していない招待では鍵を取れない (#382 11.7)", () => {
  async function invitedUser(
    eventId: string,
    owner: TestUser,
  ): Promise<{ user: TestUser; inviteId: string }> {
    const user = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staff-invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ handle: user.username }),
    });
    expect(res.status).toBe(201);
    const { invites } = (await res.json()) as {
      invites: Array<{ id: string; user: { id: string } }>;
    };
    return {
      user,
      inviteId: invites.find((i) => i.user.id === user.userId)!.id,
    };
  }

  it("pending / declined / 取り消し済みのどの状態でも 403 のまま", async () => {
    const owner = await makeUser();
    const eventId = await createDraftEvent(owner);
    await payload(await postChat(eventId, owner.cookie));

    // pending: 承諾するまでメンバー行が無い
    const pending = await invitedUser(eventId, owner);
    expect((await getChat(eventId, pending.user.cookie)).status).toBe(403);
    expect((await postChat(eventId, pending.user.cookie)).status).toBe(403);

    // declined: 断った人
    const declined = await invitedUser(eventId, owner);
    const dec = await SELF.fetch(
      `${BASE}/api/me/staff-invites/${declined.inviteId}/decline`,
      { method: "POST", headers: { cookie: declined.user.cookie } },
    );
    expect(dec.status).toBe(200);
    expect((await getChat(eventId, declined.user.cookie)).status).toBe(403);

    // revoked: 運営が取り消した招待
    const revoked = await invitedUser(eventId, owner);
    const rev = await SELF.fetch(
      `${BASE}/api/events/${eventId}/staff-invites/${revoked.inviteId}`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
    );
    expect(rev.status).toBe(200);
    expect((await getChat(eventId, revoked.user.cookie)).status).toBe(403);
    expect((await postChat(eventId, revoked.user.cookie)).status).toBe(403);
  });
});
