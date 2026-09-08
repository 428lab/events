import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { MyEventSummary } from "@eventer/shared";

const BASE = "https://example.com";

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  return res.headers.get("set-cookie")!.split(";")[0];
}

const json = (cookie: string) => ({ "content-type": "application/json", cookie });

/** 2人目のユーザーとセッション（参加者役）。dev-login は1人分しか作れない */
async function makeUser(): Promise<string> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "参加者", Date.now())
    .run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return `eventer_session=${sid}`;
}

async function publishedEvent(cookie: string): Promise<string> {
  const now = Date.now();
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: json(cookie),
    body: JSON.stringify({
      title: `myStatus_${crypto.randomUUID().slice(0, 8)}`,
      venueType: "online",
      startsAt: now + 3600_000,
      endsAt: now + 7200_000,
    }),
  });
  const id = ((await create.json()) as { event: { id: string } }).event.id;
  await SELF.fetch(`${BASE}/api/events/${id}/publish`, { method: "POST", headers: json(cookie) });
  return id;
}

async function addSlot(
  cookie: string,
  eventId: string,
  body: { name: string; capacity: number; selectionType: "first_come" | "lottery" },
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/slots`, {
    method: "POST",
    headers: json(cookie),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { slot: { id: string } }).slot.id;
}

async function join(cookie: string, eventId: string, slotId: string): Promise<number> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
    method: "POST",
    headers: json(cookie),
    body: JSON.stringify({ slotId }),
  });
  return res.status;
}

async function myOngoing(cookie: string): Promise<MyEventSummary[]> {
  const res = await SELF.fetch(`${BASE}/api/me/events`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { ongoing: MyEventSummary[] }).ongoing;
}

/**
 * `/api/me/events` が本人の参加状態 (`myStatus`) を返す (#489 レビュー指摘)。
 *
 * この API は `status <> 'canceled'` なので抽選待ちもキャンセル待ちも載る。
 * ホームの「次のイベント」は参加確定だけを出したいが、イベントの `status`
 * （公開状態）からは判別できない。契約として `myStatus` が載ることを、
 * **実際の申込経路**（抽選枠・定員超過）で作った行に対して固定する。
 */
describe("/api/me/events の myStatus (#489)", () => {
  it("主催者は confirmed", async () => {
    const staff = await loginDev();
    const eventId = await publishedEvent(staff);
    const mine = (await myOngoing(staff)).find((e) => e.id === eventId);
    expect(mine?.myStatus).toBe("confirmed");
    expect(mine?.myRole).toBe("staff");
  });

  it("抽選枠に申し込んだ参加者は applied（published でも参加は未確定）", async () => {
    const staff = await loginDev();
    const eventId = await publishedEvent(staff);
    const slot = await addSlot(staff, eventId, { name: "抽選", capacity: 5, selectionType: "lottery" });
    const user = await makeUser();
    expect(await join(user, eventId, slot)).toBeLessThan(300);

    const mine = (await myOngoing(user)).find((e) => e.id === eventId);
    expect(mine).toBeTruthy();
    // イベント自体は公開済み。ここだけ見ると「行ける」ように見えるが……
    expect(mine!.status).toBe("published");
    // ……本人はまだ抽選待ち。ホームはこちらで絞る
    expect(mine!.myStatus).toBe("applied");
  });

  it("先着枠が満員のときの申込は waitlist", async () => {
    const staff = await loginDev();
    const eventId = await publishedEvent(staff);
    const slot = await addSlot(staff, eventId, { name: "先着1名", capacity: 1, selectionType: "first_come" });
    const first = await makeUser();
    const second = await makeUser();
    expect(await join(first, eventId, slot)).toBeLessThan(300);
    expect(await join(second, eventId, slot)).toBeLessThan(300);

    expect((await myOngoing(first)).find((e) => e.id === eventId)?.myStatus).toBe("confirmed");
    expect((await myOngoing(second)).find((e) => e.id === eventId)?.myStatus).toBe("waitlist");
  });

  it("全件に myStatus が載る（undefined が混ざると画面の絞り込みが黙って落ちる）", async () => {
    const staff = await loginDev();
    await publishedEvent(staff);
    for (const e of await myOngoing(staff)) {
      expect(["confirmed", "waitlist", "applied", "lost"], e.title).toContain(e.myStatus);
    }
  });
});
