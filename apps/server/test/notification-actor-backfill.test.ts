import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
// 0070 の中身をそのまま文字列で読む（Vite の ?raw）。
// workerd の中では node:fs が使えないので、二重管理の照合はこの形でしか作れない。
// 型宣言は置いていない。test/ は apps/server/tsconfig.json の include (src) の外で
// 型検査の対象外のため。将来 test/ を型検査に含めるなら `declare module "*.sql?raw"`
// を **単体の .d.ts** に置くこと（env.d.ts は import を持つモジュールなので、
// そこに書いてもパターン宣言は効かない）。
import migrationSql from "../migrations/0070_notification_actor.sql?raw";

/**
 * 通知の actor 埋め戻しの検証 (#380 / 設計 9.5)。
 *
 * **このファイルの BACKFILL_SQL は `migrations/0070_notification_actor.sql` の
 * 埋め戻し SQL と対になっている。片方だけ直さないこと。**
 * 埋め戻しは一度きりの処理なので、SQL の二重管理を許容している。
 * ただし注意書きは次に触る人には効かないので、**照合は機械でやる**。
 * 0070 を ?raw で読み込み、末尾の describe「0070 との同期」で本数と
 * 文字単位の一致を検証している（設計 9.5）。手作業の目視照合はしない。
 *
 * テスト用 D1 には全マイグレーションが適用済みで、0070 が流れた時点では
 * 1行も無い。そのため「旧形式の行を入れてからマイグレーションを流す」形は
 * 取れない。代わりに旧形式の行（actor_id が NULL、link と title は現行の文言）を
 * 直接 INSERT し、0070 と同じ3本をここから流して結果を確かめる。
 */

/* =========================================================
 *  0070_notification_actor.sql からの写し
 *  （空白・改行まで含めてそのまま。0070 と文字列比較しているため）
 * =======================================================*/
const BACKFILL_SQL = [
  // (1) meet: link が actor 本人のプロフィールURL。event_meet の存在で裏を取る。
  //     この EXISTS が見ているのは「その人と受信者がどこかで出会っているか」だけで、
  //     通知のイベントや時刻とは対応していない。したがって「A が手放したハンドルを
  //     B が取り、B も受信者と出会っている」場合は B に結び付く（設計 4.3）。
  //     ガードは足さず、流す前に 8.1 の事前確認 SQL で0件を確かめる方針。
  `UPDATE notification SET actor_id = (
    SELECT u.id FROM user u
     WHERE notification.link = '/users/' || REPLACE(u.username, ' ', '%20')
       AND EXISTS (
         SELECT 1 FROM event_meet em
          WHERE em.user_low  = min(u.id, notification.user_id)
            AND em.user_high = max(u.id, notification.user_id))
  )
 WHERE type = 'meet' AND actor_id IS NULL;`,

  // (2) followee_created_event: link 先のイベントの作成者。
  //     完全削除で ghost に付け替わったイベントは除く。
  //     NOT IN であって != ではない。ghost は完全削除が初めて起きたときに
  //     遅延生成される (accountDeletionRepo.ensureDeletedUser) ので、未生成の DB では
  //     副問い合わせが NULL になり、!= だと NULL 比較で正常な行まで全部落ちる。
  //     NOT IN は空集合で TRUE。
  `UPDATE notification SET actor_id = (
    SELECT e.created_by FROM event e
     WHERE notification.link = '/events/' || e.id
       AND e.created_by NOT IN (SELECT id FROM user WHERE discord_id = 'system:deleted-user')
  )
 WHERE type = 'followee_created_event' AND actor_id IS NULL;`,

  // (3) followee_joined_event: link 先のイベントの参加者のうち、
  //     タイトルが現行の文言と一致する1人。1人に定まるときだけ埋める。
  `UPDATE notification SET actor_id = (
    SELECT m.user_id FROM event_member m JOIN user u ON u.id = m.user_id
     WHERE notification.link = '/events/' || m.event_id
       AND notification.title = COALESCE(u.global_name, u.username)
                                || ' さんがイベントに参加しました'
  )
 WHERE type = 'followee_joined_event' AND actor_id IS NULL
   AND (SELECT COUNT(1) FROM event_member m2 JOIN user u2 ON u2.id = m2.user_id
         WHERE notification.link = '/events/' || m2.event_id
           AND notification.title = COALESCE(u2.global_name, u2.username)
                                    || ' さんがイベントに参加しました') = 1;`,
] as const;

/** 埋め戻しを1周流す。冪等なので何度呼んでもよい */
async function runBackfill(): Promise<void> {
  for (const sql of BACKFILL_SQL) {
    await env.DB.prepare(sql).run();
  }
}

/* =========================================================
 *  テストデータ（このテストの主題は SQL そのものなので直接 INSERT する）
 * =======================================================*/

interface MakeUserOpts {
  username?: string;
  globalName?: string | null;
  discordId?: string;
}

async function makeUser(opts: MakeUserOpts = {}): Promise<string> {
  const uid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(
      uid,
      opts.discordId ?? `t:${uid}`,
      opts.username ?? `u_${uid.slice(0, 8)}`,
      opts.globalName === undefined ? `表示_${uid.slice(0, 4)}` : opts.globalName,
      Date.now(),
    )
    .run();
  return uid;
}

/** 完全削除 (#244) の名義引き受け先。0070 (2) の除外条件が参照する */
async function makeGhostUser(): Promise<string> {
  return makeUser({
    discordId: "system:deleted-user",
    username: "deleted-user",
    globalName: "退会したユーザー",
  });
}

async function renameUser(userId: string, username: string): Promise<void> {
  await env.DB.prepare("UPDATE user SET username = ? WHERE id = ?")
    .bind(username, userId)
    .run();
}

async function makeEvent(createdBy: string): Promise<string> {
  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at) VALUES (?, '埋め戻しテスト', 1, 2, 'offline', 'published', ?, ?)",
  )
    .bind(eventId, createdBy, Date.now())
    .run();
  return eventId;
}

async function joinEvent(eventId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, Date.now())
    .run();
}

/** 出会いの記録 (0044)。user_low / user_high は小さい方・大きい方 */
async function makeMeet(eventId: string, a: string, b: string): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await env.DB.prepare(
    "INSERT INTO event_meet (id, event_id, user_low, user_high, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, low, high, Date.now())
    .run();
}

/** 旧形式の通知を1件作る（actor_id は既定で NULL） */
async function addNotification(
  userId: string,
  opts: { type: string; title: string; link: string; actorId?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at, actor_id)
     VALUES (?, ?, ?, ?, '', ?, 0, ?, ?)`,
  )
    .bind(
      id,
      userId,
      opts.type,
      opts.title,
      opts.link,
      Date.now(),
      opts.actorId ?? null,
    )
    .run();
  return id;
}

async function actorOf(notificationId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT actor_id FROM notification WHERE id = ?",
  )
    .bind(notificationId)
    .first<{ actor_id: string | null }>();
  return row?.actor_id ?? null;
}

/** meet の通知（link が actor のプロフィールURL）。encodeURIComponent と同じ形にする */
function meetLink(username: string): string {
  return `/users/${encodeURIComponent(username)}`;
}

function joinedTitle(displayName: string): string {
  return `${displayName} さんがイベントに参加しました`;
}

/* =========================================================
 *  (1) meet
 * =======================================================*/

describe("埋め戻し (1) meet", () => {
  it("link のプロフィールURLと event_meet の対から actor が埋まる", async () => {
    const receiver = await makeUser();
    const actor = await makeUser({ username: "met_me" });
    const eventId = await makeEvent(actor);
    await makeMeet(eventId, actor, receiver);
    const n = await addNotification(receiver, {
      type: "meet",
      title: "誰か さんと出会いました",
      link: meetLink("met_me"),
    });

    await runBackfill();

    expect(await actorOf(n)).toBe(actor);
  });

  it("username に空白が入っていても %20 に置き換えて照合できる", async () => {
    const receiver = await makeUser();
    const actor = await makeUser({ username: "sp ace" });
    const eventId = await makeEvent(actor);
    await makeMeet(eventId, actor, receiver);
    // 通知を作る側は encodeURIComponent なので '/users/sp%20ace' になる
    const n = await addNotification(receiver, {
      type: "meet",
      title: "誰か さんと出会いました",
      link: meetLink("sp ace"),
    });
    expect(meetLink("sp ace")).toBe("/users/sp%20ace");

    await runBackfill();

    expect(await actorOf(n)).toBe(actor);
  });

  it("ハンドルを取った B が受信者と出会っていなければ、B には付かない", async () => {
    // A が receiver と出会って通知が出来る（link は当時の A のハンドル）
    const receiver = await makeUser();
    const a = await makeUser({ username: "handover" });
    const eventId = await makeEvent(a);
    await makeMeet(eventId, a, receiver);
    const n = await addNotification(receiver, {
      type: "meet",
      title: "A さんと出会いました",
      link: meetLink("handover"),
    });
    // A が改名し、空いた 'handover' を B が取る。B は receiver と出会っていない
    await renameUser(a, "handover_old");
    const b = await makeUser({ username: "handover" });

    await runBackfill();

    // link だけで照合すると B に付いてしまう。EXISTS が効くのはこの形のときだけ。
    // A は改名済みで link と一致しないため、この行は NULL のまま（4.2 の「埋まらない行」）
    const filled = await actorOf(n);
    expect(filled).not.toBe(b);
    expect(filled).toBeNull();
  });

  it("ハンドルを取った B が受信者とどこかで出会っていれば、B に付く（設計 4.3 の実態）", async () => {
    // ひとつ上のテストと違うのは「B も receiver と出会っている」ことだけ。
    // EXISTS は「その人と受信者がどこかで出会っているか」しか見ておらず、
    // 通知のイベントとも時刻とも対応していないので、これで条件を満たしてしまう。
    const receiver = await makeUser();
    const a = await makeUser({ username: "handover2" });
    const eventA = await makeEvent(a);
    await makeMeet(eventA, a, receiver);
    const n = await addNotification(receiver, {
      type: "meet",
      title: "A さんと出会いました",
      link: meetLink("handover2"),
    });
    await renameUser(a, "handover2_old");
    const b = await makeUser({ username: "handover2" });
    // B と receiver は別のイベントで出会う（通知とは無関係の出会い）
    const eventB = await makeEvent(b);
    await makeMeet(eventB, b, receiver);

    await runBackfill();

    // **現状の挙動を固定するテスト。正しい actor は A。**
    // B が退会すると A の名前が入った receiver の通知が消える（誤削除）。
    // ガードは足さない判断で、代わりに 8.1 の事前確認 SQL で対象データに
    // 該当行が無いことを流す前に確かめる。ガードを足すならこのテストも見直すこと
    expect(await actorOf(n)).toBe(b);
    expect(await actorOf(n)).not.toBe(a);
  });
});

/* =========================================================
 *  (2) followee_created_event
 * =======================================================*/

describe("埋め戻し (2) followee_created_event", () => {
  it("ghost 行がある DB で、ghost 以外が作成者のイベントは埋まる", async () => {
    // 除外の副問い合わせが1行返す状態。ghost が居ても普通の作成者は落ちない
    await makeGhostUser();
    const follower = await makeUser();
    const creator = await makeUser();
    const eventId = await makeEvent(creator);
    const n = await addNotification(follower, {
      type: "followee_created_event",
      title: "誰か さんがイベントを公開しました",
      link: `/events/${eventId}`,
    });

    await runBackfill();

    expect(await actorOf(n)).toBe(creator);
  });

  it("作成者が ghost に付け替わったイベントは埋まらない", async () => {
    const ghost = await makeGhostUser();
    const follower = await makeUser();
    const eventId = await makeEvent(ghost);
    const n = await addNotification(follower, {
      type: "followee_created_event",
      title: "退会したユーザー さんがイベントを公開しました",
      link: `/events/${eventId}`,
    });

    await runBackfill();

    // ghost を actor にすると、以後 ghost 名義の一括削除が効きうる
    expect(await actorOf(n)).toBeNull();
  });

  it("ghost 行がまだ無い DB でも作成者が埋まる", async () => {
    // ghost は完全削除が1回でも起きたときに初めて作られる (accountDeletionRepo.ensureDeletedUser)。
    // 未作成の DB では除外の副問い合わせが0行を返す。
    // **0070 (2) が `NOT IN` であることを守るテスト。`!=` に戻すとここが落ちる**
    // （`created_by != NULL` が NULL に評価され、正常な行まで1件も埋まらなくなる）。
    const follower = await makeUser();
    const creator = await makeUser();
    const eventId = await makeEvent(creator);
    const n = await addNotification(follower, {
      type: "followee_created_event",
      title: "誰か さんがイベントを公開しました",
      link: `/events/${eventId}`,
    });

    await runBackfill();

    expect(await actorOf(n)).toBe(creator);
  });

  it("link 先のイベントが存在しない行は埋まらない", async () => {
    await makeGhostUser();
    const follower = await makeUser();
    const n = await addNotification(follower, {
      type: "followee_created_event",
      title: "誰か さんがイベントを公開しました",
      link: `/events/${crypto.randomUUID()}`,
    });

    await runBackfill();

    expect(await actorOf(n)).toBeNull();
  });
});

/* =========================================================
 *  (3) followee_joined_event
 * =======================================================*/

describe("埋め戻し (3) followee_joined_event", () => {
  it("タイトルが一致する参加者が1人に定まるとき埋まる", async () => {
    const follower = await makeUser();
    const joiner = await makeUser({ globalName: "参加太郎" });
    const other = await makeUser({ globalName: "別の人" });
    const eventId = await makeEvent(await makeUser());
    await joinEvent(eventId, joiner);
    await joinEvent(eventId, other);
    const n = await addNotification(follower, {
      type: "followee_joined_event",
      title: joinedTitle("参加太郎"),
      link: `/events/${eventId}`,
    });

    await runBackfill();

    expect(await actorOf(n)).toBe(joiner);
  });

  it("global_name が無ければ username で照合する（COALESCE）", async () => {
    const follower = await makeUser();
    const joiner = await makeUser({ username: "joiner_u", globalName: null });
    const eventId = await makeEvent(await makeUser());
    await joinEvent(eventId, joiner);
    const n = await addNotification(follower, {
      type: "followee_joined_event",
      title: joinedTitle("joiner_u"),
      link: `/events/${eventId}`,
    });

    await runBackfill();

    expect(await actorOf(n)).toBe(joiner);
  });

  it("同じイベントに同姓同名が2人居ると埋まらない", async () => {
    const follower = await makeUser();
    const j1 = await makeUser({ globalName: "同名太郎" });
    const j2 = await makeUser({ globalName: "同名太郎" });
    const eventId = await makeEvent(await makeUser());
    await joinEvent(eventId, j1);
    await joinEvent(eventId, j2);
    const n = await addNotification(follower, {
      type: "followee_joined_event",
      title: joinedTitle("同名太郎"),
      link: `/events/${eventId}`,
    });

    await runBackfill();

    // どちらか分からないので埋めない（COUNT=1 の条件）。
    // 誤って他人の通知を消すより、埋まらない＝退会時に消えない方を選んでいる
    const filled = await actorOf(n);
    expect(filled).toBeNull();
    expect(filled).not.toBe(j1);
    expect(filled).not.toBe(j2);
  });

  it("別のイベントに居る同名の参加者には結び付かない", async () => {
    const follower = await makeUser();
    const inX = await makeUser({ globalName: "同名太郎" });
    const inY = await makeUser({ globalName: "同名太郎" });
    const eventX = await makeEvent(await makeUser());
    const eventY = await makeEvent(await makeUser());
    await joinEvent(eventX, inX);
    await joinEvent(eventY, inY);
    const n = await addNotification(follower, {
      type: "followee_joined_event",
      title: joinedTitle("同名太郎"),
      link: `/events/${eventX}`,
    });

    await runBackfill();

    // 照合はどちらも link で event に絞られるので、イベント Y の同名は数にも入らない
    expect(await actorOf(n)).toBe(inX);
  });

  it("表示名を変えた人の通知は埋まらない（4.2 の「埋め戻せない行」）", async () => {
    const follower = await makeUser();
    const joiner = await makeUser({ globalName: "改名後" });
    const eventId = await makeEvent(await makeUser());
    await joinEvent(eventId, joiner);
    // 通知は改名前の表示名で作られている
    const n = await addNotification(follower, {
      type: "followee_joined_event",
      title: joinedTitle("改名前"),
      link: `/events/${eventId}`,
    });

    await runBackfill();

    expect(await actorOf(n)).toBeNull();
  });
});

/* =========================================================
 *  冪等性（設計 4.1 / 8. の「デプロイ完了後にもう一度流す」の担保）
 * =======================================================*/

describe("埋め戻しの冪等性", () => {
  it("actor_id が既に入っている行は3種別とも書き換えない", async () => {
    await makeGhostUser();
    const receiver = await makeUser();
    // 埋め戻しなら別人に付くはずの状況を作り、それでも既存値が残ることを見る
    const preset = await makeUser();

    const met = await makeUser({ username: "already_met" });
    const meetEvent = await makeEvent(met);
    await makeMeet(meetEvent, met, receiver);
    const nMeet = await addNotification(receiver, {
      type: "meet",
      title: "誰か さんと出会いました",
      link: meetLink("already_met"),
      actorId: preset,
    });

    const creator = await makeUser();
    const createdEvent = await makeEvent(creator);
    const nCreated = await addNotification(receiver, {
      type: "followee_created_event",
      title: "誰か さんがイベントを公開しました",
      link: `/events/${createdEvent}`,
      actorId: preset,
    });

    const joiner = await makeUser({ globalName: "参加太郎" });
    const joinedEvent = await makeEvent(creator);
    await joinEvent(joinedEvent, joiner);
    const nJoined = await addNotification(receiver, {
      type: "followee_joined_event",
      title: joinedTitle("参加太郎"),
      link: `/events/${joinedEvent}`,
      actorId: preset,
    });

    await runBackfill();

    expect(await actorOf(nMeet)).toBe(preset);
    expect(await actorOf(nCreated)).toBe(preset);
    expect(await actorOf(nJoined)).toBe(preset);
    // 3本とも AND actor_id IS NULL が付いていることの証拠
    expect(preset).not.toBe(met);
    expect(preset).not.toBe(creator);
    expect(preset).not.toBe(joiner);
  });

  it("2回流しても結果が変わらない", async () => {
    await makeGhostUser();
    const receiver = await makeUser();
    const met = await makeUser({ username: "twice_met" });
    const creator = await makeUser();
    const joiner = await makeUser({ globalName: "二回太郎" });
    const eventId = await makeEvent(creator);
    await makeMeet(eventId, met, receiver);
    await joinEvent(eventId, joiner);

    const nMeet = await addNotification(receiver, {
      type: "meet",
      title: "誰か さんと出会いました",
      link: meetLink("twice_met"),
    });
    const nCreated = await addNotification(receiver, {
      type: "followee_created_event",
      title: "誰か さんがイベントを公開しました",
      link: `/events/${eventId}`,
    });
    const nJoined = await addNotification(receiver, {
      type: "followee_joined_event",
      title: joinedTitle("二回太郎"),
      link: `/events/${eventId}`,
    });

    await runBackfill();
    const first = [
      await actorOf(nMeet),
      await actorOf(nCreated),
      await actorOf(nJoined),
    ];
    expect(first).toEqual([met, creator, joiner]);

    await runBackfill();

    expect([
      await actorOf(nMeet),
      await actorOf(nCreated),
      await actorOf(nJoined),
    ]).toEqual(first);
  });

  it("主語が人ではない通知（NULL のままにする種別）には触らない", async () => {
    await makeGhostUser();
    const receiver = await makeUser();
    const eventId = await makeEvent(await makeUser());
    // 運営宛の検知・一斉連絡など。link が /events/ でも type が対象外なら触らない
    const nBroadcast = await addNotification(receiver, {
      type: "event_broadcast",
      title: "運営からのお知らせ",
      link: `/events/${eventId}`,
    });
    const nAbuse = await addNotification(receiver, {
      type: "abuse_flag",
      title: "通報を受け付けました",
      link: `/events/${eventId}`,
    });

    await runBackfill();

    expect(await actorOf(nBroadcast)).toBeNull();
    expect(await actorOf(nAbuse)).toBeNull();
  });
});

/* =========================================================
 *  0070 との同期（設計 9.5「二重管理は照合を実在させる」）
 *
 *  BACKFILL_SQL は 0070 の写しなので、片方だけ直すと
 *  「テストは通るのに本番に流れる SQL は直っていない」状態になる。
 *  冒頭のコメントで注意を促すだけでは次に触った人で必ず破れるので、
 *  ここで 0070 の中身と機械的に突き合わせる。
 * =======================================================*/

describe("0070 との同期", () => {
  it("BACKFILL_SQL が 0070 の埋め戻し UPDATE と本数・文字とも一致する", () => {
    // 埋め戻しの UPDATE は3本とも文中に ';' を含まないので、最初の ';' まででよい
    const inMigration =
      migrationSql.match(/UPDATE notification SET actor_id[\s\S]*?;/g) ?? [];

    // 本数も見る。0070 側にだけ1本足された/減らされた場合に気づけるようにするため
    expect(inMigration).toHaveLength(BACKFILL_SQL.length);
    expect(inMigration).toHaveLength(3);
    // 正規化しない。空白や改行の違いも差分として落とす
    expect(inMigration).toEqual([...BACKFILL_SQL]);
  });
});
