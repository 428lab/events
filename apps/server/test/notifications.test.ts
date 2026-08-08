import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import {
  NOTIFICATION_PAGE_SIZE,
  type NotificationsPayload,
} from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { notificationsRepo } from "../src/db/repositories/notifications.js";

/**
 * お知らせの取得と一覧 (#294)。
 *
 * 通知は本人あてにしか出してはいけないこと、通知は消えずに溜まるので
 * 全件返す作りになっていないこと、一斉連絡 (#172) の本文が途中で切れずに
 * 返ること（一覧で読み直せなければ #294 は解決しない）を検証する。
 */

const BASE = "https://example.com";

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(
      uid,
      `nostr:${uid}`,
      `u_${uid.slice(0, 6)}`,
      `表示_${uid.slice(0, 4)}`,
      Date.now(),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** 通知を1件作る。created_at を指定できるようにして並び順を確かめる */
async function addNotification(
  userId: string,
  opts: {
    type?: string;
    title?: string;
    body?: string;
    link?: string;
    createdAt?: number;
    read?: boolean;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      opts.type ?? "info",
      opts.title ?? "お知らせ",
      opts.body ?? "",
      opts.link ?? "",
      opts.read ? Date.now() : 0,
      opts.createdAt ?? Date.now(),
    )
    .run();
  return id;
}

async function fetchPage(
  cookie: string,
  page?: number,
): Promise<NotificationsPayload> {
  const url =
    page === undefined
      ? `${BASE}/api/notifications`
      : `${BASE}/api/notifications?page=${page}`;
  const res = await SELF.fetch(url, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as NotificationsPayload;
}

describe("お知らせの取得 (#294)", () => {
  it("未ログインでは取得できない", async () => {
    const res = await SELF.fetch(`${BASE}/api/notifications`);
    expect(res.status).toBe(401);
    // 未読件数と既読操作も同じく塞がっていること
    expect(
      (await SELF.fetch(`${BASE}/api/notifications/unread-count`)).status,
    ).toBe(401);
    expect(
      (
        await SELF.fetch(`${BASE}/api/notifications/read-all`, {
          method: "POST",
        })
      ).status,
    ).toBe(401);
  });

  it("壊れたセッションでは取得できない", async () => {
    const res = await SELF.fetch(`${BASE}/api/notifications`, {
      headers: { cookie: `eventer_session=${crypto.randomUUID()}` },
    });
    expect(res.status).toBe(401);
  });

  it("他人あての通知は出ない", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await addNotification(me.userId, { title: "自分あて" });
    await addNotification(other.userId, { title: "他人あて" });
    await addNotification(other.userId, { title: "他人あて2" });

    const payload = await fetchPage(me.cookie);
    expect(payload.notifications.map((n) => n.title)).toEqual(["自分あて"]);
    // 総数も本人ぶんだけ（他人の通知でページ数が増えない）
    expect(payload.total).toBe(1);
  });

  it("他人あての通知はページを送っても出てこない", async () => {
    const me = await makeUser();
    const other = await makeUser();
    // 自分ぶんを1ページ超え、他人ぶんはそれより古くしておく。
    // user_id で絞らずに並べていたら2ページ目に他人の通知が混ざる
    const base = Date.now();
    for (let i = 0; i < NOTIFICATION_PAGE_SIZE + 3; i++) {
      await addNotification(me.userId, {
        title: `自分あて${i}`,
        createdAt: base + 1000 + i,
      });
    }
    for (let i = 0; i < 5; i++) {
      await addNotification(other.userId, {
        title: `他人あて${i}`,
        createdAt: base + i,
      });
    }

    const p1 = await fetchPage(me.cookie, 1);
    const p2 = await fetchPage(me.cookie, 2);
    const titles = [...p1.notifications, ...p2.notifications].map(
      (n) => n.title,
    );
    expect(titles.every((t) => t.startsWith("自分あて"))).toBe(true);
    expect(p1.total).toBe(NOTIFICATION_PAGE_SIZE + 3);
  });

  it("他人の通知は既読にできない（自分の未読件数も動かない）", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const otherId = await addNotification(other.userId, { title: "他人あて" });

    const res = await SELF.fetch(
      `${BASE}/api/notifications/${otherId}/read`,
      { method: "POST", headers: { cookie: me.cookie } },
    );
    expect(res.status).toBe(200);
    // 他人の行は未読のまま
    const row = await env.DB.prepare(
      "SELECT read_at FROM notification WHERE id = ?",
    )
      .bind(otherId)
      .first<{ read_at: number }>();
    expect(row?.read_at).toBe(0);
    expect(await notificationsRepo.unreadCount(other.userId)).toBe(1);
  });

  it("すべて既読は自分のぶんだけを既読にする", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await addNotification(me.userId);
    await addNotification(me.userId);
    await addNotification(other.userId);

    const res = await SELF.fetch(`${BASE}/api/notifications/read-all`, {
      method: "POST",
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(200);
    expect(await notificationsRepo.unreadCount(me.userId)).toBe(0);
    expect(await notificationsRepo.unreadCount(other.userId)).toBe(1);
  });
});

describe("お知らせのページング (#294)", () => {
  it("1ページぶんずつ返し、全件は返さない", async () => {
    const me = await makeUser();
    const total = NOTIFICATION_PAGE_SIZE * 2 + 5;
    const base = Date.now();
    for (let i = 0; i < total; i++) {
      // 新しい順に並ぶことも確かめたいので作成時刻をずらす
      await addNotification(me.userId, {
        title: `n${i}`,
        createdAt: base + i,
      });
    }

    const p1 = await fetchPage(me.cookie, 1);
    expect(p1.notifications).toHaveLength(NOTIFICATION_PAGE_SIZE);
    expect(p1.total).toBe(total);
    expect(p1.page).toBe(1);
    expect(p1.limit).toBe(NOTIFICATION_PAGE_SIZE);
    // 新しい順
    expect(p1.notifications[0]?.title).toBe(`n${total - 1}`);

    const p3 = await fetchPage(me.cookie, 3);
    expect(p3.notifications).toHaveLength(5);
    expect(p3.notifications.at(-1)?.title).toBe("n0");

    // ページをまたいで重複も取りこぼしもない
    const p2 = await fetchPage(me.cookie, 2);
    const ids = [...p1.notifications, ...p2.notifications, ...p3.notifications].map(
      (n) => n.id,
    );
    expect(new Set(ids).size).toBe(total);
  });

  it("同時刻に作られた通知でもページの境目でずれない", async () => {
    // 一斉連絡は宛先全員ぶんを同じ created_at で作る。同じ人が同時刻の通知を
    // 複数持つ状況（別イベントの連絡が同時に届く等）でも並びが決まること
    const me = await makeUser();
    const at = Date.now();
    const total = NOTIFICATION_PAGE_SIZE + 4;
    for (let i = 0; i < total; i++) {
      await addNotification(me.userId, { title: `same${i}`, createdAt: at });
    }
    const p1 = await fetchPage(me.cookie, 1);
    const p2 = await fetchPage(me.cookie, 2);
    const ids = [...p1.notifications, ...p2.notifications].map((n) => n.id);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);

    // 並び順そのものを見る。和集合が揃うことだけを見ていると、タイブレークが
    // 無くても DB がたまたま安定した順で返すぶん素通りしてしまう。
    // id はランダムなので挿入順とは一致せず、id の降順を外すと落ちる
    const page1Ids = p1.notifications.map((n) => n.id);
    expect(page1Ids).toEqual([...page1Ids].sort((a, b) => (a < b ? 1 : -1)));
  });

  it("page が無い・不正でも1ページ目を返す", async () => {
    const me = await makeUser();
    await addNotification(me.userId, { title: "あり" });

    for (const page of ["", "0", "-3", "abc", "1e999"]) {
      const res = await SELF.fetch(`${BASE}/api/notifications?page=${page}`, {
        headers: { cookie: me.cookie },
      });
      expect(res.status).toBe(200);
      const payload = (await res.json()) as NotificationsPayload;
      expect(payload.page).toBe(1);
      expect(payload.notifications.map((n) => n.title)).toEqual(["あり"]);
    }
  });

  it("巨大な page でも 500 にならず空で返る", async () => {
    const me = await makeUser();
    await addNotification(me.userId);
    const payload = await fetchPage(me.cookie, 999_999_999);
    expect(payload.notifications).toEqual([]);
    expect(payload.total).toBe(1);

    // 桁が大きすぎる指定でも同じ。そのまま offset にすると D1 のバインドが
    // 扱えない値になり 500 になるので、上限で丸めていること
    const res = await SELF.fetch(
      `${BASE}/api/notifications?page=99999999999999999999`,
      { headers: { cookie: me.cookie } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as NotificationsPayload).notifications).toEqual(
      [],
    );
  });
});

describe("お知らせの中身 (#294)", () => {
  it("一斉連絡は件名と本文が最後まで読める", async () => {
    const me = await makeUser();
    // 一斉連絡の本文は最大2000字 (#172)
    const body = `会場が変更になりました。\n新しい会場: ${"あ".repeat(1900)}`;
    await addNotification(me.userId, {
      type: "event_broadcast",
      title: "【重要】会場変更のお知らせ",
      body,
      link: "/events/e-1",
    });

    const payload = await fetchPage(me.cookie);
    const n = payload.notifications[0]!;
    expect(n.type).toBe("event_broadcast");
    expect(n.title).toBe("【重要】会場変更のお知らせ");
    // 途中で切られていない＝一覧だけで読み切れる
    expect(n.body).toBe(body);
    expect(n.body).toContain("\n");
    expect(n.link).toBe("/events/e-1");
  });

  it("既読・未読が区別できる", async () => {
    const me = await makeUser();
    const base = Date.now();
    const unreadId = await addNotification(me.userId, {
      title: "未読",
      createdAt: base + 1,
    });
    await addNotification(me.userId, {
      title: "既読",
      read: true,
      createdAt: base,
    });

    const before = await fetchPage(me.cookie);
    expect(before.notifications.map((n) => [n.title, n.read])).toEqual([
      ["未読", false],
      ["既読", true],
    ]);

    const res = await SELF.fetch(
      `${BASE}/api/notifications/${unreadId}/read`,
      { method: "POST", headers: { cookie: me.cookie } },
    );
    expect(res.status).toBe(200);

    const after = await fetchPage(me.cookie);
    expect(after.notifications.every((n) => n.read)).toBe(true);
    const count = await SELF.fetch(`${BASE}/api/notifications/unread-count`, {
      headers: { cookie: me.cookie },
    });
    expect(((await count.json()) as { count: number }).count).toBe(0);
  });
});
