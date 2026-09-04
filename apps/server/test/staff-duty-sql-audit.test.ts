import { describe, it, expect } from "vitest";
import { literalsOf, scanStatements, type Statement } from "./lib/sqlScan.js";

/**
 * 役割と持ち場を触る SQL の置き場を1か所に閉じる (#384 設計 3.5 / 9.4)。
 *
 * 守る不変条件はこれ1つ。
 *
 * > **`event_staff_duty` / `event_duty_slot` / `event_duty_assignee` を読み書きする
 * > SQL は `db/repositories/eventDuties.ts` の中にしか無い。**
 *
 * 持ち場は「スタッフにしか見えない」が要件 (#384) で、参加者向けの読み手は
 * **ゼロ**から始まる。#393 (TODO) と同じく、`audience` のような引数を配り歩く
 * 代わりに「経路を1本も作らない」ことだけを守る。
 * 「タイムテーブルの応答にも載せよう」と思った人が最初にぶつかるのは、
 * このテストであるべき（載せない理由は設計 3.5: 絞り込みの条件分岐が1つ増え、
 * 忘れた側に倒れると参加者へ漏れる。専用 GET なら忘れる場所が無い）。
 *
 * 切り出しの実装は `test/lib/sqlScan.ts`（#383 / #393 の監査と共有）。
 *
 * ## この走査の盲点（知ったうえで使うこと）
 *
 * **変数から組む表名は映らない。** `mergeUsers` の
 * `for (const [table, col] of uniqueKeyed) { \`UPDATE ${table} …\` }` のように
 * 表名がループ変数・配列・引数から来る SQL は走査を素通りする（展開できるのは
 * 同じファイルの `const NAME = "…"` だけ）。あちらの正しさは
 * merge-user-columns.test.ts が配列リテラルの側を読んで守っている。
 * 同じ手で書けば監査を黙って抜けられるので、下に「表名の文字列リテラルが
 * どのファイルに現れるか」の補助チェックを置き、抜け道ごと見張る。
 */

// ソースはビルド時に文字列として取り込む（workerd の中にファイルシステムは無い）
const sources = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** この3表を触ってよい唯一のファイル */
const OWNER = "../src/db/repositories/eventDuties.ts";

/**
 * 読み書きの両方を拾う。**読みだけにしない**（書き込みが外に出ると、
 * そこから「ついでに読む」までは一歩しかない。#393 の監査と同じ判断）。
 */
const TOUCHES_DUTY =
  /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+event_(?:staff_duty|duty_slot|duty_assignee)\b/i;

/** `eventDuties.ts` の外に書いてよい SQL と、その理由。
 * **理由を書かずに足さないこと**。キーは対象の SQL に必ず含まれる文字列 */
const ALLOWED: Array<{ contains: string; why: string }> = [];

function statements(): Statement[] {
  return scanStatements(sources, "duty", TOUCHES_DUTY);
}

/**
 * 3表を触る SQL 文の数。
 *
 * **下限ではなく実数で固定する。** 「N 件以上」にすると、走査が壊れて
 * 半分しか見えなくなっても静かに通る。増減したらこの数を直すこと。
 * **直す前に、増えた文が eventDuties.ts の中にあるかを必ず読むこと。**
 */
const EXPECTED_STATEMENTS = 23;

describe("event_staff_duty / event_duty_slot / event_duty_assignee を触る SQL の走査 (#384 9.4)", () => {
  it("走査そのものが空振りしていない", () => {
    const found = statements();
    expect(
      found.length,
      `走査できた SQL 文が ${found.length} 件。想定は ${EXPECTED_STATEMENTS} 件。\n` +
        `増減したなら、増えた文が eventDuties.ts の中にあるかを読んでから ` +
        `EXPECTED_STATEMENTS を直すこと。**減ったときは走査が壊れている疑いが強い**。\n` +
        found
          .map((f) => `  - ${f.file}: ${f.sql.slice(0, 70).replace(/\s+/g, " ")}`)
          .join("\n"),
    ).toBe(EXPECTED_STATEMENTS);
  });

  it("eventDuties.ts の外に、この表を触る SQL が無い", () => {
    const outside = statements().filter(
      (s) => s.file !== OWNER && !ALLOWED.some((a) => s.sql.includes(a.contains)),
    );
    const report = outside.map((f) => `\n--- ${f.file}\n${f.raw}`).join("\n");
    expect(
      outside.map((f) => f.file),
      `役割と持ち場の表を触る SQL が ${OWNER} の外にある。\n` +
        `持ち場はスタッフ専用で、参加者向けの経路を1本も持たないことが要件 (#384)。\n` +
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

  it("走査が組み立てた SQL も見ている（断片を展開しないと素通しになる）", () => {
    // 割り当ての取得は `${ASSIGNEE_SELECT} WHERE …` の形で、リテラル自身は
    // `FROM event_duty_assignee` を持たない。展開しないと丸ごと見落とす
    const src = [
      'const FRAG = "SELECT a.id FROM event_duty_assignee a";',
      "const q = `${FRAG} WHERE a.slot_id = ?`;",
    ].join("\n");
    const found = scanStatements({ "x.ts": src }, "duty", TOUCHES_DUTY);
    expect(found).toHaveLength(1);
    expect(found[0]!.sql).toContain("WHERE a.slot_id = ?");
  });

  it("外に1本書くと落ちる（走査が本当に効いているか、毎回ためす）", () => {
    // #383 の走査は、最初**肝心の箇所を対象から外していて、消しても緑のまま通った**。
    // 「もし誰かがタイムテーブルの応答で持ち場を引いたら」を毎回その場で作って確かめる
    const leaked = {
      ...sources,
      "../src/routes/eventSchedule.ts":
        'const q = "SELECT duty_id FROM event_duty_slot WHERE item_id = ?";',
    };
    const outside = scanStatements(leaked, "duty", TOUCHES_DUTY).filter(
      (s) => s.file !== OWNER,
    );
    expect(
      outside.map((f) => f.file),
      "eventDuties.ts の外に SQL を1本置いたのに、走査が見つけられなかった",
    ).toEqual(["../src/routes/eventSchedule.ts"]);
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
    const TABLE_NAMES = ["event_staff_duty", "event_duty_slot", "event_duty_assignee"];
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
      `役割と持ち場の表名の文字列リテラルが持ち主以外のファイルにある。\n` +
        `SQL でなくても（動的な表名・列挙・ログ）、この表に触る足がかりになる。\n` +
        `リポジトリ経由に直すか、理由を書いて ALLOWED_FILES に足すこと。`,
    ).toEqual([]);

    // 抜け道そのものを毎回その場で作って、拾えることを確かめる
    const sneaky = [
      'const pairs = [["event_duty_assignee", "user_id"]];',
      "for (const [table, col] of pairs) {",
      "  run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`);",
      "}",
    ].join("\n");
    // 本走査には映らない（＝この補助チェックが要る理由）
    expect(scanStatements({ "x.ts": sneaky }, "duty", TOUCHES_DUTY)).toEqual([]);
    // 補助チェックは拾う
    expect(
      literalsOf(sneaky).some((l) => l.body.includes("event_duty_assignee")),
      "動的な表名の形を補助チェックが拾えていない",
    ).toBe(true);
  });

  it("書き込みも拾う（読みだけを見張らない）", () => {
    for (const sql of [
      "INSERT INTO event_staff_duty (id) VALUES (?)",
      "UPDATE event_duty_slot SET required_count = ? WHERE id = ?",
      "DELETE FROM event_duty_assignee WHERE id = ?",
      "SELECT 1 FROM event_duty_slot s JOIN event_staff_duty d ON d.id = s.duty_id",
    ]) {
      expect(TOUCHES_DUTY.test(sql), `拾えていない: ${sql}`).toBe(true);
    }
    // 似た名前の別表を巻き込まない
    expect(TOUCHES_DUTY.test("SELECT 1 FROM event_duty_slots_archive")).toBe(
      false,
    );
    expect(TOUCHES_DUTY.test("SELECT 1 FROM event_member")).toBe(false);
  });
});
