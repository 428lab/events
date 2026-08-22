import { describe, it, expect } from "vitest";

/**
 * 新しい経路が増えたときに気づく仕掛け (#383 設計 9.10)。
 *
 * `audience` を必須引数にしたので、`listByEvent` / `listTracks` / `findItem` の
 * **新しい呼び出し元**はコンパイルエラーで気づける。しかし
 * **`event_schedule_item` を直に読む新しい SQL** は型では防げない
 * （経路 6・7・8 と、登壇 N 回の4か所が実際にその形だった）。
 *
 * そこで `apps/server/src` を読み、`FROM` / `JOIN` に `event_schedule_item` を持つ
 * SQL 文字列のうち、**見え方の絞り込みを見ていないもの**を落とす。
 * 例外は下の許可リストに**なぜ見なくてよいかを1行ずつ書いて**明示する。
 *
 * **この形の見落としはコメントでは防げないことが実証されている。**
 * 0067 は経路6のコメントに「ここでも数えない」と書いたが、そのあとに書かれた／
 * 見落とされた4か所には入らなかった (#394)。機械に見張らせる。
 */

// ソースはビルド時に文字列として取り込む（workerd の中にファイルシステムは無い）
const sources = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 絞り込みを見ている、と認めるしるし。
 * 生の `visibility` か、**契約を1か所に持っている断片**への参照 */
const GUARDS = [
  "visibility",
  "publicItemWhere",
  "itemFilter",
];

/** 見なくてよい SQL と、その理由。**理由を書かずに足さないこと**。
 * キーは対象の SQL に必ず含まれる文字列（部分一致） */
const ALLOWED: Array<{ contains: string; why: string }> = [
  {
    contains: "SELECT id FROM event_schedule_item WHERE event_id = ?",
    why:
      "listIds。ID しか引かず、保存 (staff 限定) で「知らない ID が混じっていないか」を" +
      "見るためだけに使う。中身は外に出ない",
  },
  {
    contains: "DELETE FROM event_schedule_item_track WHERE item_id IN",
    why: "書き込み系（保存時の対応表の張り直し）。staff 限定で、読み出しではない",
  },
  {
    contains: "DELETE FROM event_schedule_item WHERE id = ? AND event_id = ?",
    why: "書き込み系（保存で送られなかった項目の削除）。staff 限定",
  },
];

/** ソースから文字列リテラルを切り出す。
 * SQL は**入れ子のテンプレートリテラルを含まない**書き方に揃えてあるので、
 * この単純な走査で足りる（eventSchedule.ts の trackFilter のコメント参照） */
function stringLiterals(src: string): string[] {
  const re =
    /`(?:[^`\\]|\\[\s\S])*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
  return src.match(re) ?? [];
}

/** SQL 文の中のコメント (`-- …`) を落とす。
 *
 * **これが無いとこのテストは無力になる。** SQL のコメントに
 * 「条件は publicItemWhere が持つ」と書いてあるだけで合格してしまい、
 * 実際の `WHERE` から条件が消えても気づけない
 * （実装中に実際にこの穴を踏んだ）。コメントでは防げない、が出発点なので、
 * **コメントを根拠に採らない**。 */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

const READS_ITEMS = /\b(?:FROM|JOIN)\s+event_schedule_item\b/i;

interface Finding {
  file: string;
  sql: string;
}

function scan(): Finding[] {
  const out: Finding[] = [];
  for (const [file, src] of Object.entries(sources)) {
    if (!src.includes("event_schedule_item")) continue;
    for (const literal of stringLiterals(src)) {
      const sql = stripSqlComments(literal);
      if (!READS_ITEMS.test(sql)) continue;
      if (GUARDS.some((g) => sql.includes(g))) continue;
      if (ALLOWED.some((a) => sql.includes(a.contains))) continue;
      out.push({ file, sql: literal });
    }
  }
  return out;
}

describe("event_schedule_item を読む SQL の走査 (#383 9.10)", () => {
  it("ソースを読めている（走査そのものが空振りしていない）", () => {
    const files = Object.entries(sources).filter(([, s]) =>
      s.includes("event_schedule_item"),
    );
    // 走査対象が消えたら、以下のテストは黙って通ってしまう
    expect(files.length).toBeGreaterThanOrEqual(4);
    const hits = files.flatMap(([, s]) =>
      stringLiterals(s)
        .map(stripSqlComments)
        .filter((l) => READS_ITEMS.test(l)),
    );
    expect(hits.length).toBeGreaterThanOrEqual(8);
  });

  it("絞り込みを見ていない SQL が無い", () => {
    const found = scan();
    const report = found
      .map((f) => `\n--- ${f.file}\n${f.sql}`)
      .join("\n");
    expect(
      found,
      `event_schedule_item を読んでいるのに、参加者に見せてよいかを見ていない SQL がある。\n` +
        `eventSchedule.ts の publicItemWhere を WHERE に足すか、` +
        `見なくてよい理由をこのテストの ALLOWED に1行書くこと。${report}`,
    ).toEqual([]);
  });

  it("許可リストが実在する SQL を指している（腐った例外を残さない）", () => {
    const all = Object.values(sources)
      .filter((s) => s.includes("event_schedule_item"))
      .flatMap(stringLiterals)
      .map(stripSqlComments);
    for (const entry of ALLOWED) {
      expect(
        all.some((l) => l.includes(entry.contains)),
        `許可リストの「${entry.contains}」に当たる SQL がもう無い。消すこと`,
      ).toBe(true);
      expect(entry.why.length).toBeGreaterThan(10);
    }
  });
});
