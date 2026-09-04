import { describe, it, expect } from "vitest";
import { literalsOf, scanStatements, type Statement } from "./lib/sqlScan.js";

/**
 * 準備 TODO を触る SQL の置き場を1か所に閉じる (#393 設計 3.5 / 9.3)。
 *
 * 守る不変条件はこれ1つ。
 *
 * > **`event_todo` / `event_todo_dep` を読み書きする SQL は
 * > `db/repositories/eventTodos.ts` の中にしか無い。**
 *
 * #383 は `audience` を必須引数にする形で守った。あれは「1本の API が参加者と
 * スタッフの2つの聞き手を持つ」ときの解で、**聞き手が1種類しかない**ここで真似ると、
 * 存在しない参加者向け経路のために引数を配り歩くことになる。
 * こちらは参加者向けの読み手が**ゼロ**から始まるので、経路を増やさないことだけを守る。
 *
 * **この不変条件はコメントでは守れない。** #383 は 0067 のコメントに
 * 「ここでも数えない」と書いたが、そのあとに書かれた4か所には入らなかった (#394)。
 * 「イベント詳細にも出そう」と思った人が最初にぶつかるのは、このテストであるべき。
 *
 * 切り出しの実装は `test/lib/sqlScan.ts`（#383 の監査と共有）。
 *
 * ## この走査の盲点（知ったうえで使うこと）
 *
 * **変数から組む表名は映らない。** `mergeUsers` の
 * `for (const [table, col] of simple) { \`UPDATE ${table} …\` }` のように
 * 表名がループ変数・配列・引数から来る SQL は、リテラル自身が `event_todo` を
 * 含まず、`${table}` の展開も効かない（展開できるのは同じファイルの
 * `const NAME = "…"` だけ）ので、上の走査を素通りする（あちらの正しさは
 * merge-user-columns.test.ts が配列リテラルの側を読んで守っている）。
 * 同じ手で書けば監査を黙って抜けられるので、下に「`"event_todo"` という
 * 文字列リテラルがどのファイルに現れるか」の補助チェックを置き、抜け道ごと見張る。
 */

// ソースはビルド時に文字列として取り込む（workerd の中にファイルシステムは無い）
const sources = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** この表を触ってよい唯一のファイル */
const OWNER = "../src/db/repositories/eventTodos.ts";

/**
 * 読み書きの両方を拾う。**読みだけにしない。**
 * 書き込みが外に出ると、そこから「ついでに読む」までは一歩しかない
 * （複製の張り替えをルート側に置きかけた形が実際にそれだった）。
 */
const TOUCHES_TODO = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+event_todo(?:_dep)?\b/i;

/** `eventTodos.ts` の外に書いてよい SQL と、その理由。
 * **理由を書かずに足さないこと**。キーは対象の SQL に必ず含まれる文字列 */
const ALLOWED: Array<{ contains: string; why: string }> = [];

function statements(): Statement[] {
  return scanStatements(sources, "event_todo", TOUCHES_TODO);
}

/**
 * `event_todo` / `event_todo_dep` を触る SQL 文の数。
 *
 * **下限ではなく実数で固定する。** 「N 件以上」にすると、走査が壊れて
 * 半分しか見えなくなっても静かに通る。増減したらこの数を直すこと。
 * **直す前に、増えた文が `eventTodos.ts` の中にあるかを必ず読むこと。**
 */
const EXPECTED_STATEMENTS = 15;

describe("event_todo を触る SQL の走査 (#393 9.3)", () => {
  it("走査そのものが空振りしていない", () => {
    const found = statements();
    expect(
      found.length,
      `走査できた SQL 文が ${found.length} 件。想定は ${EXPECTED_STATEMENTS} 件。\n` +
        `増減したなら、増えた文が eventTodos.ts の中にあるかを読んでから ` +
        `EXPECTED_STATEMENTS を直すこと。**減ったときは走査が壊れている疑いが強い**。\n` +
        found
          .map((f) => `  - ${f.file}: ${f.sql.slice(0, 70).replace(/\s+/g, " ")}`)
          .join("\n"),
    ).toBe(EXPECTED_STATEMENTS);
  });

  it("eventTodos.ts の外に、この表を触る SQL が無い", () => {
    const outside = statements().filter(
      (s) => s.file !== OWNER && !ALLOWED.some((a) => s.sql.includes(a.contains)),
    );
    const report = outside.map((f) => `\n--- ${f.file}\n${f.raw}`).join("\n");
    expect(
      outside.map((f) => f.file),
      `event_todo / event_todo_dep を触る SQL が ${OWNER} の外にある。\n` +
        `準備 TODO はスタッフ専用で、参加者向けの経路を1本も持たないことが要件 (#393)。\n` +
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
    // 本体の取得は `${SELECT_TODOS} WHERE …` の形で、リテラル自身は
    // `FROM event_todo` を持たない。展開しないと**一覧の SQL を丸ごと見落とす**。
    // 実際に取れた文のうち、`${` を含んでいた（＝展開が効いた）ものが在ることを確かめる
    const src = [
      'const FRAG = "SELECT a FROM event_todo t";',
      "const q = `${FRAG} WHERE t.event_id = ?`;",
    ].join("\n");
    const found = scanStatements({ "x.ts": src }, "event_todo", TOUCHES_TODO);
    expect(found).toHaveLength(1);
    expect(found[0]!.sql).toContain("WHERE t.event_id = ?");
  });

  it("外に1本書くと落ちる（走査が本当に効いているか、毎回ためす）", () => {
    // #383 の走査は、最初**肝心の箇所を対象から外していて、消しても緑のまま通った**。
    // 手で1回ためすだけでは、あとで走査を緩めたときに誰も気づかない。
    // 「もし誰かがイベント詳細で TODO を引いたら」を毎回その場で作って確かめる。
    const leaked = {
      ...sources,
      "../src/routes/events.ts":
        'const q = "SELECT title FROM event_todo WHERE event_id = ?";',
    };
    const outside = scanStatements(leaked, "event_todo", TOUCHES_TODO).filter(
      (s) => s.file !== OWNER,
    );
    expect(
      outside.map((f) => f.file),
      "eventTodos.ts の外に SQL を1本置いたのに、走査が見つけられなかった",
    ).toEqual(["../src/routes/events.ts"]);
  });

  it("動的な表名の抜け道も見張る（文字列リテラルの出現で拾う）", () => {
    // 表名がループ変数・配列から来る `` `UPDATE ${table} …` `` は、
    // SQL の走査には映らない（上の盲点。`const NAME = "…"` なら展開が効くが、
    // 変数束縛は追えない）。表名そのものを文字列リテラルに持つファイルを数え、
    // 許可した場所以外に現れたら落とす。
    // ここが緩いと、監査は在るのに動的な組み立て1つで素通しになる
    const ALLOWED_FILES = new Set([
      // この表の唯一の持ち主
      OWNER,
      // mergeUsers / 各テストが読む配列リテラル（#396）。SQL は組み立てだが、
      // 対象列の網羅は merge-user-columns.test.ts が別に守っている
      "../src/db/repositories/accountMerge.ts",
    ]);
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      if (ALLOWED_FILES.has(file)) continue;
      if (!src.includes("event_todo")) continue;
      if (literalsOf(src).some((l) => l.body.includes("event_todo"))) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `"event_todo" という文字列リテラルが持ち主以外のファイルにある。\n` +
        `SQL でなくても（動的な表名・列挙・ログ）、この表に触る足がかりになる。\n` +
        `リポジトリ経由に直すか、理由を書いて ALLOWED_FILES に足すこと。`,
    ).toEqual([]);

    // 抜け道そのものを毎回その場で作って、拾えることを確かめる。
    // mergeUsers と同じ「配列 → ループ変数 → 組み立て」の形
    const sneaky = [
      'const pairs = [["event_todo", "assignee_user_id"]];',
      "for (const [table, col] of pairs) {",
      "  run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`);",
      "}",
    ].join("\n");
    // 本走査には映らない（＝この補助チェックが要る理由）
    expect(
      scanStatements({ "x.ts": sneaky }, "event_todo", TOUCHES_TODO),
    ).toEqual([]);
    // 補助チェックは拾う
    const found = literalsOf(sneaky).some((l) => l.body.includes("event_todo"));
    expect(found, "動的な表名の形を補助チェックが拾えていない").toBe(true);
    // なお `const NAME = "event_todo"` と**同じファイルで**組む形は、
    // 断片の展開が効くので本走査でも映る（sqlScan.ts の expand）。
    // 盲点は「変数束縛」だけであることをここで固定しておく
    expect(
      scanStatements(
        {
          "y.ts":
            'const table = "event_todo";\n' +
            "const q = `UPDATE ${table} SET title = ? WHERE id = ?`;",
        },
        "event_todo",
        TOUCHES_TODO,
      ),
    ).toHaveLength(1);
  });

  it("書き込みも拾う（読みだけを見張らない）", () => {
    for (const sql of [
      "INSERT INTO event_todo (id) VALUES (?)",
      "UPDATE event_todo SET title = ? WHERE id = ?",
      "DELETE FROM event_todo_dep WHERE todo_id = ?",
      "SELECT 1 FROM event_todo_dep d JOIN event_todo t ON t.id = d.todo_id",
    ]) {
      expect(TOUCHES_TODO.test(sql), `拾えていない: ${sql}`).toBe(true);
    }
    // 似た名前の別表を巻き込まない
    expect(TOUCHES_TODO.test("SELECT 1 FROM event_todos_archive")).toBe(false);
  });
});
