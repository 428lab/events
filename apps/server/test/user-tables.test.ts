import { describe, it, expect } from "vitest";
import {
  ACTIVITY_TABLES,
  EVENT_LIKE_USER_KINDS,
  SHARED_CONTENT_OWNER_COLUMNS,
} from "../src/db/repositories/userTables.js";

/**
 * user を参照する表の一覧が、統合 (accountMerge.ts) と退会 (accountDeletion.ts) で
 * **食い違わない**ことを見張る。
 *
 * この走査を書いた理由は #466 の分割そのもの。分ける前は同じ表が
 *   - `mergeUsers` の `simple`（統合で勝ち側へ付け替える）
 *   - `deleteAccount` の `reassign`（退会で ghost へ付け替える）
 *   - `hasActivity` の `tables`（引き取り可否の判定）
 * に3回書かれていて、統合にだけ足して退会に足し忘れる、という壊れ方が
 * 実際に3回起きた（#339・#380・#393）。定義は userTables.ts の1本にしたので
 * 書き写しでのズレはもう起きないが、**新しい表を統合にだけ直接書く**余地は
 * 残る。そこをこのテストで塞ぐ。
 *
 * ## この走査が自分自身に課している条件
 *
 * merge-user-columns.test.ts と同じ 3 条件を引き継ぐ。
 * 1. 列の数を**実数で固定する**（「N 本以上」にしない）
 * 2. 定義から読めた件数も実数で固定する（走査の空振りに気づくため）
 * 3. 期待値を定義から導かない（定義を読んで期待値も一緒にズレるなら、
 *    このテストは何も守っていない）
 */

const migrations = import.meta.glob("../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const sources = import.meta.glob(
  "../src/db/repositories/{accountMerge,accountDeletion,userTables}.ts",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const src = (name: string): string => {
  const s = sources[`../src/db/repositories/${name}.ts`];
  expect(s, `${name}.ts を読めなかった（走査が壊れている）`).toBeTruthy();
  return s!;
};

/* ── 1. マイグレーションから user(id) 参照と ON DELETE を読む ───────────── */

/**
 * `REFERENCES user(id)` を持つ列を、`ON DELETE` の指定つきで集める。
 * 走査の形は merge-user-columns.test.ts と同じ（このリポジトリの参照は
 * `CREATE TABLE … col … REFERENCES user(id)` と
 * `ALTER TABLE … ADD COLUMN col … REFERENCES user(id)` の2つしか無い）。
 * 後から定義された列が前を上書きする（ALTER で作り直した表を正しく見る）。
 */
function userColumnActions(): Map<string, string> {
  const out = new Map<string, string>();
  const action = (s: string): string =>
    (/ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION)/i.exec(s)?.[1] ?? "NONE")
      .toUpperCase()
      .replace(/\s+/g, " ");
  for (const raw of Object.values(migrations)) {
    const sql = raw.replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
    )) {
      for (const c of m[2]!.matchAll(
        /(?:^|,)\s*(\w+)\s+[A-Za-z]+([^,]*?REFERENCES\s+user\s*\(\s*id\s*\)[^,]*)/gi,
      )) {
        out.set(`${m[1]!}.${c[1]!}`, action(c[2]!));
      }
    }
    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)([^;]*?REFERENCES\s+user\s*\(\s*id\s*\)[^;]*)/gi,
    )) {
      out.set(`${m[1]!}.${m[2]!}`, action(m[3]!));
    }
  }
  return out;
}

/**
 * `ON DELETE` の指定が無い ＝ SQLite の既定 NO ACTION ＝ **user 行の DELETE を
 * ブロックする**列。退会 (deleteAccount) がここを解消しないと、完全削除の
 * batch が FK 違反で丸ごと失敗し、猶予期間を過ぎたアカウントが永久に消えない。
 * 引き取り (#238) でも、hasActivity が false を返した直後の deleteById が
 * 同じ理由で落ちる。
 *
 * **実数で固定する。** 増えたときは、増えた列を deleteAccount と hasActivity で
 * 扱ってからこの数を直すこと。減ったときは走査が壊れている疑いが強い。
 */
const EXPECTED_BLOCKING_COLUMNS = 5;

/** user(id) を参照する列の総数（merge-user-columns.test.ts と同じ数）。
 * こちらの走査が空振りしていないことの担保 */
const EXPECTED_USER_COLUMNS = 51;

/* ── 2. 定義の期待値（**定義から導かない**。手で書いて固定する） ───────── */

/**
 * 退会しても残す共有コンテンツの所有者列。
 * ここを増減させるのは設計判断で、統合と退会の**両方**の振る舞いが変わる。
 * 定義（userTables.ts）から導かずに書き写してあるのは、
 * 定義を1行消したときに一緒に期待値も消えては見張りにならないため。
 */
const EXPECTED_SHARED_CONTENT = [
  "community.owner_id",
  "event.created_by",
  "event_request.created_by",
  "venue.owner_id",
  "venue_offer.created_by",
];

/** 利用実績 (#238) を見る表。同じ理由で手で書いて固定する */
const EXPECTED_ACTIVITY = [
  "bgm_track.owner_id",
  "community_member.user_id",
  "deck.owner_id",
  "entry_member.user_id",
  "event.created_by",
  "event_comment.user_id",
  "event_member.user_id",
  "event_request.created_by",
  "inquiry.user_id",
  "live_set.owner_id",
  "venue.owner_id",
  "venue_admin.user_id",
  "venue_offer.created_by",
];

/** event_like.target_key がユーザーIDを指す kind。同じ理由で手で書いて固定する */
const EXPECTED_LIKE_KINDS = ["host", "staff", "participant"];

const pairs = (list: ReadonlyArray<readonly [string, string]>): string[] =>
  list.map(([t, c]) => `${t}.${c}`).sort();

describe("user を参照する表の一覧 (#466)", () => {
  it("マイグレーションの走査が空振りしていない", () => {
    const cols = userColumnActions();
    expect(
      cols.size,
      `user(id) を参照する列が ${cols.size} 本。想定は ${EXPECTED_USER_COLUMNS} 本。` +
        `**減ったときは走査が壊れている疑いが強い**`,
    ).toBe(EXPECTED_USER_COLUMNS);
  });

  it("退会の DELETE をブロックする列は、deleteAccount が先に解消している", () => {
    // ここが破れると、猶予期間を過ぎたアカウントの完全削除が FK 違反で
    // 丸ごと失敗し、日次バッチが毎日同じ行で空回りする
    const blocking = [...userColumnActions()]
      .filter(([, a]) => a === "NONE" || a === "NO ACTION" || a === "RESTRICT")
      .map(([c]) => c)
      .sort();
    expect(
      blocking.length,
      `user 行の削除をブロックする列が ${blocking.length} 本。` +
        `想定は ${EXPECTED_BLOCKING_COLUMNS} 本。\n` +
        blocking.map((c) => `  - ${c}`).join("\n"),
    ).toBe(EXPECTED_BLOCKING_COLUMNS);

    // 解消の手は2つ。ghost へ付け替える（共有コンテンツ）か、明示的に消すか
    const reassigned = new Set(pairs(SHARED_CONTENT_OWNER_COLUMNS));
    const deletion = src("accountDeletion");
    const unresolved = blocking.filter((col) => {
      if (reassigned.has(col)) return false;
      const table = col.split(".")[0]!;
      // `DELETE FROM t WHERE …` が deleteAccount の中にあるか
      return !new RegExp(`DELETE FROM ${table}\\b`).test(deletion);
    });
    expect(
      unresolved,
      `FK が user 行の削除をブロックする列を deleteAccount が解消していない。\n` +
        `userTables.ts の SHARED_CONTENT_OWNER_COLUMNS に足して ghost へ付け替えるか、\n` +
        `accountDeletion.ts で明示的に DELETE すること。\n` +
        `放置すると、猶予期間を過ぎたアカウントの完全削除が FK 違反で毎回失敗する。`,
    ).toEqual([]);
  });

  it("同じ列を hasActivity も見ている（引き取り→削除が FK で落ちない）", () => {
    // hasActivity が false を返すと accountLink はそのアカウントを deleteById する。
    // ブロックする列を持つ表を見ていないと、その DELETE が FK 違反で落ちる
    const blockingTables = new Set(
      [...userColumnActions()]
        .filter(([, a]) => a === "NONE" || a === "NO ACTION" || a === "RESTRICT")
        .map(([c]) => c.split(".")[0]!),
    );
    const seen = new Set(ACTIVITY_TABLES.map(([t]) => t));
    expect(
      [...blockingTables].filter((t) => !seen.has(t)).sort(),
      `FK が削除をブロックする表を hasActivity が見ていない。\n` +
        `userTables.ts の ACTIVITY_TABLES に足すこと。放置すると、実績なしと\n` +
        `判定されたアカウントの引き取り (#238) が、直後の deleteById で落ちる。`,
    ).toEqual([]);
  });

  it("共有コンテンツの一覧が、期待どおりの表と列である", () => {
    expect(
      pairs(SHARED_CONTENT_OWNER_COLUMNS),
      "SHARED_CONTENT_OWNER_COLUMNS を増減させると、統合と退会の**両方**の\n" +
        "振る舞いが変わる。意図した変更なら、このテストの期待値も直すこと。",
    ).toEqual(EXPECTED_SHARED_CONTENT);
  });

  it("実績判定の一覧が、期待どおりの表と列である", () => {
    expect(
      pairs(ACTIVITY_TABLES),
      "ACTIVITY_TABLES を減らすと、実績のあるアカウントが引き取り可能に\n" +
        "なってしまう (#238)。意図した変更なら、このテストの期待値も直すこと。",
    ).toEqual(EXPECTED_ACTIVITY);
  });

  it("一覧の表と列は、実在する user(id) 参照である", () => {
    const cols = userColumnActions();
    for (const col of [
      ...pairs(SHARED_CONTENT_OWNER_COLUMNS),
      ...pairs(ACTIVITY_TABLES),
    ]) {
      expect(cols.has(col), `${col} は user(id) を参照していない（綴り間違い？）`).toBe(
        true,
      );
    }
  });

  it("event_like のユーザー kind が、期待どおりの3種である", () => {
    // 1つ落とすと、統合では target_key が負け側を指したまま残り、
    // 退会ではもらったいいねが宙ぶらりんの行として残る
    const kinds = [...EVENT_LIKE_USER_KINDS.matchAll(/'(\w+)'/g)].map((m) => m[1]!);
    expect(kinds).toEqual(EXPECTED_LIKE_KINDS);
  });

  it("統合も退会も、共有コンテンツの一覧を書き写さずに import している", () => {
    // 書き写しが戻ってくると、片方だけ直る事故もそのまま戻ってくる。
    // 「定義を1本にした」ことそのものを見張る
    const merge = src("accountMerge");
    expect(
      merge.includes("...SHARED_CONTENT_OWNER_COLUMNS"),
      "mergeUsers の simple が SHARED_CONTENT_OWNER_COLUMNS を差し込んでいない",
    ).toBe(true);
    expect(
      src("accountDeletion").includes("of SHARED_CONTENT_OWNER_COLUMNS"),
      "deleteAccount が SHARED_CONTENT_OWNER_COLUMNS をそのまま回していない",
    ).toBe(true);
    for (const [table, col] of SHARED_CONTENT_OWNER_COLUMNS) {
      const inline = `["${table}", "${col}"]`;
      for (const [name, body] of [
        ["accountMerge.ts", merge],
        ["accountDeletion.ts", src("accountDeletion")],
      ] as const) {
        expect(
          body.includes(inline),
          `${name} に ${inline} が直接書かれている。` +
            `userTables.ts の定義を使うこと（2か所に書くと片方だけ直る）`,
        ).toBe(false);
      }
    }
  });
});
