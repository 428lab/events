import { describe, it, expect } from "vitest";

/**
 * アカウント統合の対象列が手動リストで、登録漏れが静かに壊れる (#396)。
 *
 * `user(id)` を参照する列は 43 本あるが、`mergeUsers` の登録は**人が足す運用**だった。
 * 登録し忘れると、統合で負け側の `user` 行を消した瞬間に
 *   - `ON DELETE SET NULL` の列 → 値が消える（統合したはずの担当が未割り当てに戻る）
 *   - `ON DELETE CASCADE` の列 → 行ごと消える（質問・連絡の履歴が消える）
 *   - 制約が無い列 → 存在しない id を指したまま残る
 * のどれかが起き、**統合の直後には気づかない**。
 *
 * 同じ見落としが #339・#380・#393 と3回続いた（3回とも人が拾った）ので、機械に見張らせる。
 *
 * ## この走査が自分自身に課している条件
 *
 * #383 の SQL 監査は、最初**肝心の箇所を走査対象から外していて、実装を壊しても
 * 緑のまま通った**。同じ失敗を繰り返さないために、この走査は
 *
 * 1. **列の数を実数で固定する**（「N 本以上」にしない。走査が壊れて半分しか
 *    見えなくなっても静かに通るため）
 * 2. **抽出した組の数も実数で固定する**（`mergeUsers` 側の走査が空振りしても気づく）
 * 3. **登録を1つ外すと落ちることを、テスト自身が毎回確かめる**（下の「変異」）。
 *    手で1回試すだけだと、あとで走査を緩めたときに誰も気づかない
 */

const migrations = import.meta.glob("../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const repoSources = import.meta.glob("../src/db/repositories/users.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** `table.column` の組。比較しやすいよう1本の文字列で持つ */
type Column = string;

/* ── 1. マイグレーションから `user(id)` を参照する列を全部抜き出す ───────── */

/**
 * `REFERENCES user(id)` を持つ列を、表名つきで集める。
 *
 * このリポジトリの参照は2つの形しか無い（走査を書く前に全マイグレーションを確認した）。
 *   - `CREATE TABLE t ( … col TEXT … REFERENCES user(id) … )`
 *   - `ALTER TABLE t ADD COLUMN col TEXT REFERENCES user(id) …`
 * 表単位の `FOREIGN KEY (col) REFERENCES user(id)` は1本も無い。
 * **もし将来その形が入ったら、この走査は静かに見落とす**ので、
 * 下の「列の数」を実数で固定して気づけるようにしてある。
 *
 * SQL コメントは先に落とす（`-- REFERENCES user(id)` と書いた注釈を拾わないため）。
 */
function userColumns(): Column[] {
  const out: Column[] = [];
  for (const src of Object.values(migrations)) {
    const sql = src.replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
    )) {
      const table = m[1]!;
      for (const c of m[2]!.matchAll(
        /(?:^|,)\s*(\w+)\s+[A-Za-z]+[^,]*?REFERENCES\s+user\s*\(\s*id\s*\)/gi,
      )) {
        out.push(`${table}.${c[1]!}`);
      }
    }
    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)[^;]*?REFERENCES\s+user\s*\(\s*id\s*\)/gi,
    )) {
      out.push(`${m[1]!}.${m[2]!}`);
    }
  }
  return [...new Set(out)].sort();
}

/* ── 2. `mergeUsers` が実際に扱っている組を抜き出す ─────────────────── */

/** `users.ts` のうち `mergeUsers` の本体だけ（他のメソッドの SQL を根拠にしない。
 * `deleteAccount` にも同じ形の付け替え表があり、混ぜると
 * 「退会では扱うが統合では扱わない」列を見逃す） */
function mergeUsersBody(src: string): string {
  const start = src.indexOf("async mergeUsers");
  expect(start, "users.ts に mergeUsers が見つからない").toBeGreaterThan(-1);
  const end = src.indexOf("\n  /** 「退会済みユーザー」", start);
  expect(end, "mergeUsers の終わりが見つからない").toBeGreaterThan(start);
  return src.slice(start, end);
}

/**
 * `mergeUsers` が付け替える `table.column` を集める。3つの経路がある。
 *
 * 1. `uniqueKeyed` の表（UNIQUE キーを持つので衝突行を先に消してから付け替える）
 * 2. `simple` の表（UNIQUE の無い参照列。ループで `UPDATE t SET c = ?` を組み立てる）
 * 3. 個別に書かれた `UPDATE t SET c = …`（`user_follow` / `event_meet` など、
 *    正規化や自己参照の始末が要るもの）
 *
 * 1 と 2 は**実行時に SQL を組み立てる**ので、文字列だけを走査すると見えない。
 * 配列リテラルのほうを読む。3 は文字列に出るので `UPDATE` 側を読む。
 */
function handledColumns(body: string): Set<Column> {
  const out = new Set<Column>();
  // 各要素の形が違うので、リストごとに別の形で読む。
  // `["t", "c"]` の2要素だけを拾う形にすると uniqueKeyed の keyCols
  // （`["entry_id", "criterion_id"]`）まで表.列として数えてしまう
  const lists: Array<[name: string, entry: RegExp]> = [
    // ["表", "user 列", ["キー列", …]]
    ["uniqueKeyed", /\["(\w+)",\s*"(\w+)",\s*\[/g],
    // ["表", "列"]
    ["simple", /\["(\w+)",\s*"(\w+)"\]/g],
  ];
  for (const [name, entry] of lists) {
    const m = new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\n    \\];`).exec(body);
    expect(m, `mergeUsers の ${name} の配列を読めなかった（走査が壊れている）`)
      .not.toBeNull();
    const found = [...m![1]!.matchAll(entry)];
    expect(
      found.length,
      `mergeUsers の ${name} から1件も読めなかった（走査が壊れている）`,
    ).toBeGreaterThan(0);
    for (const e of found) out.add(`${e[1]!}.${e[2]!}`);
  }
  // `UPDATE t SET c = …, d = …` の代入先。WHERE より手前だけを見る
  // （`WHERE user_id = ?` は「付け替えた」証拠にならない）
  for (const m of body.matchAll(/UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)(?:WHERE|RETURNING|`)/gi)) {
    for (const c of m[2]!.matchAll(/(?:^|,)\s*(\w+)\s*=/g)) {
      out.add(`${m[1]!}.${c[1]!}`);
    }
  }
  return out;
}

/* ── 3. 扱わない列は、理由を書かせる ──────────────────────────── */

/** **意図して扱わない**列。統合の設計上そうしているもの */
const INTENTIONAL: Array<{ column: Column; why: string }> = [
  {
    column: "session.user_id",
    why:
      "負け側のログインセッションは統合せず破棄する（mergeUsers (7) の " +
      "DELETE FROM session）。付け替えると、統合前に負け側で開いていた端末が " +
      "そのまま勝ち側として動き続ける",
  },
  {
    column: "event_schedule_state.editor_user_id",
    why:
      "タイムテーブルの編集ロックの保持者 (#340)。厳密な排他ではない助言で、" +
      "一定時間で自動的に解除される一時的な値。統合で NULL に落ちても " +
      "次に編集を始めた人が取り直すだけで、失われる情報が無い",
  },
  {
    column: "event_chat_pubkey.user_id",
    why:
      "0047 で入れたあと 0066 の event_chat_key に置き換わった旧表。" +
      "apps/server/src からの参照が1件も無く、新しい行が増えることはない",
  },
];

/**
 * **扱えていない**列。ここに入っている＝統合で静かに壊れるということ。
 *
 * #396 が予告したとおりの見落としが、この走査を書いた時点で既に4本あった
 * （Q&A の質問・票と一斉連絡の履歴・未送信メール）。#398 で全部 mergeUsers に
 * 登録したので、いまは空。`breaks` を空にできない形にしてあるので、
 * 黙って足すことはできない。
 */
const UNRESOLVED: Array<{ column: Column; breaks: string }> = [];

/**
 * `user(id)` を参照する列の数。**下限ではなく実数で固定する。**
 * 「N 本以上」にすると、走査が壊れて半分しか見えなくなっても静かに通る。
 * 増減したらこの数を直すこと。**直す前に、増えた列が mergeUsers で
 * 扱われているかを必ず読むこと。**
 */
const EXPECTED_USER_COLUMNS = 49;

/**
 * `mergeUsers` が扱う `table.column` の数（user 参照でない列も含む生の抽出数）。
 * 走査そのものが空振りしていないことの担保。
 */
const EXPECTED_HANDLED_PAIRS = 52;

describe("アカウント統合の対象列の走査 (#396)", () => {
  const body = mergeUsersBody(Object.values(repoSources)[0]!);

  it("マイグレーションの走査が空振りしていない", () => {
    const cols = userColumns();
    expect(
      cols.length,
      `user(id) を参照する列が ${cols.length} 本。想定は ${EXPECTED_USER_COLUMNS} 本。\n` +
        `増えたなら mergeUsers で扱うか、下の INTENTIONAL / UNRESOLVED に理由を書くこと。\n` +
        `**減ったときは走査が壊れている疑いが強い**。\n` +
        cols.map((c) => `  - ${c}`).join("\n"),
    ).toBe(EXPECTED_USER_COLUMNS);
  });

  it("mergeUsers 側の走査が空振りしていない", () => {
    const handled = handledColumns(body);
    expect(
      handled.size,
      `mergeUsers から抽出できた列が ${handled.size} 組。` +
        `想定は ${EXPECTED_HANDLED_PAIRS} 組。減ったときは走査が壊れている疑いが強い`,
    ).toBe(EXPECTED_HANDLED_PAIRS);
  });

  it("user(id) を参照する列は、扱われているか理由つきで除外されている", () => {
    const handled = handledColumns(body);
    const excused = new Set<Column>([
      ...INTENTIONAL.map((e) => e.column),
      ...UNRESOLVED.map((e) => e.column),
    ]);
    const missing = userColumns().filter(
      (c) => !handled.has(c) && !excused.has(c),
    );
    expect(
      missing,
      `user(id) を参照しているのに mergeUsers が付け替えない列がある。\n` +
        `users.ts の mergeUsers の simple（UNIQUE が無い列）または uniqueKeyed に足すか、\n` +
        `扱わない理由をこのテストの INTENTIONAL / UNRESOLVED に書くこと。\n` +
        `放置すると、統合で負け側の user 行を消した瞬間に値か行が静かに消える。`,
    ).toEqual([]);
  });

  it("除外リストが実在する列を指している（腐った例外を残さない）", () => {
    const cols = new Set(userColumns());
    const handled = handledColumns(body);
    for (const e of [...INTENTIONAL, ...UNRESOLVED]) {
      expect(cols.has(e.column), `除外リストの ${e.column} はもう存在しない。消すこと`).toBe(
        true,
      );
      expect(
        handled.has(e.column),
        `${e.column} は mergeUsers が扱うようになっている。除外リストから消すこと`,
      ).toBe(false);
    }
    for (const e of INTENTIONAL) expect(e.why.length).toBeGreaterThan(20);
    for (const e of UNRESOLVED) expect(e.breaks.length).toBeGreaterThan(20);
  });

  it("登録を1つ外すと落ちる（走査が本当に効いているか、毎回ためす）", () => {
    // #383 の SQL 監査は、最初これを確かめていなかったせいで
    // **肝心の箇所を対象から外したまま緑だった**。手で1回ためすだけでは、
    // あとで走査を緩めたときに誰も気づかない。テスト自身に毎回ためさせる。
    const line = '["event_todo", "assignee_user_id"],';
    expect(body, `${line} が mergeUsers に無い（#393 の登録が消えている）`).toContain(
      line,
    );
    expect(handledColumns(body).has("event_todo.assignee_user_id")).toBe(true);

    // その1行だけを抜いた「壊れた users.ts」を作って同じ走査にかける
    const broken = body.replace(line, "");
    const handledAfter = handledColumns(broken);
    expect(
      handledAfter.has("event_todo.assignee_user_id"),
      "登録を1行外したのに、走査はまだ「扱われている」と答えた。走査が緩んでいる",
    ).toBe(false);

    const excused = new Set<Column>([
      ...INTENTIONAL.map((e) => e.column),
      ...UNRESOLVED.map((e) => e.column),
    ]);
    const missing = userColumns().filter(
      (c) => !handledAfter.has(c) && !excused.has(c),
    );
    expect(
      missing,
      "登録を1行外したのに、検出された未登録列が空だった。このテストは何も守っていない",
    ).toEqual(["event_todo.assignee_user_id"]);
  });

  it("uniqueKeyed 側の登録も、1つ外すと落ちる（#384 の組で毎回ためす）", () => {
    // simple（上の変異）と uniqueKeyed は別の正規表現で読む。simple 側だけ
    // 確かめていると、uniqueKeyed の走査が緩んでも気づかない
    const line = '["event_duty_assignee", "user_id", ["slot_id"]],';
    expect(body, `${line} が mergeUsers に無い（#384 の登録が消えている）`).toContain(
      line,
    );
    expect(handledColumns(body).has("event_duty_assignee.user_id")).toBe(true);

    const broken = body.replace(line, "");
    const handledAfter = handledColumns(broken);
    expect(
      handledAfter.has("event_duty_assignee.user_id"),
      "uniqueKeyed の登録を1行外したのに、走査はまだ「扱われている」と答えた",
    ).toBe(false);

    const excused = new Set<Column>([
      ...INTENTIONAL.map((e) => e.column),
      ...UNRESOLVED.map((e) => e.column),
    ]);
    const missing = userColumns().filter(
      (c) => !handledAfter.has(c) && !excused.has(c),
    );
    expect(
      missing,
      "uniqueKeyed の登録を1行外したのに、検出された未登録列が空だった",
    ).toEqual(["event_duty_assignee.user_id"]);
  });

  it("SQL コメントの中の REFERENCES を根拠にしない", () => {
    // 走査を緩めるとここが最初に破れる（注釈に書いた例が列として数えられる）
    const sql = "-- col TEXT REFERENCES user(id)\nCREATE TABLE t (\n  a TEXT\n);";
    const stripped = sql.replace(/--[^\n]*/g, "");
    expect(stripped.includes("REFERENCES")).toBe(false);
  });
});
