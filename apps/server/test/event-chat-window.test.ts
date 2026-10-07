import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  chatWriteWindow,
  isChatWritable,
  updateEventInput,
} from "@eventer/shared";
import type {
  ChatMembersPayload,
  EncryptedChatPayload,
  Event,
} from "@eventer/shared";
import {
  BASE,
  HOUR,
  loginDev,
  makeMember,
  makeUser,
} from "./lib/staffDutyHelpers.js";

/**
 * 参加者チャットに書き込める期間 (#578)。
 *
 * - 共有の chatWriteWindow / isChatWritable（web の入力欄とサーバーのペイロードが同じ関数）
 * - 共有の zod スキーマでの検証（30 / 1〜30日 / null、終わりは 2時間・1日・7日）
 * - マイグレーション 0106 の既定値（既存のイベントは従来の「開始30分前〜終了2時間後」のまま）
 * - 更新の往復、chat-members / encrypted-chat のペイロードの writeWindow
 *
 * サーバーは本文を経由しない（ブラウザ⇔リレー直通）。発行した鍵は読むのにも使うので、
 * 期間外に鍵の発行を止めると読めなくなる。そのため期間はサーバー側では止めず、
 * 入力欄だけが閉じる（最後の describe がその約束を固定する）。
 */

const MIN = 60_000;
const DAY = 24 * HOUR;
const STARTS = 1_700_000_000_000;
const ENDS = STARTS + 2 * HOUR;

function settings(chatOpenBeforeMinutes: number | null, chatCloseAfterMinutes: number) {
  return { startsAt: STARTS, endsAt: ENDS, chatOpenBeforeMinutes, chatCloseAfterMinutes };
}

describe("chatWriteWindow / isChatWritable (#578)", () => {
  it("既定（開始30分前〜終了2時間後）: 両端を含む", () => {
    const e = settings(30, 120);
    expect(chatWriteWindow(e)).toEqual({ opensAt: STARTS - 30 * MIN, closesAt: ENDS + 2 * HOUR });
    expect(isChatWritable(e, STARTS - 30 * MIN - 1)).toBe(false);
    expect(isChatWritable(e, STARTS - 30 * MIN)).toBe(true);
    expect(isChatWritable(e, ENDS + 2 * HOUR)).toBe(true);
    expect(isChatWritable(e, ENDS + 2 * HOUR + 1)).toBe(false);
  });

  it("参加が確定したらすぐ（null）: 下限なし、終わりは選んだとおり", () => {
    const e = settings(null, 120);
    expect(chatWriteWindow(e)).toEqual({ opensAt: null, closesAt: ENDS + 2 * HOUR });
    expect(isChatWritable(e, 0)).toBe(true);
    expect(isChatWritable(e, STARTS - 365 * DAY)).toBe(true);
    expect(isChatWritable(e, ENDS + 2 * HOUR + 1)).toBe(false);
  });

  it.each([1, 3, 30])("開始の %i 日前から", (n) => {
    const e = settings(n * 1440, 120);
    expect(chatWriteWindow(e).opensAt).toBe(STARTS - n * DAY);
    expect(isChatWritable(e, STARTS - n * DAY - 1)).toBe(false);
    expect(isChatWritable(e, STARTS - n * DAY)).toBe(true);
  });

  it.each([
    [1440, DAY],
    [10080, 7 * DAY],
  ])("終了 %i 分後まで", (minutes, ms) => {
    const e = settings(30, minutes);
    expect(chatWriteWindow(e).closesAt).toBe(ENDS + ms);
    expect(isChatWritable(e, ENDS + ms)).toBe(true);
    expect(isChatWritable(e, ENDS + ms + 1)).toBe(false);
  });
});

describe("updateEventInput の検証 (#578)", () => {
  const parse = (body: object) => updateEventInput.safeParse(body).success;

  it("選択肢の値は通る", () => {
    for (const open of [30, null, 1440, 3 * 1440, 30 * 1440]) {
      expect(parse({ chatOpenBeforeMinutes: open }), String(open)).toBe(true);
    }
    for (const close of [120, 1440, 10080]) {
      expect(parse({ chatCloseAfterMinutes: close }), String(close)).toBe(true);
    }
  });

  it("選択肢にない値は弾く", () => {
    for (const open of [0, 29, 60, 1441, 31 * 1440, -1440, 1.5, "30"]) {
      expect(parse({ chatOpenBeforeMinutes: open }), String(open)).toBe(false);
    }
    for (const close of [0, 119, 121, 2 * 1440, null, "120"]) {
      expect(parse({ chatCloseAfterMinutes: close }), String(close)).toBe(false);
    }
  });
});

describe("書き込める期間の保存 (#578)", () => {
  async function createEvent(cookie: string): Promise<Event> {
    const res = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "書き込める期間の検証",
        venueType: "offline",
        startsAt: Date.now() + 3 * DAY,
        endsAt: Date.now() + 3 * DAY + 2 * HOUR,
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { event: Event }).event;
  }

  function patch(id: string, cookie: string, body: object) {
    return SELF.fetch(`${BASE}/api/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
  }

  async function stored(id: string) {
    return env.DB.prepare(
      "SELECT chat_open_before_minutes AS open, chat_close_after_minutes AS close FROM event WHERE id = ?",
    )
      .bind(id)
      .first<{ open: number | null; close: number }>();
  }

  it("マイグレーション 0106: 列の型と既定値（NULL 可の 30 / NOT NULL の 120）", async () => {
    const cols = (
      await env.DB.prepare("PRAGMA table_info(event)").all<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }>()
    ).results;
    expect(cols.find((c) => c.name === "chat_open_before_minutes")).toMatchObject({
      type: "INTEGER",
      notnull: 0,
      dflt_value: "30",
    });
    expect(cols.find((c) => c.name === "chat_close_after_minutes")).toMatchObject({
      type: "INTEGER",
      notnull: 1,
      dflt_value: "120",
    });
  });

  it("列を指定しない既存の形の行は従来の期間になり、API でもそう返る", async () => {
    const cookie = await loginDev();
    const owner = await makeUser();
    const id = crypto.randomUUID();
    // 0106 より前のコードと同じ列だけで INSERT する（既存のイベント行の相当）
    await env.DB.prepare(
      `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at)
       VALUES (?, '既存のイベント', ?, ?, 'offline', 'published', ?, ?)`,
    )
      .bind(id, STARTS, ENDS, owner.userId, Date.now())
      .run();
    expect(await stored(id)).toEqual({ open: 30, close: 120 });
    const res = await SELF.fetch(`${BASE}/api/events/${id}`, { headers: { cookie } });
    const { event } = (await res.json()) as { event: Event };
    expect(event.chatOpenBeforeMinutes).toBe(30);
    expect(event.chatCloseAfterMinutes).toBe(120);
  });

  it("新規作成は既定値。更新で変え、送らない更新では残り、null（参加確定したらすぐ）も往復する", async () => {
    const cookie = await loginDev();
    const event = await createEvent(cookie);
    expect(event.chatOpenBeforeMinutes).toBe(30);
    expect(event.chatCloseAfterMinutes).toBe(120);

    const set = await patch(event.id, cookie, {
      chatOpenBeforeMinutes: 3 * 1440,
      chatCloseAfterMinutes: 10080,
    });
    expect(set.status).toBe(200);
    expect((await set.json()) as { event: Event }).toMatchObject({
      event: { chatOpenBeforeMinutes: 3 * 1440, chatCloseAfterMinutes: 10080 },
    });
    expect(await stored(event.id)).toEqual({ open: 3 * 1440, close: 10080 });

    expect((await patch(event.id, cookie, { title: "題名だけ" })).status).toBe(200);
    expect(await stored(event.id)).toEqual({ open: 3 * 1440, close: 10080 });

    const immediate = await patch(event.id, cookie, { chatOpenBeforeMinutes: null });
    expect(immediate.status).toBe(200);
    expect(((await immediate.json()) as { event: Event }).event.chatOpenBeforeMinutes).toBeNull();
    expect(await stored(event.id)).toEqual({ open: null, close: 10080 });
  });

  it("選択肢にない値は 400 で、保存済みの値は変わらない", async () => {
    const cookie = await loginDev();
    const event = await createEvent(cookie);
    expect((await patch(event.id, cookie, { chatOpenBeforeMinutes: 45 })).status).toBe(400);
    expect((await patch(event.id, cookie, { chatOpenBeforeMinutes: 31 * 1440 })).status).toBe(400);
    expect((await patch(event.id, cookie, { chatCloseAfterMinutes: 60 })).status).toBe(400);
    expect(await stored(event.id)).toEqual({ open: 30, close: 120 });
  });
});

describe("チャットのペイロードの writeWindow (#578)", () => {
  /** 公開済み・日程確定・チャット有効のイベント（3日後に開始）を作る */
  async function publishedEvent(
    cookie: string,
    body: object = {},
  ): Promise<{ id: string; event: Event }> {
    const startsAt = Date.now() + 3 * DAY;
    const res = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "ペイロードの検証",
        venueType: "offline",
        startsAt,
        endsAt: startsAt + 2 * HOUR,
      }),
    });
    const { event } = (await res.json()) as { event: Event };
    const patched = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "published", chatEnabled: true, ...body }),
    });
    expect(patched.status, await patched.clone().text()).toBe(200);
    return { id: event.id, event: ((await patched.json()) as { event: Event }).event };
  }

  it("chat-members は chatWriteWindow で計算した期間を返す（既定と変更後）", async () => {
    const cookie = await loginDev();
    const { id, event } = await publishedEvent(cookie);
    const member = await makeMember(id, "participant");
    const get = async () =>
      (await (
        await SELF.fetch(`${BASE}/api/events/${id}/chat-members`, {
          headers: { cookie: member.cookie },
        })
      ).json()) as ChatMembersPayload;

    expect((await get()).writeWindow).toEqual(chatWriteWindow(event));
    expect((await get()).writeWindow.opensAt).toBe(event.startsAt - 30 * MIN);

    await SELF.fetch(`${BASE}/api/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ chatOpenBeforeMinutes: null, chatCloseAfterMinutes: 1440 }),
    });
    expect((await get()).writeWindow).toEqual({
      opensAt: null,
      closesAt: event.endsAt + DAY,
    });
  });

  it("encrypted-chat も同じ期間を返す", async () => {
    const cookie = await loginDev();
    const { id, event } = await publishedEvent(cookie, {
      chatEncrypted: true,
      chatOpenBeforeMinutes: 7 * 1440,
    });
    const member = await makeMember(id, "participant");
    const res = await SELF.fetch(`${BASE}/api/events/${id}/encrypted-chat`, {
      method: "POST",
      headers: { cookie: member.cookie },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const payload = (await res.json()) as EncryptedChatPayload;
    expect(payload.writeWindow).toEqual({
      opensAt: event.startsAt - 7 * DAY,
      closesAt: event.endsAt + 2 * HOUR,
    });
  });

  it("期間外でも鍵の発行と読み取りは止めない（鍵は読むのにも使う。閉じるのは入力欄だけ）", async () => {
    const cookie = await loginDev();
    // 3日後に開始・既定（30分前から）＝いまは期間外
    const { id, event } = await publishedEvent(cookie);
    expect(isChatWritable(event, Date.now())).toBe(false);
    const member = await makeMember(id, "participant");

    const key = await SELF.fetch(`${BASE}/api/events/${id}/chat-key/ephemeral`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: "{}",
    });
    expect(key.status).toBe(200);
    const members = await SELF.fetch(`${BASE}/api/events/${id}/chat-members`, {
      headers: { cookie: member.cookie },
    });
    expect(members.status).toBe(200);
    const payload = (await members.json()) as ChatMembersPayload;
    expect(payload.members.some((m) => m.userId === member.userId)).toBe(true);
    expect(isChatWritable({ ...event, chatOpenBeforeMinutes: null }, Date.now())).toBe(true);
  });
});
