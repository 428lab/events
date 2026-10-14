import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { bindEnv, type Env } from "../src/runtime.js";
import { PUBLISH_DUE_EVENTS_SQL, publishDueEvents } from "../src/lib/scheduledPublish.js";

// 予約公開 (D-EVENT-SCHEDULED-PUBLISH)。設計 docs/event-scheduled-publish.md §8.1
const BASE = "https://example.com";

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function makeUser(): Promise<{ userId: string; username: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  ).bind(uid, `nostr:${uid}`, username, "テスト", Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, uid, Date.now() + 86400000).run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

type EventBody = { event: { id: string; status: string; publishAt: number | null; accessRevision: number } };

async function createDraft(cookie: string): Promise<EventBody["event"]> {
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: `予約公開_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "online",
      startsAt: Date.now() + 7 * 86400_000,
      endsAt: Date.now() + 7 * 86400_000 + 3600_000,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as EventBody).event;
}

function patch(cookie: string, id: string, body: object): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function getEvent(cookie: string, id: string): Promise<EventBody["event"]> {
  const res = await SELF.fetch(`${BASE}/api/events/${id}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as EventBody).event;
}

/** 1時間以上先の、30分区切りの時刻（予約は毎時0分・30分だけ） */
function nextSlot(): number {
  return Math.ceil((Date.now() + 3600_000) / 1800_000) * 1800_000;
}

async function schedule(cookie: string, id: string, publishAt: number): Promise<EventBody["event"]> {
  const current = await getEvent(cookie, id);
  const res = await patch(cookie, id, { publishAt, expectedAccessRevision: current.accessRevision });
  expect(res.status).toBe(200);
  return ((await res.json()) as EventBody).event;
}

/** 予約を過去に動かす（API は過去の時刻を受け付けないので、時刻が来た状態を DB で作る） */
async function makeDue(id: string): Promise<void> {
  await env.DB.prepare("UPDATE event SET publish_at = ? WHERE id = ?").bind(Date.now() - 1000, id).run();
}

async function followerPublishNotices(cookie: string): Promise<number> {
  const res = await SELF.fetch(`${BASE}/api/notifications`, { headers: { cookie } });
  const { notifications } = (await res.json()) as { notifications: { type: string }[] };
  return notifications.filter((n) => n.type === "followee_created_event").length;
}

async function followHost(host: string): Promise<{ cookie: string }> {
  const follower = await makeUser();
  const me = (await (await SELF.fetch(`${BASE}/api/auth/me`, { headers: { cookie: host } })).json()) as {
    user: { username: string };
  };
  const res = await SELF.fetch(`${BASE}/api/users/${me.user.username}/follow`, {
    method: "POST",
    headers: { cookie: follower.cookie },
  });
  expect(res.status).toBe(200);
  return follower;
}

describe("予約公開 (D-EVENT-SCHEDULED-PUBLISH)", () => {
  it("予約を設定・取り消しでき、下書きのまま公開日時が返る", async () => {
    const host = await loginDev();
    const draft = await createDraft(host);
    expect(draft.publishAt).toBeNull();
    const at = nextSlot();
    const scheduled = await schedule(host, draft.id, at);
    expect(scheduled).toMatchObject({ status: "draft", publishAt: at });
    expect(scheduled.accessRevision).toBe(draft.accessRevision + 1);

    const cancel = await patch(host, draft.id, { publishAt: null, expectedAccessRevision: scheduled.accessRevision });
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as EventBody).event).toMatchObject({ status: "draft", publishAt: null });
  });

  it("過去の日時・30分区切りでない時刻・公開と同時の予約は 400、revision なしの予約変更は 409", async () => {
    const host = await loginDev();
    const draft = await createDraft(host);
    const past = await patch(host, draft.id, { publishAt: Date.now() - 60_000, expectedAccessRevision: draft.accessRevision });
    expect(past.status).toBe(400);
    expect(await past.json()).toEqual({ error: "publish_at_past" });

    const withPublish = await patch(host, draft.id, {
      status: "published",
      publishAt: nextSlot(),
      expectedAccessRevision: draft.accessRevision,
    });
    expect(withPublish.status).toBe(400);
    expect(await withPublish.json()).toEqual({ error: "publish_at_invalid" });

    const unaligned = await patch(host, draft.id, { publishAt: nextSlot() + 60_000, expectedAccessRevision: draft.accessRevision });
    expect(unaligned.status).toBe(400);
    expect(await unaligned.json()).toEqual({ error: "publish_at_unaligned" });

    const noRevision = await patch(host, draft.id, { publishAt: nextSlot() });
    expect(noRevision.status).toBe(409);
    expect(await noRevision.json()).toEqual({ error: "publish_state_changed" });
    expect((await getEvent(host, draft.id)).publishAt).toBeNull();
  });

  it("時刻を過ぎた予約だけを1回だけ公開し、フォロワーへの通知も1件だけ", async () => {
    const host = await loginDev();
    const follower = await followHost(host);
    const due = await createDraft(host);
    const later = await createDraft(host);
    await schedule(host, due.id, nextSlot());
    const laterScheduled = await schedule(host, later.id, nextSlot());
    await makeDue(due.id);

    // 未ログインでは公開前は見えない
    expect((await SELF.fetch(`${BASE}/api/events/${due.id}`)).status).toBe(404);
    const before = await getEvent(host, due.id);

    // 実行が重なっても、行を変えた側だけが id を受け取る
    const [a, b] = await Promise.all([publishDueEvents(), publishDueEvents()]);
    const all = [...a.published, ...b.published];
    expect(all.filter((id) => id === due.id)).toHaveLength(1);
    expect(all).not.toContain(later.id);

    const after = await getEvent(host, due.id);
    expect(after).toMatchObject({ status: "published", publishAt: null });
    expect(after.accessRevision).toBe(before.accessRevision + 1);
    expect((await SELF.fetch(`${BASE}/api/events/${due.id}`)).status).toBe(200);
    expect(await getEvent(host, later.id)).toMatchObject({ status: "draft", publishAt: laterScheduled.publishAt });

    expect(await followerPublishNotices(follower.cookie)).toBe(1);
    expect((await publishDueEvents()).published).not.toContain(due.id);
    expect(await followerPublishNotices(follower.cookie)).toBe(1);
  });

  it("予約中に今すぐ公開すると予約が消え、時刻が来ても二重に動かない", async () => {
    const host = await loginDev();
    const follower = await followHost(host);
    const draft = await createDraft(host);
    await schedule(host, draft.id, nextSlot());
    const res = await SELF.fetch(`${BASE}/api/events/${draft.id}/publish`, { method: "POST", headers: { cookie: host } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as EventBody).event).toMatchObject({ status: "published", publishAt: null });
    expect(await followerPublishNotices(follower.cookie)).toBe(1);
    expect((await publishDueEvents()).published).not.toContain(draft.id);
    expect(await followerPublishNotices(follower.cookie)).toBe(1);
  });

  it("取り消した予約は時刻が来ても公開しない", async () => {
    const host = await loginDev();
    const draft = await createDraft(host);
    const scheduled = await schedule(host, draft.id, nextSlot());
    await patch(host, draft.id, { publishAt: null, expectedAccessRevision: scheduled.accessRevision });
    expect((await publishDueEvents(Date.now() + 2 * 3600_000)).published).not.toContain(draft.id);
    expect((await getEvent(host, draft.id)).status).toBe("draft");
  });

  it("自動公開のあと、古い編集フォームの status: draft は 409 で、公開のまま", async () => {
    const host = await loginDev();
    const draft = await createDraft(host);
    const scheduled = await schedule(host, draft.id, nextSlot());
    await makeDue(draft.id);
    expect((await publishDueEvents()).published).toContain(draft.id);

    // 読み込んだ時点の revision を付けても、自動公開で上がっているので合わない
    const stale = await patch(host, draft.id, { status: "draft", title: "古いフォーム", expectedAccessRevision: scheduled.accessRevision });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "publish_state_changed" });
    const noRevision = await patch(host, draft.id, { status: "draft", title: "古いフォーム" });
    expect(noRevision.status).toBe(409);
    expect(await getEvent(host, draft.id)).toMatchObject({ status: "published" });
  });

  it("手動実行 API は app admin だけ", async () => {
    const user = await makeUser();
    const denied = await SELF.fetch(`${BASE}/api/admin/run-scheduled-publish`, { method: "POST", headers: { cookie: user.cookie } });
    expect(denied.status).toBe(403);

    const host = await loginDev();
    const draft = await createDraft(host);
    await schedule(host, draft.id, nextSlot());
    await makeDue(draft.id);
    const res = await SELF.fetch(`${BASE}/api/admin/run-scheduled-publish`, { method: "POST", headers: { cookie: host } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { published: string[] }).published).toContain(draft.id);
  });

  it("時刻を過ぎた予約を探す UPDATE は部分索引 idx_event_publish_at を使う（下書きを全部読まない）", async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${PUBLISH_DUE_EVENTS_SQL}`).bind(Date.now()).all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);
    expect(details.some((d) => d.includes("idx_event_publish_at"))).toBe(true);
    expect(details.some((d) => d.includes("idx_event_status"))).toBe(false);
  });
});
