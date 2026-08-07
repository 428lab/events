import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Event, EventMember, ParticipationSlot } from "@eventer/shared";

const BASE = "https://example.com";

/** 募集締切 (#269) のテスト用の時間軸。
 * 締切は「開始日時以前」しか許さないので、開始をかなり先に置いて
 * 「締切だけ過去」「締切も未来」の両方を作れるようにする */
const DAY = 86400000;
const STARTS_AT = Date.now() + 7 * DAY;
const ENDS_AT = STARTS_AT + DAY;

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 非adminのユーザーを1人作る（メンバーにはしない） */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** 公開イベントを作って ID を返す（既定では締切なし＝従来の振る舞い） */
async function setupEvent(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "募集締切テスト",
      venueType: "offline",
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      ...overrides,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: Event };
  const patch = await patchEvent(event.id, cookie, { status: "published" });
  expect(patch.status).toBe(200);
  return event.id;
}

function patchEvent(
  eventId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

/** 締切を設定する（PATCH が通ることまで確認） */
async function setDeadline(
  eventId: string,
  cookie: string,
  deadline: number | null,
): Promise<Event> {
  const res = await patchEvent(eventId, cookie, {
    registrationDeadline: deadline,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { event: Event }).event;
}

function joinEvent(
  eventId: string,
  cookie: string,
  slotId?: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(slotId ? { slotId } : {}),
  });
}

function leaveEvent(eventId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
    method: "DELETE",
    headers: { cookie },
  });
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

/** 先着枠を1つ作る */
async function createSlot(
  eventId: string,
  cookie: string,
  capacity: number,
): Promise<ParticipationSlot> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "一般枠",
      capacity,
      selectionType: "first_come",
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { slot: ParticipationSlot }).slot;
}

describe("募集締切 (#269)", () => {
  it("締切前は参加でき、締切を過ぎると 409 registration_closed", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    // 締切がまだ先なら従来どおり参加できる
    await setDeadline(eventId, admin, Date.now() + DAY);
    const before = await makeUser();
    const okRes = await joinEvent(eventId, before.cookie);
    expect(okRes.status).toBe(201);

    // 締切を過去に動かすと、新規の参加登録だけが断られる
    await setDeadline(eventId, admin, Date.now() - 1000);
    const after = await makeUser();
    const closed = await joinEvent(eventId, after.cookie);
    expect(closed.status).toBe(409);
    expect(await errorOf(closed)).toBe("registration_closed");

    // 締切後でもイベント自体は終わっていない（event_ended ではない）
    const detail = await SELF.fetch(`${BASE}/api/events/${eventId}`);
    const { event } = (await detail.json()) as { event: Event };
    expect(event.registrationDeadline).toBeLessThan(Date.now());
    expect(event.endsAt).toBeGreaterThan(Date.now());
  });

  it("締切が未設定なら従来どおり（開催中は参加でき、終了後は event_ended）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const detail = await SELF.fetch(`${BASE}/api/events/${eventId}`);
    const { event } = (await detail.json()) as { event: Event };
    expect(event.registrationDeadline).toBeNull();

    // 締切なし＝イベント終了まで受け付ける
    const user = await makeUser();
    expect((await joinEvent(eventId, user.cookie)).status).toBe(201);

    // 終了済みイベントは従来どおり event_ended（締切の判定に置き換わっていない）
    const endedId = await setupEvent(admin, {
      startsAt: Date.now() - 2 * DAY,
      endsAt: Date.now() - DAY,
    });
    const late = await makeUser();
    const ended = await joinEvent(endedId, late.cookie);
    expect(ended.status).toBe(409);
    expect(await errorOf(ended)).toBe("event_ended");
  });

  it("締切後でもキャンセルでき、キャンセル待ちの繰り上げも動く", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1);

    // 締切前に2人申し込む（定員1なので2人目はキャンセル待ち）
    const first = await makeUser();
    const second = await makeUser();
    const firstRes = await joinEvent(eventId, first.cookie, slot.id);
    expect(firstRes.status).toBe(201);
    expect(((await firstRes.json()) as { status: string }).status).toBe(
      "confirmed",
    );
    const secondRes = await joinEvent(eventId, second.cookie, slot.id);
    expect(secondRes.status).toBe(201);
    expect(((await secondRes.json()) as { status: string }).status).toBe(
      "waitlist",
    );

    // 締切後：確定者のキャンセルは通り、キャンセル待ちが繰り上がる
    await setDeadline(eventId, admin, Date.now() - 1000);
    const leave = await leaveEvent(eventId, first.cookie);
    expect(leave.status).toBe(200);
    expect(((await leave.json()) as { promotedUserId: string | null }).promotedUserId).toBe(
      second.userId,
    );

    // 繰り上がった側は確定になっている
    const row = await env.DB.prepare(
      "SELECT status FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, second.userId)
      .first<{ status: string }>();
    expect(row?.status).toBe("confirmed");

    // 空いた枠にも新規は入れない（締切が効いている）
    const latecomer = await makeUser();
    const closed = await joinEvent(eventId, latecomer.cookie, slot.id);
    expect(closed.status).toBe(409);
    expect(await errorOf(closed)).toBe("registration_closed");
  });

  it("締切後は、いったんキャンセルした人も再参加できない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    // 締切前に参加してからキャンセル（event_member の行はキャンセル済みで残る）
    const user = await makeUser();
    expect((await joinEvent(eventId, user.cookie)).status).toBe(201);
    expect((await leaveEvent(eventId, user.cookie)).status).toBe(200);
    const canceled = await env.DB.prepare(
      "SELECT status FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, user.userId)
      .first<{ status: string }>();
    expect(canceled?.status).toBe("canceled");

    // 締切後の再参加は 409。join が「既存メンバーなら素通し」に使う find が
    // キャンセル済みを返すようになると、キャンセル済みの人だけ締切をすり抜けて
    // 復活できてしまうので、その退行をここで捕まえる
    await setDeadline(eventId, admin, Date.now() - 1000);
    const rejoin = await joinEvent(eventId, user.cookie);
    expect(rejoin.status).toBe(409);
    expect(await errorOf(rejoin)).toBe("registration_closed");
    // 行はキャンセル済みのまま（復活していない）
    const after = await env.DB.prepare(
      "SELECT status FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, user.userId)
      .first<{ status: string }>();
    expect(after?.status).toBe("canceled");
  });

  it("締切と無関係な項目だけを PATCH しても締切は保持される", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const deadline = Date.now() - 1000;
    await setDeadline(eventId, admin, deadline);

    // registrationDeadline を含まない編集（タイトル・会場・チャット設定）。
    // update が「入力に無いキーは現在値を残す」をやめると、ここで締切が消えて
    // 「無関係な編集をしたら募集が勝手に再開する」退行になる
    const patched = await patchEvent(eventId, admin, {
      title: "タイトルだけ変更",
      venueOffline: "どこかの会場",
      chatEnabled: true,
    });
    expect(patched.status).toBe(200);
    const { event } = (await patched.json()) as { event: Event };
    expect(event.title).toBe("タイトルだけ変更");
    expect(event.registrationDeadline).toBe(deadline);

    // GET でも保持されていて、実際にまだ締め切られている
    const detail = await SELF.fetch(`${BASE}/api/events/${eventId}`);
    expect(
      ((await detail.json()) as { event: Event }).event.registrationDeadline,
    ).toBe(deadline);
    const late = await makeUser();
    const closed = await joinEvent(eventId, late.cookie);
    expect(closed.status).toBe(409);
    expect(await errorOf(closed)).toBe("registration_closed");
  });

  it("締切に 0 や負値は設定できない（未設定は null だけ）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    for (const bad of [0, -1]) {
      const res = await patchEvent(eventId, admin, {
        registrationDeadline: bad,
      });
      expect(res.status).toBe(400);
    }
    // 締切は付いていない（0 が入って「永久に締切済み」になっていない）
    const detail = await SELF.fetch(`${BASE}/api/events/${eventId}`);
    expect(
      ((await detail.json()) as { event: Event }).event.registrationDeadline,
    ).toBeNull();
  });

  it("締切ありのイベントは候補日の追加も日程の再確定もできない", async () => {
    const admin = await loginDev();

    // 日程調整中に候補日を足してから、PATCH で日程確定＋締切設定
    const eventId = await setupEvent(admin, {
      scheduling: true,
      startsAt: 0,
      endsAt: 0,
    });
    const addOption = await SELF.fetch(
      `${BASE}/api/events/${eventId}/date-options`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({
          startsAt: STARTS_AT - 3 * DAY,
          endsAt: STARTS_AT - 3 * DAY + DAY,
        }),
      },
    );
    expect(addOption.status).toBe(201);
    const { id: optionId } = (await addOption.json()) as { id: string };
    const fixed = await patchEvent(eventId, admin, {
      scheduling: false,
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      registrationDeadline: STARTS_AT - DAY,
    });
    expect(fixed.status).toBe(200);

    // 締切より前の開催日になる候補で確定しようとしても 400（PATCH と同じ不変条件）
    const finalize = await SELF.fetch(
      `${BASE}/api/events/${eventId}/finalize-date`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ optionId }),
      },
    );
    expect(finalize.status).toBe(400);
    expect(await errorOf(finalize)).toBe("deadline_after_start");

    // 締切があるうちは候補日そのものを足せない
    const addAfter = await SELF.fetch(
      `${BASE}/api/events/${eventId}/date-options`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ startsAt: STARTS_AT, endsAt: ENDS_AT }),
      },
    );
    expect(addAfter.status).toBe(400);
    expect(await errorOf(addAfter)).toBe("deadline_requires_fixed_date");

    // 開催日時は動いていない
    const detail = await SELF.fetch(`${BASE}/api/events/${eventId}`);
    const { event } = (await detail.json()) as { event: Event };
    expect(event.startsAt).toBe(STARTS_AT);
    expect(event.registrationDeadline).toBe(STARTS_AT - DAY);
  });

  it("締切後もスタッフのメンバー操作（ロール変更・当選操作・出席）はできる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 5);
    const member = await makeUser();
    expect((await joinEvent(eventId, member.cookie, slot.id)).status).toBe(201);

    await setDeadline(eventId, admin, Date.now() - 1000);

    // ロール変更（当日スタッフに引き上げる等）
    const role = await SELF.fetch(
      `${BASE}/api/events/${eventId}/members/${member.userId}/role`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ role: "staff" }),
      },
    );
    expect(role.status).toBe(200);
    expect(((await role.json()) as { member: EventMember }).member.role).toBe(
      "staff",
    );

    // 枠内ステータスの手動変更（当選/取消の運用）
    const status = await SELF.fetch(
      `${BASE}/api/events/${eventId}/slots/${slot.id}/members/${member.userId}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ status: "confirmed" }),
      },
    );
    expect(status.status).toBe(200);

    // 当日の出席チェック
    const attendance = await SELF.fetch(
      `${BASE}/api/events/${eventId}/members/${member.userId}/attendance`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ attended: true }),
      },
    );
    expect(attendance.status).toBe(200);
    expect(
      ((await attendance.json()) as { member: EventMember }).member.attended,
    ).toBe(true);
  });

  it("事前アンケートがあっても、締切後は survey_required より先に締切で止まる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const putQuestions = await SELF.fetch(
      `${BASE}/api/events/${eventId}/survey`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({
          questions: [{ question: "氏名", qtype: "text", required: true }],
        }),
      },
    );
    expect(putQuestions.status).toBe(200);

    // 締切前は従来どおりアンケート未回答で止まる (#152)
    const early = await makeUser();
    const needsSurvey = await joinEvent(eventId, early.cookie);
    expect(needsSurvey.status).toBe(409);
    expect(await errorOf(needsSurvey)).toBe("survey_required");

    // 締切後は、アンケートに回答させる前に締切で断る
    await setDeadline(eventId, admin, Date.now() - 1000);
    const late = await makeUser();
    const closed = await joinEvent(eventId, late.cookie);
    expect(closed.status).toBe(409);
    expect(await errorOf(closed)).toBe("registration_closed");
  });

  it("複製したイベントには締切がコピーされない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await setDeadline(eventId, admin, Date.now() + DAY);

    const dup = await SELF.fetch(`${BASE}/api/events/${eventId}/duplicate`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(dup.status).toBe(201);
    const { event } = (await dup.json()) as { event: Event };
    // 開催日時をリセットする挙動と揃えて締切も持ち越さない
    expect(event.registrationDeadline).toBeNull();
    expect(event.startsAt).toBe(0);
  });

  it("締切は開始日時以前しか設定できず、日程調整中は設定できない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    // 開始より後の締切は 400（開催中も受け付けたいなら締切なしにする）
    const after = await patchEvent(eventId, admin, {
      registrationDeadline: STARTS_AT + 1,
    });
    expect(after.status).toBe(400);
    expect(await errorOf(after)).toBe("deadline_after_start");

    // 開始ちょうどは許す
    await setDeadline(eventId, admin, STARTS_AT);

    // 締切を残したまま開始日時を締切より前に動かすのも 400（不変条件を保つ）
    const moveStart = await patchEvent(eventId, admin, {
      startsAt: STARTS_AT - DAY,
      endsAt: ENDS_AT,
    });
    expect(moveStart.status).toBe(400);
    expect(await errorOf(moveStart)).toBe("deadline_after_start");

    // null で締切を解除できる
    const cleared = await setDeadline(eventId, admin, null);
    expect(cleared.registrationDeadline).toBeNull();

    // 日程調整中（開催日未定）は締切を設定できない
    const schedulingId = await setupEvent(admin, {
      scheduling: true,
      startsAt: 0,
      endsAt: 0,
    });
    const scheduling = await patchEvent(schedulingId, admin, {
      registrationDeadline: Date.now() + DAY,
    });
    expect(scheduling.status).toBe(400);
    expect(await errorOf(scheduling)).toBe("deadline_requires_fixed_date");

    // 日程を確定すれば設定できる
    const finalize = await patchEvent(schedulingId, admin, {
      scheduling: false,
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      registrationDeadline: STARTS_AT - DAY,
    });
    expect(finalize.status).toBe(200);
    expect(
      ((await finalize.json()) as { event: Event }).event.registrationDeadline,
    ).toBe(STARTS_AT - DAY);
  });
});
