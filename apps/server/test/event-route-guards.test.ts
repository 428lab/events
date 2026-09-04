import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type {
  Entry,
  Event,
  EventMember,
  ParticipationSlot,
} from "@eventer/shared";

const BASE = "https://example.com";
const DAY = 86400000;

/**
 * `/api/events` を責務ごとに分けた (#466) ときに、経路ごとにコピーされていた
 * 検査を1か所へ寄せた。**寄せた検査が本当に効いているか**をここで押さえる。
 *
 * 見ているのは2つ:
 *
 * 1. **子リソースは親の所有を検証する**。`requireEventRole` が見ているのは
 *    `:id` のイベントに対する権限だけなので、`:slotId` や `:entryId` が
 *    そのイベントのものかを別に確かめないと、自分が staff のイベントの ID に
 *    他人のイベントの子 ID を付けるだけで他人の枠や成果物を触れてしまう。
 *    アプリ運営管理者で試しているので、**権限を最大にしても通らない**ことまで見る。
 *
 * 2. **未ログインでも読める GET の断り方**。イベントそのものは 404
 *    （下書きの存在ごと隠す）、配下の一覧は 403（存在は詳細GETで分かる）。
 *    この違いは意図なので、1本にまとめた前口上で潰れていないことを見る。
 */

/** dev-login（DevUser＝イベント作成者＝staff・アプリ運営管理者） */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** メンバーでもアプリ運営管理者でもないユーザーを1人作る */
async function makeOutsider(): Promise<string> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "部外者", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return `eventer_session=${sid}`;
}

async function createEvent(cookie: string, title: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title,
      venueType: "offline",
      startsAt: Date.now() + 7 * DAY,
      endsAt: Date.now() + 8 * DAY,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { event: Event }).event.id;
}

async function publish(cookie: string, eventId: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/publish`, {
    method: "POST",
    headers: { cookie },
  });
  expect(res.status).toBe(200);
}

async function createSlot(
  cookie: string,
  eventId: string,
  selectionType: "first_come" | "lottery" = "first_come",
): Promise<ParticipationSlot> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "一般枠", capacity: 10, selectionType }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { slot: ParticipationSlot }).slot;
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

describe("参加枠は親イベントの所有を検証する (#466)", () => {
  /** イベントA（操作する側）とイベントB（枠の持ち主）を作る */
  async function twoEvents(): Promise<{
    cookie: string;
    eventA: string;
    eventB: string;
    slotB: ParticipationSlot;
  }> {
    const cookie = await loginDev();
    const eventA = await createEvent(cookie, "操作する側");
    const eventB = await createEvent(cookie, "枠の持ち主");
    const slotB = await createSlot(cookie, eventB, "lottery");
    return { cookie, eventA, eventB, slotB };
  }

  it("他イベントの枠は更新できない（404。枠は元のまま）", async () => {
    const { cookie, eventA, eventB, slotB } = await twoEvents();
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventA}/slots/${slotB.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "乗っ取り", capacity: 1 }),
      },
    );
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("not_found");

    // 実体が動いていないことまで見る（404 を返しつつ書き換わっていた、を防ぐ）
    const list = await SELF.fetch(`${BASE}/api/events/${eventB}/slots`, {
      headers: { cookie },
    });
    const { slots } = (await list.json()) as { slots: ParticipationSlot[] };
    expect(slots).toHaveLength(1);
    expect(slots[0]!.name).toBe("一般枠");
    expect(slots[0]!.capacity).toBe(10);
  });

  it("他イベントの枠は削除できない（404。枠は残る）", async () => {
    const { cookie, eventA, eventB, slotB } = await twoEvents();
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventA}/slots/${slotB.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("not_found");

    const list = await SELF.fetch(`${BASE}/api/events/${eventB}/slots`, {
      headers: { cookie },
    });
    const { slots } = (await list.json()) as { slots: ParticipationSlot[] };
    expect(slots).toHaveLength(1);
  });

  it("他イベントの枠では抽選できない（404）", async () => {
    const { cookie, eventA, slotB } = await twoEvents();
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventA}/slots/${slotB.id}/draw`,
      { method: "POST", headers: { cookie } },
    );
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("not_found");
  });

  it("申込んでいない枠からは当落を動かせない（404。参加状態は元のまま）", async () => {
    const cookie = await loginDev();
    const eventId = await createEvent(cookie, "枠が2つあるイベント");
    const slotA = await createSlot(cookie, eventId, "lottery");
    const slotB = await createSlot(cookie, eventId, "lottery");
    await publish(cookie, eventId);

    // 参加者は slotA に申し込む（抽選枠なので applied で入る）
    const outsider = await makeOutsider();
    const join = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: outsider },
      body: JSON.stringify({ slotId: slotA.id }),
    });
    expect(join.status).toBe(201);
    const { member } = (await join.json()) as { member: EventMember };
    expect(member.status).toBe("applied");

    // slotB の当落として当選させようとしても通らない
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/slots/${slotB.id}/members/${member.userId}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ status: "confirmed" }),
      },
    );
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("not_found");

    // 参加状態が動いていないことまで見る
    const list = await SELF.fetch(`${BASE}/api/events/${eventId}/members`, {
      headers: { cookie },
    });
    const { members } = (await list.json()) as { members: EventMember[] };
    const after = members.find((m) => m.userId === member.userId)!;
    expect(after.status).toBe("applied");
    expect(after.slotId).toBe(slotA.id);
  });

  it("自分のイベントの枠なら通る（親の検証が全部を塞いでいない）", async () => {
    const cookie = await loginDev();
    const eventId = await createEvent(cookie, "自分のイベント");
    const slot = await createSlot(cookie, eventId);
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/slots/${slot.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "改名した枠" }),
      },
    );
    expect(res.status).toBe(200);
    const { slot: updated } = (await res.json()) as { slot: ParticipationSlot };
    expect(updated.name).toBe("改名した枠");
  });
});

describe("成果物は親イベントの所有を検証する (#466)", () => {
  it("他イベントの Entry には成果物を保存できない（404）", async () => {
    const cookie = await loginDev();
    const eventA = await createEvent(cookie, "操作する側");
    const eventB = await createEvent(cookie, "Entry の持ち主");
    await publish(cookie, eventB);

    // 作成者は staff なので join では Entry ができない。参加者を1人入れる
    const outsider = await makeOutsider();
    const join = await SELF.fetch(`${BASE}/api/events/${eventB}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: outsider },
      body: JSON.stringify({}),
    });
    expect(join.status).toBe(201);
    const entries = await SELF.fetch(`${BASE}/api/events/${eventB}/entries`, {
      headers: { cookie },
    });
    const entryId = ((await entries.json()) as { entries: Entry[] }).entries[0]!
      .id;

    const res = await SELF.fetch(
      `${BASE}/api/events/${eventA}/entries/${entryId}/submission`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: outsider },
        body: JSON.stringify({ presentationUrl: "https://example.com/x" }),
      },
    );
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("not_found");
  });

  it("同じイベントでも、他人の Entry には成果物を保存できない（403）", async () => {
    const cookie = await loginDev();
    const eventId = await createEvent(cookie, "成果物の持ち主テスト");
    await publish(cookie, eventId);

    // 参加者を2人入れる。個人参加なので Entry は1人1つできる
    const owner = await makeOutsider();
    const other = await makeOutsider();
    for (const c of [owner, other]) {
      const join = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: c },
        body: JSON.stringify({}),
      });
      expect(join.status).toBe(201);
    }

    const list = await SELF.fetch(`${BASE}/api/events/${eventId}/entries`, {
      headers: { cookie: owner },
    });
    const { entries } = (await list.json()) as { entries: Entry[] };
    expect(entries).toHaveLength(2);

    // owner が両方の Entry に保存を試みる。**自分のぶんだけ 200、他人のぶんは 403**。
    // owner はこのイベントの参加確定メンバーなので、
    // 「イベントに入っていれば誰の成果物でも書ける」になっていないことを見る
    const statuses: number[] = [];
    for (const entry of entries) {
      const res = await SELF.fetch(
        `${BASE}/api/events/${eventId}/entries/${entry.id}/submission`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", cookie: owner },
          body: JSON.stringify({ presentationUrl: "https://example.com/x" }),
        },
      );
      if (res.status === 403) expect(await errorOf(res)).toBe("forbidden");
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 403)).toHaveLength(1);
  });
});

describe("公開GETの閲覧権限と断り方 (#466)", () => {
  /** 下書きのイベントと、そのイベントと無関係なユーザー */
  async function draftAndOutsider(): Promise<{
    eventId: string;
    outsider: string;
  }> {
    const cookie = await loginDev();
    const eventId = await createEvent(cookie, "下書きイベント");
    return { eventId, outsider: await makeOutsider() };
  }

  it("イベントそのものは 404 で存在ごと隠す", async () => {
    const { eventId, outsider } = await draftAndOutsider();
    for (const path of ["", "/schedule"]) {
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}${path}`, {
        headers: { cookie: outsider },
      });
      expect(res.status, path).toBe(404);
      expect(await errorOf(res)).toBe("not_found");
    }
  });

  it("イベント配下の一覧は 403 で断る", async () => {
    const { eventId, outsider } = await draftAndOutsider();
    for (const path of ["/entries", "/submissions", "/members", "/slots"]) {
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}${path}`, {
        headers: { cookie: outsider },
      });
      expect(res.status, path).toBe(403);
      expect(await errorOf(res)).toBe("forbidden");
    }
  });

  it("未ログインでも公開イベントは全部読める（requireAuth の手前にある）", async () => {
    const cookie = await loginDev();
    const eventId = await createEvent(cookie, "公開イベント");
    await publish(cookie, eventId);
    for (const path of [
      "",
      "/schedule",
      "/entries",
      "/submissions",
      "/members",
      "/slots",
    ]) {
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}${path}`);
      expect(res.status, path).toBe(200);
    }
  });

  it("存在しないイベントはどの経路でも 404", async () => {
    const missing = crypto.randomUUID();
    for (const path of ["", "/schedule", "/entries", "/members", "/slots"]) {
      const res = await SELF.fetch(`${BASE}/api/events/${missing}${path}`);
      expect(res.status, path).toBe(404);
    }
  });
});
