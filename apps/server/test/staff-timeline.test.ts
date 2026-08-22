import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { computeScheduleTimes } from "@eventer/shared";
import type {
  EventTrack,
  ScheduleItem,
  ScheduleTimeItem,
} from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { buildEventExtraHtml } from "../src/lib/email.js";
import { eventScheduleRepo } from "../src/db/repositories/eventSchedule.js";

/**
 * スタッフ用タイムライン (#383)。
 *
 * 準備・設営・片付けのような**参加者に見せない段取り**を、表のセッションと
 * 同じ時間軸に置けるようにした。ここでの主眼はただ1つ、
 * **参加者に見せる経路から裏方が1件も漏れないこと**。
 * 漏れても誰も報告してくれない（参加者は「そういうものか」と読む）ので、
 * 設計 2.2 で洗い出した経路を**1つずつ**押さえる。
 *
 * 「登壇 N 回」を数える4経路 (#394) は staff-timeline-spoken.test.ts、
 * 新しい経路が増えたときに気づく仕掛けは staff-timeline-sql-audit.test.ts。
 */

const BASE = "https://example.com";
const HOUR = 3600_000;

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

/** 公開イベントを作って ID を返す */
async function setupEvent(
  cookie: string,
  startsAt = Date.now() + 24 * HOUR,
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "スタッフ用タイムラインE2E",
      venueType: "offline",
      startsAt,
      endsAt: startsAt + 8 * HOUR,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(patch.status).toBe(200);
  return event.id;
}

interface Timetable {
  items: ScheduleItem[];
  tracks: EventTrack[];
  version: number;
}

/** 保存には読んだ時点の版を送り返す (#340)。編集画面と同じく直前に取り直す */
async function putTimetable(
  eventId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Timetable> {
  const cur = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    headers: { cookie },
  });
  const version = ((await cur.json()) as { version?: number }).version ?? 0;
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ version, ...body }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Timetable;
}

/** 生のレスポンス本文も見たいので、パースした結果と一緒に返す。
 * ID の照合だけだと「id は返さないが題名は返す」形の漏れを見逃す */
async function getTimetableRaw(
  eventId: string,
  cookie?: string,
): Promise<{ body: Timetable; text: string }> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    headers: cookie ? { cookie } : {},
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  return { body: JSON.parse(text) as Timetable, text };
}

async function getTimetable(
  eventId: string,
  cookie?: string,
): Promise<Timetable> {
  return (await getTimetableRaw(eventId, cookie)).body;
}

/** 非adminのユーザーを1人作る（どのイベントのメンバーでもない） */
async function makeUser(): Promise<{
  userId: string;
  cookie: string;
  username: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}`, username };
}

/** 非adminのメンバーを1人作る（役割は指定） */
async function makeMember(
  eventId: string,
  role: "participant" | "staff",
): Promise<{ userId: string; cookie: string; username: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, Date.now())
    .run();
  return u;
}

function itemInput(
  title: string,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return { title, durationMin: 30, ...patch };
}

/** 設計 9.1 の題材。公開トラックA・スタッフ用トラックS に、
 * 公開2件・裏方2件（トラックA / トラックS）・未割り当て1件を置く */
const STAFF_TRACK_NAME = "運営動線ヒミツ";
const STAFF_TITLES = ["会場設営ヒミツ", "受付の留守番ヒミツ"];
const PUBLIC_TITLES = ["開会のあいさつ", "ホールAの発表"];
const UNASSIGNED_TITLE = "スポンサー枠ヒミツ";

async function seedMixedTimetable(
  eventId: string,
  cookie: string,
): Promise<Timetable> {
  return putTimetable(eventId, cookie, {
    tracks: [
      { name: "ホールA" },
      { name: STAFF_TRACK_NAME, visibility: "staff" },
    ],
    items: [
      itemInput(PUBLIC_TITLES[0]!, { placement: "all", durationMin: 10 }),
      itemInput(STAFF_TITLES[0]!, {
        placement: "tracks",
        trackIndexes: [0],
        visibility: "staff",
        durationMin: 30,
      }),
      itemInput(PUBLIC_TITLES[1]!, {
        placement: "tracks",
        trackIndexes: [0],
        durationMin: 60,
      }),
      itemInput(STAFF_TITLES[1]!, {
        placement: "tracks",
        trackIndexes: [1],
        visibility: "staff",
        durationMin: 240,
      }),
      itemInput(UNASSIGNED_TITLE, { placement: "unassigned" }),
    ],
  });
}

/* ===== 9.1 経路 1・2・3・4（一覧・イベント詳細・資料ギャラリー・投影の格子） ===== */

describe("参加者向けの API に裏方が入らない (#383 経路1〜4)", () => {
  it("項目もトラックも trackIds も、参加者には1件も返らない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const saved = await seedMixedTimetable(eventId, cookie);

    const staffTrack = saved.tracks.find((t) => t.name === STAFF_TRACK_NAME)!;
    expect(staffTrack.visibility).toBe("staff");
    const hiddenIds = saved.items
      .filter(
        (it) =>
          it.visibility === "staff" || it.placement === "unassigned",
      )
      .map((it) => it.id);
    expect(hiddenIds).toHaveLength(3);

    // 画面はこの API 1本にぶら下がっている（イベント詳細の一覧・資料ギャラリー・
    // 投影の格子はすべて同じ hook）。ここが塞がっていれば4経路とも塞がる
    const member = await makeMember(eventId, "participant");
    const seen = await getTimetableRaw(eventId, member.cookie);

    for (const id of hiddenIds) {
      expect(seen.body.items.map((it) => it.id)).not.toContain(id);
    }
    // **題名でも照合する**。ID だけだと「id は伏せるが中身は返す」形で通ってしまう
    for (const title of [...STAFF_TITLES, UNASSIGNED_TITLE]) {
      expect(seen.text).not.toContain(title);
    }
    expect(seen.body.items.map((it) => it.title)).toEqual(PUBLIC_TITLES);
    expect(seen.body.items.every((it) => it.visibility === "public")).toBe(true);

    // スタッフ用トラックは一覧にも、項目の trackIds にも出ない。
    // trackIds に混ざると「トラックの一覧には無い ID」を参加者が受け取る＝
    // スタッフ用の列が在ること自体が漏れる
    expect(seen.text).not.toContain(STAFF_TRACK_NAME);
    expect(seen.body.tracks.map((t) => t.id)).not.toContain(staffTrack.id);
    for (const it of seen.body.items) {
      expect(it.trackIds).not.toContain(staffTrack.id);
    }

    // 未ログインでも同じ（公開イベントは誰でも読める）
    const anon = await getTimetableRaw(eventId);
    for (const title of [...STAFF_TITLES, UNASSIGNED_TITLE]) {
      expect(anon.text).not.toContain(title);
    }

    // staff には全部返る（絞りすぎていないことの確認）
    const asStaff = await getTimetable(eventId, cookie);
    expect(asStaff.items).toHaveLength(5);
    expect(asStaff.tracks).toHaveLength(2);
    expect(
      asStaff.items.find((it) => it.title === STAFF_TITLES[1])!.trackIds,
    ).toContain(staffTrack.id);
  });

  it("イベントの staff にも全部返る（アプリ管理者だけの話ではない）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await seedMixedTimetable(eventId, cookie);

    const staff = await makeMember(eventId, "staff");
    const seen = await getTimetable(eventId, staff.cookie);
    expect(seen.items).toHaveLength(5);
    expect(seen.tracks.map((t) => t.name)).toContain(STAFF_TRACK_NAME);
  });
});

/* ===== 9.2 経路 1（時刻の不変条件。3.3 の証拠） ===== */

describe("不可視の項目を除いても残りの時刻が変わらない (#383 3.3)", () => {
  const START = Date.UTC(2026, 8, 12, 1, 0);
  const min = (n: number) => n * 60_000;

  /** 不変条件そのもの。**staff が見る配列から不可視の項目を抜いても、
   * 残る項目の時刻が1ミリ秒も変わらない**こと。
   * 成り立たないと、参加者に配る時刻とリマインダーのメールが壊れる */
  function assertSameTimes(
    items: ScheduleTimeItem[],
    publicTrackIds: string[],
  ): Array<number | null> {
    const staffTimes = computeScheduleTimes(items, START, publicTrackIds);
    const visible = items.filter(
      (it) =>
        (it.visibility ?? "public") === "public" &&
        it.placement !== "unassigned",
    );
    const publicTimes = computeScheduleTimes(visible, START, publicTrackIds);
    const staffSideOfVisible = items
      .map((it, i) => ({ it, at: staffTimes[i]! }))
      .filter((x) => visible.includes(x.it))
      .map((x) => x.at);
    expect(staffSideOfVisible).toEqual(publicTimes);
    return staffTimes;
  }

  it("トラック内の裏方はカーソルを進めない", () => {
    const times = assertSameTimes(
      [
        { durationMin: 10, startsAt: null, placement: "tracks", trackIds: ["A"] },
        {
          durationMin: 30,
          startsAt: null,
          placement: "tracks",
          trackIds: ["A"],
          visibility: "staff",
        },
        { durationMin: 60, startsAt: null, placement: "tracks", trackIds: ["A"] },
      ],
      ["A", "B"],
    );
    // 裏方は時刻を**読む**ので描ける。進めないので「発表」は 10 分後のまま
    expect(times).toEqual([START, START + min(10), START + min(10)]);
  });

  it("全トラック共通の裏方も、どのトラックのカーソルも進めない", () => {
    const times = assertSameTimes(
      [
        { durationMin: 10, startsAt: null, placement: "all" },
        { durationMin: 45, startsAt: null, placement: "all", visibility: "staff" },
        { durationMin: 60, startsAt: null, placement: "tracks", trackIds: ["A"] },
        { durationMin: 60, startsAt: null, placement: "tracks", trackIds: ["B"] },
      ],
      ["A", "B"],
    );
    expect(times).toEqual([
      START,
      START + min(10),
      START + min(10),
      START + min(10),
    ]);
  });

  it("裏方に開始時刻を明示しても、後続の公開セッションはずれない", () => {
    const times = assertSameTimes(
      [
        { durationMin: 10, startsAt: null, placement: "tracks", trackIds: ["A"] },
        {
          durationMin: 30,
          startsAt: START + min(600),
          placement: "tracks",
          trackIds: ["A"],
          visibility: "staff",
        },
        { durationMin: 60, startsAt: null, placement: "tracks", trackIds: ["A"] },
      ],
      ["A"],
    );
    expect(times[2]).toBe(START + min(10));
  });

  it("スタッフ用トラックを列に混ぜると all の時刻がずれる（混ぜないこと）", () => {
    const items: ScheduleTimeItem[] = [
      {
        durationMin: 240,
        startsAt: null,
        placement: "tracks",
        trackIds: ["S"],
        visibility: "staff",
      },
      { durationMin: 10, startsAt: null, placement: "all" },
    ];
    // 公開トラックだけを列に渡すのが正しい姿（全トラック共通は 10:00 のまま）
    expect(computeScheduleTimes(items, START, ["A"])).toEqual([START, START]);
    // 裏方はカーソルを進めないので、仮に混ぜても all はずれない。
    // ここが崩れると staff の画面でだけ時刻が後ろへ動く
    expect(computeScheduleTimes(items, START, ["A", "S"])).toEqual([
      START,
      START,
    ]);
  });

  it("API 越しでも、参加者と staff で公開セッションの時刻が一致する", async () => {
    const cookie = await loginDev();
    const startsAt = Date.UTC(2026, 8, 12, 1, 0);
    const eventId = await setupEvent(cookie, startsAt);
    await seedMixedTimetable(eventId, cookie);

    const asStaff = await getTimetable(eventId, cookie);
    const asMember = await getTimetable(
      eventId,
      (await makeMember(eventId, "participant")).cookie,
    );
    // 画面は「公開トラックだけ」を列として時刻を計算する
    const publicTrackIds = asMember.tracks.map((t) => t.id);
    const staffTimes = computeScheduleTimes(
      asStaff.items,
      startsAt,
      publicTrackIds,
    );
    const memberTimes = computeScheduleTimes(
      asMember.items,
      startsAt,
      publicTrackIds,
    );
    for (const [i, it] of asMember.items.entries()) {
      const at = asStaff.items.findIndex((x) => x.id === it.id);
      expect(staffTimes[at]).toBe(memberTimes[i]);
    }
  });
});

/* ===== 9.3 経路 5（リマインダーメール） ===== */

describe("リマインダーメールに裏方が出ない (#383 経路5)", () => {
  it("本文に裏方が出ず、キャッシュを跨いでも変わらない", async () => {
    const cookie = await loginDev();
    // メールは JST の時刻を出すので、開催日時は固定値にしておく
    const startsAt = Date.UTC(2026, 8, 12, 1, 0);
    const eventId = await setupEvent(cookie, startsAt);
    await seedMixedTimetable(eventId, cookie);

    const html = await buildEventExtraHtml(`/events/${eventId}`, true);
    expect(html).toContain(PUBLIC_TITLES[0]);
    expect(html).toContain(PUBLIC_TITLES[1]);
    for (const title of [...STAFF_TITLES, UNASSIGNED_TITLE]) {
      expect(html).not.toContain(title);
    }
    expect(html).not.toContain(STAFF_TRACK_NAME);
    // 開会 10:00（10分）→ 発表は 10:10。裏方が 30 分あってもずれない
    expect(html).toContain("10:00");
    expect(html).toContain("10:10");

    // 組み立てた HTML は eventId をキーにキャッシュされる。**宛先の役割で
    // 中身を変えていない**ので、2回目も同じものが返る
    const again = await buildEventExtraHtml(`/events/${eventId}`, true);
    expect(again).toBe(html);
    for (const title of STAFF_TITLES) {
      expect(again).not.toContain(title);
    }
  });

  it("公開の項目が1件も無ければタイムテーブルの節ごと出ない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, Date.UTC(2026, 8, 13, 1, 0));
    await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [
        itemInput("裏方だけヒミツ", {
          placement: "tracks",
          trackIndexes: [0],
          visibility: "staff",
        }),
      ],
    });
    const html = await buildEventExtraHtml(`/events/${eventId}`, true);
    expect(html).not.toContain("タイムテーブル");
    expect(html).not.toContain("裏方だけヒミツ");
  });
});

/* ===== 9.4 経路 6（公開プロフィールの登壇イベント） ===== */

describe("公開プロフィールの登壇イベントに裏方を数えない (#383 経路6)", () => {
  it("裏方の担当だけならイベント ID を返さない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const me = (await (
      await SELF.fetch(`${BASE}/api/auth/me`, { headers: { cookie } })
    ).json()) as { user: { id: string; username: string } };

    await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [
        itemInput("設営ヒミツ", {
          placement: "tracks",
          trackIndexes: [0],
          visibility: "staff",
          speakerUserId: me.user.id,
        }),
      ],
    });
    const hidden = (await (
      await SELF.fetch(`${BASE}/api/public/users/${me.user.username}`)
    ).json()) as { speakerEventIds: string[] };
    expect(hidden.speakerEventIds).not.toContain(eventId);

    // 表に出せば数える（絞りすぎていないことの確認）
    await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [
        itemInput("登壇", {
          placement: "all",
          visibility: "public",
          speakerUserId: me.user.id,
        }),
      ],
    });
    const shown = (await (
      await SELF.fetch(`${BASE}/api/public/users/${me.user.username}`)
    ).json()) as { speakerEventIds: string[] };
    expect(shown.speakerEventIds).toContain(eventId);
  });
});

/* ===== 9.5 経路 7（資料URLの自己編集） ===== */

describe("裏方の資料URLは本人でも編集できない (#383 経路7)", () => {
  it("裏方は 404、公開のコマは従来どおり通る", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const speaker = await makeMember(eventId, "participant");
    const saved = await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [
        itemInput("撤収の段取りヒミツ", {
          placement: "tracks",
          trackIndexes: [0],
          visibility: "staff",
          speakerUserId: speaker.userId,
        }),
        itemInput("発表", {
          placement: "tracks",
          trackIndexes: [0],
          speakerUserId: speaker.userId,
        }),
      ],
    });
    const staffItem = saved.items.find((it) => it.visibility === "staff")!;
    const publicItem = saved.items.find((it) => it.visibility === "public")!;

    const patch = (itemId: string) =>
      SELF.fetch(`${BASE}/api/events/${eventId}/timetable/${itemId}/material`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: speaker.cookie },
        body: JSON.stringify({ materialUrl: "https://example.com/slides" }),
      });

    // 「引いてから弾く」ではなく**そもそも引けない**ので 404。
    // 403 だと「そこに何かある」ことまでは伝わってしまう
    expect((await patch(staffItem.id)).status).toBe(404);
    expect((await patch(publicItem.id)).status).toBe(200);
  });
});

/* ===== 9.6 経路 8（OG メタの取得） ===== */

describe("OG メタの取得対象に裏方が入らない (#383 経路8)", () => {
  it("裏方と未割り当ての資料URLは外部へ取りに行かない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [
        itemInput("設営ヒミツ", {
          placement: "tracks",
          trackIndexes: [0],
          visibility: "staff",
          materialUrl: "https://example.com/staff-only",
        }),
        itemInput("ネタヒミツ", {
          placement: "unassigned",
          materialUrl: "https://example.com/idea",
        }),
        itemInput("発表", {
          placement: "all",
          materialUrl: "https://example.com/talk",
        }),
      ],
    });
    const targets = await eventScheduleRepo.listNeedingOgRefresh(eventId, 20);
    expect(targets.map((t) => t.materialUrl)).toEqual([
      "https://example.com/talk",
    ]);
  });
});

/* ===== 9.8 経路 9（保存時の正規化。設計 4.2） ===== */

describe("保存が作らせない状態 (#383 4.2)", () => {
  it("スタッフ用トラックにしか載っていない項目は裏方に格上げされる", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const saved = await putTimetable(eventId, cookie, {
      tracks: [
        { name: "ホールA" },
        { name: STAFF_TRACK_NAME, visibility: "staff" },
      ],
      items: [
        // 参加者に見せるつもりなのに、参加者に見えない列にだけ置かれている。
        // 意味を持たない組み合わせなので**格上げ**する（消さない）
        itemInput("控え室の留守番ヒミツ", {
          placement: "tracks",
          trackIndexes: [1],
          visibility: "public",
        }),
        // 裏方が公開トラックに載るのは要件そのもの。ここは正さない
        itemInput("ホールAの撤収ヒミツ", {
          placement: "tracks",
          trackIndexes: [0],
          visibility: "staff",
        }),
        // 公開トラックとスタッフ用トラックの両方に載るなら、公開のまま
        itemInput("両方に載る", {
          placement: "tracks",
          trackIndexes: [0, 1],
          visibility: "public",
        }),
      ],
    });
    expect(saved.items.map((it) => it.visibility)).toEqual([
      "staff",
      "staff",
      "public",
    ]);

    // 格上げされた項目も、公開トラックに載った裏方も参加者には返らない
    const member = await makeMember(eventId, "participant");
    const seen = await getTimetableRaw(eventId, member.cookie);
    expect(seen.body.items.map((it) => it.title)).toEqual(["両方に載る"]);
    expect(seen.text).not.toContain("ヒミツ");
  });

  it("参加者は保存できない（403）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await seedMixedTimetable(eventId, cookie);
    const member = await makeMember(eventId, "participant");
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: member.cookie,
      },
      body: JSON.stringify({ version: 1, items: [], tracks: [] }),
    });
    expect(res.status).toBe(403);
  });

  it("トラックを送らない保存では、入力済みの裏方が参加者に出ない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const saved = await seedMixedTimetable(eventId, cookie);

    // **トラックを知らないクライアント**からの保存。トラックを知らない＝
    // 裏方も知らないので、`visibility` の既定値 'public' を送ってくる。
    // それを素直に書くと入力済みの裏方が黙って参加者に出る（placement を
    // 既存値のままにしているのとまったく同じ理由でここも触らない）
    const again = await putTimetable(eventId, cookie, {
      items: saved.items.map((it) => ({
        id: it.id,
        title: it.title,
        durationMin: it.durationMin,
      })),
    });
    expect(again.items.filter((it) => it.visibility === "staff")).toHaveLength(
      2,
    );

    const member = await makeMember(eventId, "participant");
    const seen = await getTimetableRaw(eventId, member.cookie);
    for (const title of STAFF_TITLES) {
      expect(seen.text).not.toContain(title);
    }
  });
});

/* ===== 9.9 トラックを消したとき（0067 の規則が効き続ける） ===== */

describe("スタッフ用トラックを消したとき (#383 9.9)", () => {
  it("そこにしか載っていなかった裏方は未割り当てに落ち、裏方のまま残る", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const saved = await seedMixedTimetable(eventId, cookie);
    const kept = saved.items.filter((it) => it.title !== UNASSIGNED_TITLE);

    // スタッフ用トラックだけ落として保存し直す（項目は消さない）
    const after = await putTimetable(eventId, cookie, {
      tracks: [{ id: saved.tracks[0]!.id, name: "ホールA" }],
      items: kept.map((it) => ({
        id: it.id,
        title: it.title,
        durationMin: it.durationMin,
        placement: it.placement,
        visibility: it.visibility,
        trackIndexes: it.trackIds.includes(saved.tracks[0]!.id) ? [0] : [],
      })),
    });
    const orphan = after.items.find((it) => it.title === STAFF_TITLES[1])!;
    // 載る先が無くなったので未割り当てへ（0067 の規則）。visibility は触らない
    expect(orphan.placement).toBe("unassigned");
    expect(orphan.visibility).toBe("staff");

    // 未割り当て・裏方のどちらの理由でも参加者には返らない（**二重に**安全）
    const member = await makeMember(eventId, "participant");
    const seen = await getTimetableRaw(eventId, member.cookie);
    expect(seen.text).not.toContain(STAFF_TITLES[1]);
    expect(seen.body.tracks).toHaveLength(1);
  });
});
