import { describe, it, expect } from "vitest";
import { literalsOf, scanStatements, type Statement } from "./lib/sqlScan.js";

/**
 * スタッフチャットの表を触る SQL の置き場を1か所に閉じる (#382 設計 6 / 11)。
 *
 * 守る不変条件はこれ1つ。
 *
 * > **`event_group_chat_room` / `event_group_chat_key` / `event_group_chat_signer`
 * > を読み書きする SQL は `db/repositories/staffChat.ts` の中にしか無い。**
 *
 * スタッフチャットは「参加者に部屋の存在ごと見えない」が要件 (#382) で、
 * roomId・グループ共通鍵・発言用一時鍵のどれも参加者向けの読み手は**ゼロ**。
 * event 表に列を足さず別表にしたのは、serializer の変更1つで参加者向け
 * ペイロードに漏れる径路を**構造として**作らないため（設計 6）。
 * 「イベント詳細の応答にも載せよう」と思った人が最初にぶつかるのは、
 * このテストであるべき。
 *
 * 切り出しの実装は `test/lib/sqlScan.ts`（#383 / #393 / #384 の監査と共有）。
 *
 * ## この走査の盲点（知ったうえで使うこと）
 *
 * **変数から組む表名は映らない。** `mergeUsers` (#396) の uniqueKeyed のように
 * 表名が配列リテラルから来る SQL は走査を素通りする。そこで「表名の文字列
 * リテラルがどのファイルに現れるか」の補助チェックを置き、抜け道ごと見張る。
 * accountMerge.ts の uniqueKeyed（統合の付け替え）はその補助チェック側で許可してある。
 */

// ソースはビルド時に文字列として取り込む（workerd の中にファイルシステムは無い）
const sources = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** この3表を触ってよい唯一のファイル */
const OWNER = "../src/db/repositories/staffChat.ts";

/**
 * 読み書きの両方を拾う。**読みだけにしない**（書き込みが外に出ると、
 * そこから「ついでに読む」までは一歩しかない。#393 の監査と同じ判断）。
 */
const TOUCHES_STAFF_CHAT =
  /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+event_group_chat_(?:room|key|signer)\b/i;

/** `staffChat.ts` の外に書いてよい SQL と、その理由。
 * **理由を書かずに足さないこと**。キーは対象の SQL に必ず含まれる文字列 */
const ALLOWED: Array<{ contains: string; why: string }> = [];

function statements(): Statement[] {
  return scanStatements(sources, "event_group_chat", TOUCHES_STAFF_CHAT);
}

/**
 * 3表を触る SQL 文の数。
 *
 * **下限ではなく実数で固定する。** 「N 件以上」にすると、走査が壊れて
 * 半分しか見えなくなっても静かに通る。増減したらこの数を直すこと。
 * **直す前に、増えた文が staffChat.ts の中にあるかを必ず読むこと。**
 */
const EXPECTED_STATEMENTS = 12;

describe("event_group_chat_room / _key / _signer を触る SQL の走査 (#382 11)", () => {
  it("走査そのものが空振りしていない", () => {
    const found = statements();
    expect(
      found.length,
      `走査できた SQL 文が ${found.length} 件。想定は ${EXPECTED_STATEMENTS} 件。\n` +
        `増減したなら、増えた文が staffChat.ts の中にあるかを読んでから ` +
        `EXPECTED_STATEMENTS を直すこと。**減ったときは走査が壊れている疑いが強い**。\n` +
        found
          .map((f) => `  - ${f.file}: ${f.sql.slice(0, 70).replace(/\s+/g, " ")}`)
          .join("\n"),
    ).toBe(EXPECTED_STATEMENTS);
  });

  it("staffChat.ts の外に、この表を触る SQL が無い", () => {
    const outside = statements().filter(
      (s) => s.file !== OWNER && !ALLOWED.some((a) => s.sql.includes(a.contains)),
    );
    const report = outside.map((f) => `\n--- ${f.file}\n${f.raw}`).join("\n");
    expect(
      outside.map((f) => f.file),
      `スタッフチャットの表を触る SQL が ${OWNER} の外にある。\n` +
        `部屋の存在ごと参加者に見せないことが要件 (#382) で、roomId・鍵・signer が\n` +
        `staff ゲートの外へ返る経路を1本も作らない。\n` +
        `リポジトリにメソッドを足してそこから呼ぶか、\n` +
        `外に書いてよい理由をこのテストの ALLOWED に1行書くこと。${report}`,
    ).toEqual([]);
  });

  it("許可リストが実在する SQL を指している（腐った例外を残さない）", () => {
    const all = statements();
    for (const entry of ALLOWED) {
      expect(
        all.some((s) => s.sql.includes(entry.contains)),
        `許可リストの「${entry.contains}」に当たる SQL がもう無い。消すこと`,
      ).toBe(true);
      expect(entry.why.length).toBeGreaterThan(10);
    }
  });

  it("外に1本書くと落ちる（走査が本当に効いているか、毎回ためす）", () => {
    // #383 の走査は、最初**肝心の箇所を対象から外していて、消しても緑のまま通った**。
    // 「もし誰かがイベント詳細の応答で部屋を引いたら」を毎回その場で作って確かめる
    const leaked = {
      ...sources,
      "../src/db/repositories/events.ts":
        'const q = "SELECT room_id FROM event_group_chat_room WHERE event_id = ?";',
    };
    const outside = scanStatements(
      leaked,
      "event_group_chat",
      TOUCHES_STAFF_CHAT,
    ).filter((s) => s.file !== OWNER);
    expect(
      outside.map((f) => f.file),
      "staffChat.ts の外に SQL を1本置いたのに、走査が見つけられなかった",
    ).toEqual(["../src/db/repositories/events.ts"]);
  });

  it("動的な表名の抜け道も見張る（文字列リテラルの出現で拾う）", () => {
    // 表名がループ変数・配列から来る `` `UPDATE ${table} …` `` は SQL の走査に
    // 映らない（上の盲点）。表名そのものを文字列リテラルに持つファイルを数え、
    // 許可した場所以外に現れたら落とす
    const ALLOWED_FILES = new Set([
      // この3表の唯一の持ち主
      OWNER,
      // mergeUsers の uniqueKeyed 配列リテラル（#396）。SQL は組み立てだが、
      // 対象列の網羅は merge-user-columns.test.ts が別に守っている
      "../src/db/repositories/accountMerge.ts",
    ]);
    const TABLE_NAMES = [
      "event_group_chat_room",
      "event_group_chat_key",
      "event_group_chat_signer",
    ];
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      if (ALLOWED_FILES.has(file)) continue;
      if (!TABLE_NAMES.some((t) => src.includes(t))) continue;
      if (
        literalsOf(src).some((l) => TABLE_NAMES.some((t) => l.body.includes(t)))
      ) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `スタッフチャットの表名の文字列リテラルが持ち主以外のファイルにある。\n` +
        `SQL でなくても（動的な表名・列挙・ログ）、この表に触る足がかりになる。\n` +
        `リポジトリ経由に直すか、理由を書いて ALLOWED_FILES に足すこと。`,
    ).toEqual([]);

    // 抜け道そのものを毎回その場で作って、拾えることを確かめる
    const sneaky = [
      'const pairs = [["event_group_chat_signer", "user_id"]];',
      "for (const [table, col] of pairs) {",
      "  run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`);",
      "}",
    ].join("\n");
    // 本走査には映らない（＝この補助チェックが要る理由）
    expect(
      scanStatements({ "x.ts": sneaky }, "event_group_chat", TOUCHES_STAFF_CHAT),
    ).toEqual([]);
    // 補助チェックは拾う
    expect(
      literalsOf(sneaky).some((l) => l.body.includes("event_group_chat_signer")),
      "動的な表名の形を補助チェックが拾えていない",
    ).toBe(true);
  });

  it("書き込みも拾う（読みだけを見張らない）", () => {
    for (const sql of [
      "INSERT INTO event_group_chat_room (event_id) VALUES (?)",
      "UPDATE event_group_chat_signer SET revoked_at = ? WHERE user_id = ?",
      "DELETE FROM event_group_chat_key WHERE event_id = ?",
      "SELECT 1 FROM event_group_chat_key k JOIN event_group_chat_room r ON r.event_id = k.event_id",
    ]) {
      expect(TOUCHES_STAFF_CHAT.test(sql), `拾えていない: ${sql}`).toBe(true);
    }
    // 似た名前の別表を巻き込まない
    expect(TOUCHES_STAFF_CHAT.test("SELECT 1 FROM event_chat_key")).toBe(false);
    expect(
      TOUCHES_STAFF_CHAT.test("SELECT 1 FROM event_group_chat_rooms_old"),
    ).toBe(false);
  });
});
