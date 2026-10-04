import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * 0101_participant_encrypted_chat.sql の作り直しがスタッフチャットの行を1行も
 * 失わないこと (#582 設計 6.1 / テスト計画 S1)。
 *
 * テスト用 D1 には全マイグレーションが適用済みなので、まず3表を **0075 の定義**
 * （audience CHECK が 'staff' だけ）に戻し、スタッフの部屋・2世代の鍵・現役と失効の
 * signer を入れてから 0101 の作り直しを流す。外部キーは有効のまま流す
 * （親を先に DROP すると子へ CASCADE して鍵が消える。その事故がここで落ちる）。
 */

type Migration = { name: string; queries: string[] };
const migrations = (env as unknown as { TEST_MIGRATIONS: Migration[] }).TEST_MIGRATIONS;
const find = (prefix: string) => migrations.find((m) => m.name.startsWith(prefix))!;

async function all(sql: string): Promise<unknown[]> {
  return (await env.DB.prepare(sql).all()).results;
}

async function exec(queries: string[]): Promise<void> {
  for (const q of queries) await env.DB.prepare(q).run();
}

/** 3表の全行（比較用に並びを固定） */
async function snapshot() {
  return {
    rooms: await all(
      "SELECT event_id, audience, room_id, created_at FROM event_group_chat_room ORDER BY event_id, audience",
    ),
    keys: await all(
      "SELECT event_id, audience, version, secret, created_at, reason FROM event_group_chat_key ORDER BY event_id, audience, version",
    ),
    signers: await all(
      "SELECT event_id, audience, user_id, pubkey, secret, created_at, revoked_at FROM event_group_chat_signer ORDER BY event_id, audience, user_id",
    ),
  };
}

async function seedEvent(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at)
     VALUES (?, 'migration', 1, 2, 'offline', 'published', ?, 1)`,
  )
    .bind(id, ownerId)
    .run();
  return id;
}

async function seedUser(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, 1)",
  )
    .bind(id, `nostr:${id}`, `m_${id.slice(0, 8)}`)
    .run();
  return id;
}

const hex = (c: string) => c.repeat(64);

describe("0101 の3表作り直し (#582 S1)", () => {
  it("外部キー有効のままでも、スタッフの部屋・鍵・signer が全件そのまま残る", async () => {
    // 外部キーが効いている環境で流すこと自体が検査の前提
    const fk = (await all("PRAGMA foreign_keys")) as Array<{ foreign_keys: number }>;
    expect(fk[0]!.foreign_keys).toBe(1);

    // 3表を 0075 の定義に戻す（子から落とす）
    await exec([
      "DROP TABLE event_group_chat_signer",
      "DROP TABLE event_group_chat_key",
      "DROP TABLE event_group_chat_room",
    ]);
    await exec(find("0075_").queries);

    const owner = await seedUser();
    const second = await seedUser();
    const e1 = await seedEvent(owner);
    const e2 = await seedEvent(owner);
    await exec([
      `INSERT INTO event_group_chat_room VALUES ('${e1}', 'staff', '${hex("a")}', 10)`,
      `INSERT INTO event_group_chat_room VALUES ('${e2}', 'staff', '${hex("b")}', 20)`,
      `INSERT INTO event_group_chat_key VALUES ('${e1}', 'staff', 1, '${hex("1")}', 11, 'created')`,
      `INSERT INTO event_group_chat_key VALUES ('${e1}', 'staff', 2, '${hex("2")}', 12, 'rotated')`,
      `INSERT INTO event_group_chat_key VALUES ('${e2}', 'staff', 1, '${hex("3")}', 21, 'created')`,
      `INSERT INTO event_group_chat_signer VALUES ('${e1}', 'staff', '${owner}', '${hex("c")}', '${hex("d")}', 13, NULL)`,
      `INSERT INTO event_group_chat_signer VALUES ('${e1}', 'staff', '${second}', '${hex("e")}', '${hex("f")}', 14, 15)`,
      `INSERT INTO event_group_chat_signer VALUES ('${e2}', 'staff', '${owner}', '${hex("9")}', '${hex("8")}', 22, NULL)`,
    ]);
    // 0075 の CHECK では members は入らない（作り直しが要る理由）
    await expect(
      env.DB.prepare(
        `INSERT INTO event_group_chat_room VALUES ('${e1}', 'members', '${hex("7")}', 30)`,
      ).run(),
    ).rejects.toThrow();
    const before = await snapshot();
    expect(before.rooms).toHaveLength(2);
    expect(before.keys).toHaveLength(3);
    expect(before.signers).toHaveLength(3);

    // 0101 の作り直し部分を流す（event の列追加は適用済みなので除く）
    const rebuild = find("0101_").queries.filter(
      (q) => !/ALTER TABLE event ADD COLUMN/i.test(q),
    );
    expect(rebuild.length).toBeGreaterThan(10);
    await exec(rebuild);

    // 全件一致（roomId・鍵・signer の秘密鍵・失効時刻まで）
    expect(await snapshot()).toEqual(before);
    // 一時表は残らない
    expect(
      await all("SELECT name FROM sqlite_master WHERE name LIKE 'tmp_0101_%'"),
    ).toEqual([]);

    // CHECK は ('staff','members') に広がり、それ以外は落ちる
    await env.DB.prepare(
      `INSERT INTO event_group_chat_room VALUES ('${e1}', 'members', '${hex("7")}', 30)`,
    ).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO event_group_chat_room VALUES ('${e2}', 'other', '${hex("6")}', 31)`,
      ).run(),
    ).rejects.toThrow();

    // 作り直した表でも外部キーと CASCADE が生きている
    await expect(
      env.DB.prepare(
        `INSERT INTO event_group_chat_key VALUES ('${e2}', 'members', 1, '${hex("5")}', 32, 'created')`,
      ).run(),
    ).rejects.toThrow(); // e2 の members 部屋は無い
    await env.DB.prepare("DELETE FROM event WHERE id = ?").bind(e2).run();
    const left = await snapshot();
    expect(left.keys.filter((k) => (k as { event_id: string }).event_id === e2)).toEqual([]);
    expect(left.signers.filter((s) => (s as { event_id: string }).event_id === e2)).toEqual([]);
    // 別イベントの行は巻き込まれない
    expect(left.keys.filter((k) => (k as { event_id: string }).event_id === e1)).toHaveLength(2);
  });

  it("対照: 親から DROP する素朴な順序だと、この環境では子の鍵が CASCADE で消える", async () => {
    // 上の順序（子から DROP）が飾りではないことを確かめる。同じ形の表を別名で作り、
    // 親を先に DROP すると子の行が消えることをこの D1 で確認する
    const owner = await seedUser();
    const e = await seedEvent(owner);
    await exec([
      `CREATE TABLE ctl_room (event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
         audience TEXT NOT NULL, PRIMARY KEY (event_id, audience))`,
      `CREATE TABLE ctl_key (event_id TEXT NOT NULL, audience TEXT NOT NULL, version INTEGER NOT NULL,
         PRIMARY KEY (event_id, audience, version),
         FOREIGN KEY (event_id, audience) REFERENCES ctl_room(event_id, audience) ON DELETE CASCADE)`,
      `INSERT INTO ctl_room VALUES ('${e}', 'staff')`,
      `INSERT INTO ctl_key VALUES ('${e}', 'staff', 1)`,
      "DROP TABLE ctl_room",
    ]);
    expect(await all("SELECT * FROM ctl_key")).toEqual([]);
    await exec(["DROP TABLE ctl_key"]);
  });
});
