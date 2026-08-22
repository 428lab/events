import { describe, it, expect } from "vitest";
import {
  literalsOf,
  scanStatements,
  type Statement,
} from "./lib/sqlScan.js";

/**
 * 新しい経路が増えたときに気づく仕掛け (#383 設計 9.10)。
 *
 * `audience` を必須引数にしたので、`listByEvent` / `listTracks` / `findItem` の
 * **新しい呼び出し元**はコンパイルエラーで気づける。しかし
 * **`event_schedule_item` を直に読む新しい SQL** は型では防げない
 * （経路 6・7・8 と、登壇 N 回の4か所が実際にその形だった）。
 *
 * そこで `apps/server/src` を読み、`FROM` / `JOIN` に `event_schedule_item` を持つ
 * SQL のうち、**見え方の絞り込みを見ていないもの**を落とす。
 * 例外は下の許可リストに**なぜ見なくてよいかを1行ずつ書いて**明示する。
 *
 * **この形の見落としはコメントでは防げないことが実証されている。**
 * 0067 は経路6のコメントに「ここでも数えない」と書いたが、そのあとに書かれた／
 * 見落とされた4か所には入らなかった (#394)。機械に見張らせる。
 *
 * 切り出しの実装（コメント除去・断片の展開・リテラルの走査）は
 * `test/lib/sqlScan.ts` が持つ。**#393 の監査と共有している**ので、
 * 走査を緩めると両方が同時に緩む。緩めるときは実装を壊して落ちることを確かめること。
 */

// ソースはビルド時に文字列として取り込む（workerd の中にファイルシステムは無い）
const sources = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

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
    contains: "SELECT id, material_url, material_og_image, material_og_url",
    why:
      "saveAll が差分を取るための読み。staff 限定の保存の中だけで使い、" +
      "**絞ると裏方が保存のたびに消える**（送られなかった既存項目＝削除、の規則に当たる）",
  },
  {
    contains: "DELETE FROM event_schedule_item_track WHERE item_id IN",
    why: "書き込み系（保存時の対応表の張り直し）。staff 限定で、読み出しではない",
  },
  {
    contains: "DELETE FROM event_schedule_item WHERE id = ? AND event_id = ?",
    why: "書き込み系（保存で送られなかった項目の削除）。staff 限定",
  },
  {
    contains: "SELECT id FROM event_schedule_item WHERE id = ? AND event_id = ?",
    why:
      "eventDuties.itemInEvent (#384)。持ち場を置く前の所有チェックで、ID しか引かず" +
      "項目の中身は外に出ない。staff 限定ルート（requireEventRole で配下ごと閉鎖）" +
      "からしか呼ばれない。持ち場は公開・裏方を問わず全項目に置ける（設計 3.3）ので" +
      "**絞らないことが正しい**（絞ると公開セッションの司会に持ち場を当てられない）",
  },
  {
    contains: "SELECT s.id, s.item_id, s.duty_id, s.required_count",
    why:
      "eventDuties の listSlots / findSlotInEvent (#384)。持ち場の一覧と所有チェック。" +
      "項目からは JOIN の突き合わせにしか使わず、項目の中身（題名・時刻）は引かない。" +
      "staff 限定ルート（requireEventRole(['staff']) で配下ごと閉鎖）からしか呼ばれない",
  },
  {
    contains: "FROM event_duty_assignee a",
    why:
      "eventDuties の割り当ての解決 (ASSIGNEE_SELECT) と assigneeInSlot (#384)。" +
      "項目からは event_id を引くためだけに JOIN する。staff 限定ルート" +
      "（requireEventRole(['staff']) で配下ごと閉鎖）からしか呼ばれない。" +
      "この3表が eventDuties.ts の外に無いことは staff-duty-sql-audit.test.ts が守る",
  },
];

/** 絞り込みを見ている、と認めるしるし。
 *
 * **契約を1か所に持っている断片への参照**か、`WHERE` 側に現れた実際の比較だけ。
 * `SELECT s.visibility,` のような列の選択は認めない（絞っていないため）。 */
const GUARDS: RegExp[] = [
  /\bpublicItemWhere\s*\(/,
  /\bitemFilter\s*\(/,
  /\bvisibility\s*(?:=|!=|<>|\bIN\b|\bNOT\b)/i,
];

const READS_ITEMS = /\b(?:FROM|JOIN)\s+event_schedule_item\b/i;

/** `event_schedule_item` を読んでいる SQL 文を全部集める */
function statements(): Statement[] {
  return scanStatements(sources, "event_schedule_item", READS_ITEMS);
}

/**
 * `event_schedule_item` を読む SQL 文の数。
 *
 * **下限ではなく実数で固定する。** 「N 件以上」にすると、走査が壊れて半分しか
 * 見えなくなっても静かに通る（実際、切り出しがコメント中のバッククォート1個で
 * 壊れる形だった）。増減したらこの数を直すこと。**直す前に、増えた文が
 * 絞り込みを持っているかを必ず読むこと。**
 */
const EXPECTED_STATEMENTS = 18;

describe("event_schedule_item を読む SQL の走査 (#383 9.10)", () => {
  it("走査そのものが空振りしていない", () => {
    const found = statements();
    expect(
      found.length,
      `走査できた SQL 文が ${found.length} 件。想定は ${EXPECTED_STATEMENTS} 件。\n` +
        `増減したなら、増えた文が絞り込みを持っているかを読んでから ` +
        `EXPECTED_STATEMENTS を直すこと。**減ったときは走査が壊れている疑いが強い**。\n` +
        found.map((f) => `  - ${f.file}: ${f.sql.slice(0, 70).replace(/\s+/g, " ")}`).join("\n"),
    ).toBe(EXPECTED_STATEMENTS);
  });

  it("絞り込みを見ていない SQL が無い", () => {
    const found = statements().filter(
      (s) =>
        !GUARDS.some((g) => g.test(s.sql)) &&
        !ALLOWED.some((a) => s.sql.includes(a.contains)),
    );
    const report = found.map((f) => `\n--- ${f.file}\n${f.raw}`).join("\n");
    expect(
      found.map((f) => f.file),
      `event_schedule_item を読んでいるのに、参加者に見せてよいかを見ていない SQL がある。\n` +
        `eventSchedule.ts の publicItemWhere を WHERE に足すか、` +
        `見なくてよい理由をこのテストの ALLOWED に1行書くこと。${report}`,
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

  it("SELECT 句に列名があるだけでは合格にしない", () => {
    // 実装を壊す形そのもの。`s.visibility` を選んでいても WHERE で絞っていなければ
    // 通してはいけない（この判定が緩むと、走査は在るのに何も守らなくなる）
    const selectOnly =
      "SELECT s.id, s.placement, s.visibility FROM event_schedule_item s WHERE s.event_id = ?";
    expect(GUARDS.some((g) => g.test(selectOnly))).toBe(false);
    const guarded = `${selectOnly} AND s.visibility = 'public'`;
    expect(GUARDS.some((g) => g.test(guarded))).toBe(true);
  });

  it("コメント中のバッククォートで切り出しが壊れない", () => {
    const src = [
      "// `visibility` の話をするコメント（バッククォートが奇数個）",
      'const q = "SELECT x FROM event_schedule_item si WHERE si.event_id = ?";',
    ].join("\n");
    const found = literalsOf(src).filter((l) => READS_ITEMS.test(l.body));
    expect(found).toHaveLength(1);
  });
});
