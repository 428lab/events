import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { computeScheduleTimes } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { unsubscribeToken } from "../src/lib/email.js";
import {
  actorTitleHtml,
  descriptionExcerpt,
  eventCardHtml,
  formatEventDateTime,
  notificationEmailHtml,
  stripMarkdown,
  timetableHtml,
  type EventCardEvent,
} from "../src/lib/emailTemplates.js";
import { emailRepo } from "../src/db/repositories/email.js";
import { notificationsRepo } from "../src/db/repositories/notifications.js";
import { sendEventReminders } from "../src/lib/reminders.js";

const BASE = "https://example.com";

// テストから直接リポジトリ/lib を呼ぶため、テスト側アイソレートにもバインディングを束ねる
beforeAll(() => {
  bindEnv(env as unknown as Env);
});

/** 一般ユーザーを1人作る（DB 直挿入） */
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
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** 検証済みメール付き identity を挿入 */
async function addIdentity(
  userId: string,
  email: string | null,
  createdAt = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'google', ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), userId, crypto.randomUUID(), email, createdAt)
    .run();
}

/** notification_pref を直接設定 */
async function setEmailPref(userId: string, enabled: boolean): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notification_pref (user_id, email_enabled, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET email_enabled = excluded.email_enabled`,
  )
    .bind(userId, enabled ? 1 : 0, Date.now())
    .run();
}

async function emailPref(userId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    "SELECT email_enabled AS e FROM notification_pref WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ e: number }>();
  return row?.e ?? null;
}

/** 公開イベントを DB 直挿入で作る */
async function makeEvent(opts: {
  createdBy: string;
  startsAt: number;
  status?: string;
  scheduling?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, venue_offline, status, scheduling, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', '会議室A', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `リマインダーE2E_${id.slice(0, 6)}`,
      opts.startsAt,
      opts.startsAt + 2 * 3600_000,
      opts.status ?? "published",
      opts.scheduling ? 1 : 0,
      opts.createdBy,
      Date.now(),
    )
    .run();
  return id;
}

/** イベントメンバーを DB 直挿入で作る */
async function addMember(
  eventId: string,
  userId: string,
  opts: { status?: string; reminderSentAt?: number } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, status, reminder_sent_at, created_at)
     VALUES (?, ?, ?, 'participant', ?, ?, ?)`,
  )
    .bind(
      id,
      eventId,
      userId,
      opts.status ?? "confirmed",
      opts.reminderSentAt ?? null,
      Date.now(),
    )
    .run();
  return id;
}

describe("メールのワンクリック配信停止 (#126)", () => {
  it("GET は確認ページを返すだけで停止しない（スキャナ先読み対策）。POST で停止する", async () => {
    const u = await makeUser();
    await setEmailPref(u.userId, true);
    const token = await unsubscribeToken(u.userId);
    const res = await SELF.fetch(
      `${BASE}/api/email/unsubscribe?u=${u.userId}&t=${token}`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("メール通知を停止しますか");
    // GET では変更されない
    expect(await emailPref(u.userId)).toBe(1);
    const post = await SELF.fetch(
      `${BASE}/api/email/unsubscribe?u=${u.userId}&t=${token}`,
      { method: "POST" },
    );
    expect(post.status).toBe(200);
    expect(await post.text()).toContain("メール通知を停止しました");
    expect(await emailPref(u.userId)).toBe(0);
  });

  it("POST（List-Unsubscribe-Post）でも停止できる", async () => {
    const u = await makeUser();
    await setEmailPref(u.userId, true);
    const token = await unsubscribeToken(u.userId);
    const res = await SELF.fetch(
      `${BASE}/api/email/unsubscribe?u=${u.userId}&t=${token}`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(await emailPref(u.userId)).toBe(0);
  });

  it("不正なトークンは 403 で設定は変わらない", async () => {
    const u = await makeUser();
    await setEmailPref(u.userId, true);
    const res = await SELF.fetch(
      `${BASE}/api/email/unsubscribe?u=${u.userId}&t=${"0".repeat(64)}`,
    );
    expect(res.status).toBe(403);
    expect(await emailPref(u.userId)).toBe(1);
  });
});

describe("通知設定 API のメール項目 (#126)", () => {
  it("emailEnabled の切替が保存され、宛先メールが返る", async () => {
    const u = await makeUser();
    await addIdentity(u.userId, "user@example.com");

    // 初期値: メールOFF・宛先は連携メール
    const res1 = await SELF.fetch(`${BASE}/api/me/notification-prefs`, {
      headers: { cookie: u.cookie },
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as {
      prefs: { emailEnabled: boolean };
      email: string | null;
    };
    expect(body1.prefs.emailEnabled).toBe(false);
    expect(body1.email).toBe("user@example.com");

    // ONに更新 → 永続化される
    const res2 = await SELF.fetch(`${BASE}/api/me/notification-prefs`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: u.cookie },
      body: JSON.stringify({ emailEnabled: true }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as typeof body1;
    expect(body2.prefs.emailEnabled).toBe(true);
    expect(body2.email).toBe("user@example.com");
    expect(await emailPref(u.userId)).toBe(1);
  });

  it("連携メールが無ければ email は null", async () => {
    const u = await makeUser();
    await addIdentity(u.userId, null); // メール無し連携（nostr 等相当）
    const res = await SELF.fetch(`${BASE}/api/me/notification-prefs`, {
      headers: { cookie: u.cookie },
    });
    const body = (await res.json()) as { email: string | null };
    expect(body.email).toBeNull();
  });
});

describe("通知作成時のメール送信 (#126)", () => {
  it("RESEND_API_KEY 未設定でも通知作成は失敗しない", async () => {
    const u = await makeUser();
    await addIdentity(u.userId, "user@example.com");
    await setEmailPref(u.userId, true);

    // API キーが無いので送信はスキップされるが、例外にはならず通知行は作られる
    await expect(
      notificationsRepo.create(u.userId, "info", "テスト通知", "本文", "/events/x"),
    ).resolves.toBeUndefined();

    const row = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM notification WHERE user_id = ?",
    )
      .bind(u.userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});

describe("前日リマインダーの対象抽出 (#126)", () => {
  it("24時間以内・オプトイン・未送信のみが選ばれる", async () => {
    const now = Date.now();
    const host = await makeUser();

    // 対象: 12時間後開催・オプトイン・メール有り・未送信
    const target = await makeUser();
    await addIdentity(target.userId, "target@example.com");
    await setEmailPref(target.userId, true);
    const ev = await makeEvent({ createdBy: host.userId, startsAt: now + 12 * 3600_000 });
    const targetMemberId = await addMember(ev, target.userId);

    // 除外: 送信済み
    const already = await makeUser();
    await addIdentity(already.userId, "already@example.com");
    await setEmailPref(already.userId, true);
    await addMember(ev, already.userId, { reminderSentAt: now - 1000 });

    // 除外: オプトアウト（email_enabled=0）
    const optedOut = await makeUser();
    await addIdentity(optedOut.userId, "optout@example.com");
    await setEmailPref(optedOut.userId, false);
    await addMember(ev, optedOut.userId);

    // 除外: 連携メール無し
    const noEmail = await makeUser();
    await addIdentity(noEmail.userId, null);
    await setEmailPref(noEmail.userId, true);
    await addMember(ev, noEmail.userId);

    // 除外: 参加取消済み
    const canceled = await makeUser();
    await addIdentity(canceled.userId, "canceled@example.com");
    await setEmailPref(canceled.userId, true);
    await addMember(ev, canceled.userId, { status: "canceled" });

    // 除外: 開始が24時間より先のイベント
    const far = await makeEvent({ createdBy: host.userId, startsAt: now + 30 * 3600_000 });
    await addMember(far, target.userId);

    // 除外: 下書きイベント
    const draft = await makeEvent({
      createdBy: host.userId,
      startsAt: now + 12 * 3600_000,
      status: "draft",
    });
    await addMember(draft, target.userId);

    // 除外: 日程調整中イベント
    const sched = await makeEvent({
      createdBy: host.userId,
      startsAt: now + 12 * 3600_000,
      scheduling: true,
    });
    await addMember(sched, target.userId);

    const targets = await emailRepo.listReminderTargets(now, 200);
    const mine = targets.filter((t) =>
      [
        target.userId,
        already.userId,
        optedOut.userId,
        noEmail.userId,
        canceled.userId,
      ].includes(t.userId),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.memberId).toBe(targetMemberId);
    expect(mine[0]!.email).toBe("target@example.com");
    expect(mine[0]!.eventId).toBe(ev);

    // 送信済みにすると対象から外れる
    await emailRepo.markReminderSent(targetMemberId);
    const after = await emailRepo.listReminderTargets(now, 200);
    expect(after.some((t) => t.memberId === targetMemberId)).toBe(false);
  });

  it("APIキー未設定時は送信0件で reminder_sent_at は付かない", async () => {
    const now = Date.now();
    const host = await makeUser();
    const u = await makeUser();
    await addIdentity(u.userId, "cron@example.com");
    await setEmailPref(u.userId, true);
    const ev = await makeEvent({ createdBy: host.userId, startsAt: now + 6 * 3600_000 });
    const memberId = await addMember(ev, u.userId);

    const sent = await sendEventReminders(now);
    expect(sent).toBe(0);
    const row = await env.DB.prepare(
      "SELECT reminder_sent_at AS r FROM event_member WHERE id = ?",
    )
      .bind(memberId)
      .first<{ r: number | null }>();
    expect(row?.r).toBeNull();
  });
});

describe("cron エンドポイント (#129)", () => {
  it("正しい x-cron-key で実行でき、誤りは 403", async () => {
    const ok = await SELF.fetch(`${BASE}/api/cron/reminders`, {
      method: "POST",
      headers: { "x-cron-key": "test-cron-secret" },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { sent: number };
    expect(typeof body.sent).toBe("number");

    const ng = await SELF.fetch(`${BASE}/api/cron/reminders`, {
      method: "POST",
      headers: { "x-cron-key": "wrong" },
    });
    expect(ng.status).toBe(403);

    const none = await SELF.fetch(`${BASE}/api/cron/reminders`, {
      method: "POST",
    });
    expect(none.status).toBe(403);
  });
});

/** リッチ通知メールのHTMLビルダー (#134)。env に依存しない純粋関数を直接テストする */
describe("リッチ通知メールのテンプレート (#134)", () => {
  const BASE_URL = "https://example.com";
  // 2026/8/22(土) 13:00 JST = 04:00 UTC
  const STARTS = Date.UTC(2026, 7, 22, 4, 0);
  // 同日 18:00 JST
  const ENDS = Date.UTC(2026, 7, 22, 9, 0);

  const baseEvent: EventCardEvent = {
    id: "11111111-2222-3333-4444-555555555555",
    title: "テストイベント",
    description: "ハンズオンです",
    startsAt: STARTS,
    endsAt: ENDS,
    scheduling: false,
    venueType: "offline",
    venueOffline: "会議室A",
    imageUpdatedAt: 1234,
  };

  describe("Markdown のプレーンテキスト化", () => {
    it("リンクはテキストのみ残り、画像・見出し・記号は除去される", () => {
      const src =
        "# 見出し\n\n**強調** と `code` と [リンク](https://a.example/x)\n\n![alt](https://a.example/i.png)\n\n> 引用\n- 箇条書き";
      const plain = stripMarkdown(src);
      expect(plain).toContain("見出し");
      expect(plain).toContain("強調");
      expect(plain).toContain("リンク");
      expect(plain).not.toContain("https://a.example");
      expect(plain).not.toContain("#");
      expect(plain).not.toContain("*");
      expect(plain).not.toContain("`");
      expect(plain).not.toContain(">");
      // 空白は1つに畳まれる
      expect(plain).not.toMatch(/\s{2}/);
    });

    it("200文字を超える説明は切り詰めて … を付ける", () => {
      const long = "あ".repeat(250);
      const ex = descriptionExcerpt(long);
      expect(ex).toHaveLength(201);
      expect(ex.endsWith("…")).toBe(true);
      // 短ければそのまま
      expect(descriptionExcerpt("短い説明")).toBe("短い説明");
    });
  });

  describe("開催日時の表記 (JST)", () => {
    it("同日開催は終了を時刻だけにする", () => {
      expect(formatEventDateTime(STARTS, ENDS, false)).toBe(
        "2026/8/22(土) 13:00〜18:00",
      );
    });

    it("日程調整中は「日程調整中」、終了未定は開始のみ", () => {
      expect(formatEventDateTime(STARTS, ENDS, true)).toBe("日程調整中");
      expect(formatEventDateTime(0, 0, false)).toBe("日時未定");
      expect(formatEventDateTime(STARTS, 0, false)).toBe("2026/8/22(土) 13:00〜");
    });

    it("日をまたぐ場合は終了側にも日付を付ける", () => {
      const nextDay = Date.UTC(2026, 7, 22, 17, 0); // 2026/8/23 02:00 JST
      expect(formatEventDateTime(STARTS, nextDay, false)).toBe(
        "2026/8/22(土) 13:00〜2026/8/23(日) 02:00",
      );
    });
  });

  describe("イベントカード", () => {
    it("画像・日時・会場・コミュニティ・説明冒頭が入る", () => {
      const html = eventCardHtml({
        baseUrl: BASE_URL,
        event: baseEvent,
        communityName: "テストコミュニティ",
      });
      expect(html).toContain(
        `${BASE_URL}/api/events/${baseEvent.id}/image?v=1234`,
      );
      expect(html).toContain("2026/8/22(土) 13:00〜18:00");
      expect(html).toContain("オフライン（会議室A）");
      expect(html).toContain("テストコミュニティ");
      expect(html).toContain("ハンズオンです");
    });

    it("画像なし・コミュニティなしなら該当部分を出さない", () => {
      const html = eventCardHtml({
        baseUrl: BASE_URL,
        event: { ...baseEvent, imageUpdatedAt: null },
        communityName: null,
      });
      expect(html).not.toContain("/image?v=");
      expect(html).not.toContain("コミュニティ");
    });

    it("日程調整中のイベントは「日程調整中」と表示される", () => {
      const html = eventCardHtml({
        baseUrl: BASE_URL,
        event: { ...baseEvent, scheduling: true },
        communityName: null,
      });
      expect(html).toContain("日程調整中");
      expect(html).not.toContain("2026/8/22");
    });

    it("敵対的なタイトル・説明はエスケープされ javascript: リンクも残らない", () => {
      const html = eventCardHtml({
        baseUrl: BASE_URL,
        event: {
          ...baseEvent,
          title: '<script>alert("t")</script>',
          description:
            '[クリック](javascript:alert(1)) と <img src=x onerror=alert(2)> と "引用"',
        },
        communityName: '<b>悪意</b>',
      });
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("javascript:");
      expect(html).toContain("クリック"); // リンクテキストは残る
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<b>悪意</b>");
      expect(html).toContain("&lt;b&gt;悪意&lt;/b&gt;");
    });
  });

  describe("タイムテーブル", () => {
    it("computeScheduleTimes の結果で 時刻｜内容＋担当 の行が並ぶ", () => {
      const items = [
        { title: "オープニング", speakerName: "主催", speaker: null, durationMin: 15, startsAt: null },
        {
          title: "セッション1",
          speakerName: "",
          speaker: { username: "alice", globalName: "アリス" },
          durationMin: 40,
          startsAt: null,
        },
      ];
      const times = computeScheduleTimes(items, STARTS);
      const html = timetableHtml({ items, times });
      expect(html).toContain("タイムテーブル");
      expect(html).toContain("13:00");
      expect(html).toContain("13:15"); // 15分後に連鎖
      expect(html).toContain("オープニング");
      expect(html).toContain("主催");
      // リンク済み担当者は globalName 優先
      expect(html).toContain("アリス");
    });

    it("開始基準が無い項目は --:-- になり、担当名はエスケープされる", () => {
      const items = [
        {
          title: "LT<script>",
          speakerName: '<img src=x onerror=1>',
          speaker: null,
          durationMin: 10,
          startsAt: null,
        },
      ];
      const times = computeScheduleTimes(items, null);
      const html = timetableHtml({ items, times });
      expect(html).toContain("--:--");
      expect(html).toContain("LT&lt;script&gt;");
      expect(html).not.toContain("<img src=x");
    });

    it("項目が無ければ空文字", () => {
      expect(timetableHtml({ items: [], times: [] })).toBe("");
    });
  });

  describe("actor リンク付きタイトル", () => {
    it("actor 名がプロフィールへの ref=email 付きリンクになる", () => {
      const html = actorTitleHtml({
        baseUrl: BASE_URL,
        title: "アリス さんがイベントを公開しました",
        actorName: "アリス",
        actorPath: "/users/alice",
      });
      expect(html).toContain(
        `<a href="${BASE_URL}/users/alice?ref=email"`,
      );
      expect(html).toContain(">アリス</a>");
      expect(html).toContain(" さんがイベントを公開しました");
    });

    it("actor 名はエスケープされる", () => {
      const html = actorTitleHtml({
        baseUrl: BASE_URL,
        title: "<b>x</b> さんがイベントに参加しました",
        actorName: "<b>x</b>",
        actorPath: "/users/x",
      });
      expect(html).not.toContain("<b>x</b> さんが");
      expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    });

    it("タイトルが actor 名で始まらなければ null（プレーン表示へフォールバック）", () => {
      expect(
        actorTitleHtml({
          baseUrl: BASE_URL,
          title: "イベントが公開されました",
          actorName: "アリス",
          actorPath: "/users/alice",
        }),
      ).toBeNull();
    });
  });

  describe("メール全体のHTML", () => {
    it("ロゴ入りヘッダー・titleHtml・extraHtml が反映される", () => {
      const html = notificationEmailHtml({
        baseUrl: BASE_URL,
        title: "アリス さんがイベントを公開しました",
        titleHtml: `<a href="${BASE_URL}/users/alice?ref=email">アリス</a> さんがイベントを公開しました`,
        body: "「テスト」",
        extraHtml: '<div data-testid="card">CARD</div>',
        linkUrl: `${BASE_URL}/events/x?ref=email`,
        unsubscribeUrl: `${BASE_URL}/api/email/unsubscribe?u=1&t=2`,
      });
      expect(html).toContain(`${BASE_URL}/logo-email.png`);
      expect(html).toContain('alt="events lab"');
      expect(html).toContain(`<a href="${BASE_URL}/users/alice?ref=email">アリス</a>`);
      expect(html).toContain('data-testid="card"');
      expect(html).toContain("詳細を見る");
      expect(html).toContain("メール通知を停止する");
    });

    it("titleHtml が無ければタイトルはエスケープして表示", () => {
      const html = notificationEmailHtml({
        baseUrl: BASE_URL,
        title: "<script>x</script>",
        body: "",
        linkUrl: null,
        unsubscribeUrl: `${BASE_URL}/api/email/unsubscribe?u=1&t=2`,
      });
      expect(html).not.toContain("<script>x</script>");
      expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    });

    it("本文の改行がメールでも改行のまま出る", () => {
      // 一斉連絡 (#172) のように複数行の本文を送る通知があり、
      // white-space の指定が無いと段落1つに潰れる
      const html = notificationEmailHtml({
        baseUrl: BASE_URL,
        title: "件名",
        body: "1行目\n\n2行目",
        linkUrl: null,
        unsubscribeUrl: `${BASE_URL}/api/email/unsubscribe?u=1&t=2`,
      });
      const paragraph = /<p style="([^"]*)">1行目\n\n2行目<\/p>/.exec(html);
      expect(paragraph).not.toBeNull();
      expect(paragraph![1]).toContain("white-space:pre-wrap");
    });
  });
});
