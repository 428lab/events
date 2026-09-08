import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@eventer/shared";

const BASE = "https://example.com/api/events";
const START = 1_900_000_000_000;
const END = START + 3_600_000;
let cookie: string;
let event: Event;

async function patch(body: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  const login = await SELF.fetch("https://example.com/api/auth/dev-login", { method: "POST" });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const created = await SELF.fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "日時順の検証", venueType: "offline", startsAt: START, endsAt: END }),
  });
  expect(created.status).toBe(201);
  event = ((await created.json()) as { event: Event }).event;
});

describe("PATCHイベントの更新後の日時順 (#495)", () => {
  it.each([
    { startsAt: END + 1 },
    { endsAt: START - 1 },
    { startsAt: END + 2, endsAt: END + 1 },
  ])("逆転する更新 %j を400にし、他の項目も含めDBを変えない", async (dates) => {
    const response = await patch({ ...dates, title: "保存されてはいけない", status: "published" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_date" });
    const stored = await env.DB.prepare("SELECT starts_at, ends_at, title, status FROM event WHERE id = ?")
      .bind(event.id).first();
    expect(stored).toEqual({ starts_at: START, ends_at: END, title: event.title, status: "draft" });
  });

  it.each([
    { startsAt: START - 1 },
    { endsAt: END + 1 },
    { startsAt: END + 1, endsAt: END + 2 },
    { startsAt: END },
    { endsAt: START },
  ])("正常な部分更新・両側更新・同時刻 %j は保存できる", async (dates) => {
    const response = await patch(dates);
    expect(response.status).toBe(200);
    const got = ((await response.json()) as { event: Event }).event;
    expect(got.startsAt).toBe(dates.startsAt ?? START);
    expect(got.endsAt).toBe(dates.endsAt ?? END);
  });

  it.each([
    { startsAt: 0, endsAt: END },
    { startsAt: START, endsAt: START },
  ])("scheduling:falseの厳しい確定条件 %j は維持する", async (dates) => {
    const response = await patch({ ...dates, scheduling: false });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_date" });
  });
});
