import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { computeScheduleTimes, findTrackOverlaps } from "@eventer/shared";
import type { EventTrack, ScheduleItem } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { buildEventExtraHtml } from "../src/lib/email.js";

/**
 * スケジュールのマルチトラック (#338)。
 *
 * セッションは「未割り当て（ネタ出し）」「全トラック共通」「特定のトラック」の
 * 3つの状態を取る。前2つはどちらも対応表が空になるので、**区別できているか**が
 * ここでの主眼。あわせて、時刻の連鎖がトラックごとになっていること、
 * 未割り当てが参加者向けの出口（一覧・リマインダーメール）に出ないことを確かめる。
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
async function setupEvent(cookie: string, startsAt = Date.now() + 24 * HOUR): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "トラックE2E",
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

async function putTimetable(
  eventId: string,
  cookie: string,
  body: unknown,
): Promise<{ items: ScheduleItem[]; tracks: EventTrack[] }> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: ScheduleItem[]; tracks: EventTrack[] };
}

async function getTimetable(
  eventId: string,
  cookie?: string,
): Promise<{ items: ScheduleItem[]; tracks: EventTrack[] }> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    headers: cookie ? { cookie } : {},
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: ScheduleItem[]; tracks: EventTrack[] };
}

/** 非adminのメンバーを1人作る（役割は指定） */
async function makeMember(
  eventId: string,
  role: "participant" | "staff",
): Promise<string> {
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
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, uid, role, Date.now())
    .run();
  return `eventer_session=${sid}`;
}

function itemInput(
  title: string,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return { title, durationMin: 30, ...patch };
}

describe("時刻の計算がトラックごとの連鎖になる (#338)", () => {
  const START = Date.UTC(2026, 8, 12, 1, 0);
  const min = (n: number) => n * 60_000;

  it("トラックを使っていないイベントは、これまでどおり直列に連鎖する", () => {
    const times = computeScheduleTimes(
      [
        { durationMin: 15, startsAt: null },
        { durationMin: 40, startsAt: null },
      ],
      START,
    );
    expect(times).toEqual([START, START + min(15)]);
  });

  it("並行するトラックは互いに時刻を押し出さない", () => {
    const times = computeScheduleTimes(
      [
        { durationMin: 30, startsAt: null, placement: "tracks", trackIds: ["A"] },
        { durationMin: 45, startsAt: null, placement: "tracks", trackIds: ["B"] },
        { durationMin: 30, startsAt: null, placement: "tracks", trackIds: ["A"] },
      ],
      START,
      ["A", "B"],
    );
    // A と B は同じ時刻から始まり、2枠目の A は A の連鎖だけを見る
    expect(times).toEqual([START, START, START + min(30)]);
  });

  it("全トラック共通のセッションは全トラックのカーソルを進める", () => {
    const times = computeScheduleTimes(
      [
        { durationMin: 30, startsAt: null, placement: "tracks", trackIds: ["A"] },
        { durationMin: 60, startsAt: null, placement: "tracks", trackIds: ["B"] },
        // 休憩（全体共通）は、いちばん後ろのトラックが終わってから始まる
        { durationMin: 15, startsAt: null, placement: "all" },
        { durationMin: 30, startsAt: null, placement: "tracks", trackIds: ["A"] },
        { durationMin: 30, startsAt: null, placement: "tracks", trackIds: ["B"] },
      ],
      START,
      ["A", "B"],
    );
    expect(times).toEqual([
      START,
      START,
      START + min(60),
      // 全体共通のあとは A も B も同じところから再開する
      START + min(75),
      START + min(75),
    ]);
  });

  it("未割り当ては時刻を持たず、後続をずらさない", () => {
    const times = computeScheduleTimes(
      [
        { durationMin: 30, startsAt: null, placement: "all" },
        { durationMin: 90, startsAt: null, placement: "unassigned" },
        { durationMin: 30, startsAt: null, placement: "all" },
      ],
      START,
      ["A"],
    );
    expect(times).toEqual([START, null, START + min(30)]);
  });

  it("複数トラックにまたがるセッションは、またぐ全部のカーソルを進める", () => {
    const times = computeScheduleTimes(
      [
        { durationMin: 30, startsAt: null, placement: "tracks", trackIds: ["A"] },
        {
          durationMin: 60,
          startsAt: null,
          placement: "tracks",
          trackIds: ["A", "B"],
        },
        { durationMin: 30, startsAt: null, placement: "tracks", trackIds: ["B"] },
      ],
      START,
      ["A", "B"],
    );
    expect(times).toEqual([START, START + min(30), START + min(90)]);
  });
});

describe("同一トラック内の重なりの警告 (#338)", () => {
  const START = Date.UTC(2026, 8, 12, 1, 0);
  const TRACKS: EventTrack[] = [
    { id: "A", name: "トラックA", sortOrder: 0 },
    { id: "B", name: "トラックB", sortOrder: 1 },
    { id: "C", name: "トラックC", sortOrder: 2 },
  ];

  it("同じトラックの重なりだけを拾い、別トラックの同時刻は重なりではない", () => {
    const items = [
      { title: "A1", durationMin: 60, startsAt: START, placement: "tracks" as const, trackIds: ["A"] },
      { title: "A2", durationMin: 30, startsAt: START + 30 * 60_000, placement: "tracks" as const, trackIds: ["A"] },
      { title: "B1", durationMin: 60, startsAt: START, placement: "tracks" as const, trackIds: ["B"] },
    ];
    const overlaps = findTrackOverlaps(
      items,
      items.map((i) => i.startsAt),
      TRACKS,
    );
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.trackName).toBe("トラックA");
    expect([overlaps[0]!.a.title, overlaps[0]!.b.title]).toEqual(["A1", "A2"]);
  });

  it("全トラック共通どうしの重なりは、トラックの本数ぶん並ばず1行だけ", () => {
    const items = [
      { title: "全体1", durationMin: 60, startsAt: START, placement: "all" as const },
      { title: "全体2", durationMin: 30, startsAt: START + 30 * 60_000, placement: "all" as const },
    ];
    const overlaps = findTrackOverlaps(
      items,
      items.map((i) => i.startsAt),
      TRACKS,
    );
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.trackName).toBe("全トラック共通");
  });

  it("端が接するだけ（前の終わり＝次の始まり）は重なりではない", () => {
    const items = [
      { title: "前", durationMin: 30, startsAt: START, placement: "all" as const },
      { title: "後", durationMin: 30, startsAt: START + 30 * 60_000, placement: "all" as const },
    ];
    expect(
      findTrackOverlaps(items, items.map((i) => i.startsAt), TRACKS),
    ).toEqual([]);
  });

  it("未割り当ては時刻を持たないので重なりに数えない", () => {
    const items = [
      { title: "全体", durationMin: 60, startsAt: START, placement: "all" as const },
      { title: "ネタ", durationMin: 60, startsAt: null, placement: "unassigned" as const },
    ];
    expect(findTrackOverlaps(items, [START, null], TRACKS)).toEqual([]);
  });
});

describe("トラックの保存と割り当て (#338)", () => {
  it("既存のセッションは全トラック共通として移行される（列の既定値）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    // マイグレーション前と同じ形（placement を書かない）で直接入れる
    await env.DB.prepare(
      `INSERT INTO event_schedule_item
        (id, event_id, title, description, duration_min, starts_at,
         speaker_user_id, speaker_name, material_url, sort_order, created_at)
       VALUES (?, ?, '既存のコマ', '', 30, NULL, NULL, '', '', 0, ?)`,
    )
      .bind(crypto.randomUUID(), eventId, Date.now())
      .run();

    const { items } = await getTimetable(eventId);
    expect(items).toHaveLength(1);
    expect(items[0]!.placement).toBe("all");
    expect(items[0]!.trackIds).toEqual([]);
  });

  it("トラックを作ってセッションを割り当てられる", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);

    const saved = await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }, { name: "ホールB" }],
      items: [
        itemInput("開会", { placement: "all" }),
        itemInput("A枠", { placement: "tracks", trackIndexes: [0] }),
        itemInput("AB枠", { placement: "tracks", trackIndexes: [0, 1] }),
        itemInput("ネタ", { placement: "unassigned" }),
      ],
    });

    expect(saved.tracks.map((t) => t.name)).toEqual(["ホールA", "ホールB"]);
    const [hallA, hallB] = saved.tracks;
    expect(saved.items.map((i) => i.placement)).toEqual([
      "all",
      "tracks",
      "tracks",
      "unassigned",
    ]);
    expect(saved.items[1]!.trackIds).toEqual([hallA!.id]);
    expect(saved.items[2]!.trackIds).toEqual([hallA!.id, hallB!.id]);
    // 未割り当ても全トラック共通も対応表は空。区別は placement だけが持つ
    expect(saved.items[0]!.trackIds).toEqual([]);
    expect(saved.items[3]!.trackIds).toEqual([]);
  });

  it("保存をまたいでもトラックの ID と割り当てが変わらない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const first = await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [itemInput("A枠", { placement: "tracks", trackIndexes: [0] })],
    });
    const trackId = first.tracks[0]!.id;
    const itemId = first.items[0]!.id;

    const second = await putTimetable(eventId, cookie, {
      tracks: [{ id: trackId, name: "大ホール" }],
      items: [
        {
          ...itemInput("A枠", { placement: "tracks", trackIndexes: [0] }),
          id: itemId,
        },
      ],
    });
    expect(second.tracks).toEqual([
      { id: trackId, name: "大ホール", sortOrder: 0 },
    ]);
    expect(second.items[0]!.id).toBe(itemId);
    expect(second.items[0]!.trackIds).toEqual([trackId]);
  });

  it("トラックを削除すると、そのトラックにだけ載っていたセッションは未割り当てに戻る", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const first = await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }, { name: "ホールB" }],
      items: [
        itemInput("A枠", { placement: "tracks", trackIndexes: [0] }),
        itemInput("AB枠", { placement: "tracks", trackIndexes: [0, 1] }),
        itemInput("全体", { placement: "all" }),
      ],
    });
    const keep = first.tracks[1]!.id;
    const ids = first.items.map((i) => i.id);

    // ホールA を送らない＝削除。載る先を失う「A枠」はクライアントも添字を外して送る
    const after = await putTimetable(eventId, cookie, {
      tracks: [{ id: keep, name: "ホールB" }],
      items: [
        {
          ...itemInput("A枠", { placement: "tracks", trackIndexes: [] }),
          id: ids[0],
        },
        {
          ...itemInput("AB枠", { placement: "tracks", trackIndexes: [0] }),
          id: ids[1],
        },
        { ...itemInput("全体", { placement: "all" }), id: ids[2] },
      ],
    });

    expect(after.tracks.map((t) => t.id)).toEqual([keep]);
    expect(after.items[0]).toMatchObject({
      title: "A枠",
      placement: "unassigned",
      trackIds: [],
    });
    expect(after.items[1]).toMatchObject({
      title: "AB枠",
      placement: "tracks",
      trackIds: [keep],
    });
    expect(after.items[2]!.placement).toBe("all");
    // 消したトラックの対応表の行も残らない
    const links = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM event_schedule_item_track it
         JOIN event_schedule_item s ON s.id = it.item_id WHERE s.event_id = ?`,
    )
      .bind(eventId)
      .first<{ n: number }>();
    expect(links?.n).toBe(1);
  });

  it("割り当て先が無い「特定のトラック」は未割り当てに落ちる", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const saved = await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      // 範囲外の添字しか指していない＝載る先が無い
      items: [itemInput("迷子", { placement: "tracks", trackIndexes: [7] })],
    });
    expect(saved.items[0]).toMatchObject({
      placement: "unassigned",
      trackIds: [],
    });
  });

  it("トラックを知らないクライアントの保存は、割り当ても配置状態も変えない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const first = await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [
        itemInput("A枠", { placement: "tracks", trackIndexes: [0] }),
        itemInput("ネタ", { placement: "unassigned" }),
      ],
    });
    const trackId = first.tracks[0]!.id;
    const ids = first.items.map((i) => i.id);

    // tracks を送らない（＝この機能を知らないクライアント）
    const after = await putTimetable(eventId, cookie, {
      items: [
        { ...itemInput("A枠（改題）"), id: ids[0] },
        { ...itemInput("ネタ"), id: ids[1] },
      ],
    });
    expect(after.tracks.map((t) => t.id)).toEqual([trackId]);
    expect(after.items[0]).toMatchObject({
      title: "A枠（改題）",
      placement: "tracks",
      trackIds: [trackId],
    });
    expect(after.items[1]!.placement).toBe("unassigned");
  });

  it("セッションを削除すると対応表の行も消える", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [itemInput("A枠", { placement: "tracks", trackIndexes: [0] })],
    });

    await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }],
      items: [],
    });
    const links = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_schedule_item_track",
    ).first<{ n: number }>();
    expect(links?.n).toBe(0);
  });
});

describe("未割り当てを参加者に見せない (#338)", () => {
  it("API を直に叩いても、staff 以外には未割り当てが返らない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    await putTimetable(eventId, cookie, {
      tracks: [],
      items: [
        itemInput("開会", { placement: "all" }),
        itemInput("スポンサーセッション（仮）", {
          placement: "unassigned",
          description: "まだ出すと決まっていない",
          materialUrl: "https://example.com/draft",
        }),
      ],
    });

    // 未ログイン（公開イベントなので閲覧はできる）
    const anon = await getTimetable(eventId);
    expect(anon.items.map((i) => i.title)).toEqual(["開会"]);
    expect(JSON.stringify(anon)).not.toContain("スポンサーセッション");
    // 資料ギャラリーの元データもこの API なので、下書きの資料URLも出ない
    expect(JSON.stringify(anon)).not.toContain("example.com/draft");

    // 参加者（メンバーだが staff ではない）
    const participant = await makeMember(eventId, "participant");
    const asParticipant = await getTimetable(eventId, participant);
    expect(asParticipant.items.map((i) => i.title)).toEqual(["開会"]);

    // staff には返る（編集画面のネタ出し置き場に要る）
    const staff = await makeMember(eventId, "staff");
    const asStaff = await getTimetable(eventId, staff);
    expect(asStaff.items.map((i) => i.title)).toEqual([
      "開会",
      "スポンサーセッション（仮）",
    ]);
    // イベントを作った本人（＝staff）にも返る
    const asOwner = await getTimetable(eventId, cookie);
    expect(asOwner.items).toHaveLength(2);
  });


  it("リマインダーメールのタイムテーブルに未割り当ては出ない", async () => {
    const cookie = await loginDev();
    // メールは JST の時刻を出すので、開催日時は固定値にしておく
    const startsAt = Date.UTC(2026, 8, 12, 1, 0);
    const eventId = await setupEvent(cookie, startsAt);
    await putTimetable(eventId, cookie, {
      tracks: [{ name: "ホールA" }, { name: "ホールB" }],
      items: [
        itemInput("開会のあいさつ", { placement: "all", durationMin: 30 }),
        itemInput("ホールAの発表", {
          placement: "tracks",
          trackIndexes: [0],
          durationMin: 60,
        }),
        itemInput("ホールBの発表", {
          placement: "tracks",
          trackIndexes: [1],
          durationMin: 45,
        }),
        itemInput("スポンサーセッション（仮）", { placement: "unassigned" }),
      ],
    });

    const html = await buildEventExtraHtml(`/events/${eventId}`, true);
    expect(html).toContain("開会のあいさつ");
    expect(html).toContain("ホールAの発表");
    // ネタ出し中のセッションは参加者に送らない
    expect(html).not.toContain("スポンサーセッション");
    // 時刻はトラックごとの連鎖。並行する2枠は同じ 10:30 から始まる
    expect(html).toContain("10:00"); // 開会（JST）
    expect(html.match(/10:30/g)?.length).toBe(2);
  });

  it("配置済みが1件も無ければタイムテーブルの節ごと出ない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, Date.UTC(2026, 8, 13, 1, 0));
    await putTimetable(eventId, cookie, {
      tracks: [],
      items: [itemInput("ネタ", { placement: "unassigned" })],
    });

    const html = await buildEventExtraHtml(`/events/${eventId}`, true);
    expect(html).not.toContain("タイムテーブル");
    expect(html).not.toContain("ネタ");
  });

  it("公開プロフィールの登壇イベントにも未割り当ては数えない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const me = (await (
      await SELF.fetch(`${BASE}/api/auth/me`, { headers: { cookie } })
    ).json()) as { user: { id: string; username: string } };

    await putTimetable(eventId, cookie, {
      tracks: [],
      items: [
        itemInput("ネタ", {
          placement: "unassigned",
          speakerUserId: me.user.id,
        }),
      ],
    });
    const hidden = (await (
      await SELF.fetch(`${BASE}/api/public/users/${me.user.username}`)
    ).json()) as { speakerEventIds: string[] };
    expect(hidden.speakerEventIds).not.toContain(eventId);

    // 配置すれば出る
    await putTimetable(eventId, cookie, {
      tracks: [],
      items: [
        itemInput("登壇", { placement: "all", speakerUserId: me.user.id }),
      ],
    });
    const shown = (await (
      await SELF.fetch(`${BASE}/api/public/users/${me.user.username}`)
    ).json()) as { speakerEventIds: string[] };
    expect(shown.speakerEventIds).toContain(eventId);
  });
});
