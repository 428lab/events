import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@eventer/shared";

/**
 * イベントの会場の住所（venue_address, 0103）。会場名（venueOffline）とは別の列で、
 * 作成・更新・取得で往復し、null で消せる。上限は会場名と同じ 500 文字。
 */

const BASE = "https://example.com/api/events";
const ADDRESS = "東京都千代田区丸の内1-9-1";
let cookie: string;

async function create(body: Record<string, unknown>) {
  return SELF.fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "住所の検証", venueType: "offline", ...body }),
  });
}

async function patch(id: string, body: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function get(id: string, withCookie = true): Promise<Event> {
  const res = await SELF.fetch(`${BASE}/${id}`, withCookie ? { headers: { cookie } } : {});
  expect(res.status).toBe(200);
  return ((await res.json()) as { event: Event }).event;
}

async function storedAddress(id: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT venue_address FROM event WHERE id = ?")
    .bind(id).first<{ venue_address: string | null }>();
  return row!.venue_address;
}

beforeEach(async () => {
  const login = await SELF.fetch("https://example.com/api/auth/dev-login", { method: "POST" });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});

describe("イベントの会場の住所 (venue_address)", () => {
  it("マイグレーション 0103 で event に venue_address 列（NULL 可の TEXT）がある", async () => {
    const cols = (await env.DB.prepare("PRAGMA table_info(event)").all<{
      name: string; type: string; notnull: number; dflt_value: unknown;
    }>()).results;
    const col = cols.find((c) => c.name === "venue_address");
    expect(col).toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null });
  });

  it("作成で会場名と住所を別々に保存し、取得で返す", async () => {
    const res = await create({ venueOffline: "丸の内ホール", venueAddress: ADDRESS });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: Event };
    expect(event.venueOffline).toBe("丸の内ホール");
    expect(event.venueAddress).toBe(ADDRESS);
    expect(await storedAddress(event.id)).toBe(ADDRESS);
    expect((await get(event.id)).venueAddress).toBe(ADDRESS);
  });

  it("住所を送らずに作ると null（既存の表示は変わらない）", async () => {
    const res = await create({ venueOffline: "会場だけ" });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: Event };
    expect(event.venueAddress).toBeNull();
    expect(await storedAddress(event.id)).toBeNull();
  });

  it("更新で住所を変え、null で消せる。住所を送らない更新では残る", async () => {
    const { event } = (await (await create({ venueOffline: "会場" })).json()) as { event: Event };

    const set = await patch(event.id, { venueAddress: ADDRESS });
    expect(set.status).toBe(200);
    expect((await get(event.id)).venueAddress).toBe(ADDRESS);

    const other = await patch(event.id, { title: "題名だけ変える" });
    expect(other.status).toBe(200);
    expect((await get(event.id)).venueAddress).toBe(ADDRESS);

    const cleared = await patch(event.id, { venueAddress: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { event: Event }).event.venueAddress).toBeNull();
    expect(await storedAddress(event.id)).toBeNull();
    expect((await get(event.id)).venueOffline).toBe("会場");
  });

  it("500 文字までは保存でき、501 文字は作成・更新とも 400", async () => {
    const ok = await create({ venueAddress: "あ".repeat(500) });
    expect(ok.status).toBe(201);
    const { event } = (await ok.json()) as { event: Event };
    expect(event.venueAddress).toHaveLength(500);

    expect((await create({ venueAddress: "あ".repeat(501) })).status).toBe(400);
    expect((await patch(event.id, { venueAddress: "あ".repeat(501) })).status).toBe(400);
    expect(await storedAddress(event.id)).toHaveLength(500);
  });

  it("公開イベントの住所はログインしていない人にも返る", async () => {
    const { event } = (await (await create({ venueAddress: ADDRESS })).json()) as { event: Event };
    expect((await patch(event.id, { status: "published" })).status).toBe(200);
    expect((await get(event.id, false)).venueAddress).toBe(ADDRESS);
  });
});
