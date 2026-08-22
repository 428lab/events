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
 * SQL のうち、**見え方の絞り込みを見ていないもの**を落とす。
 * 例外は下の許可リストに**なぜ見なくてよいかを1行ずつ書いて**明示する。
 *
 * **この形の見落としはコメントでは防げないことが実証されている。**
 * 0067 は経路6のコメントに「ここでも数えない」と書いたが、そのあとに書かれた／
 * 見落とされた4か所には入らなかった (#394)。機械に見張らせる。
 *
 * ## この走査が自分自身に課している条件
 *
 * 走査は「素朴に書くと肝心なところを見ない」形をいくつも持っている。実際に踏んだので
 * 3つとも塞いである。**緩めるときは、緩めた状態で実装を壊して落ちることを確かめること。**
 *
 * 1. **コメントを根拠にしない。** SQL コメントに `publicItemWhere` と書いてあるだけで
 *    合格していた（実装中に踏んだ）。JS/SQL どちらのコメントも先に落とす
 * 2. **組み立てた SQL も見る。** 本体の取得は `` `${SELECT} WHERE …` `` の形で、
 *    リテラル自身は `FROM event_schedule_item` を持たない。素朴に走査すると
 *    **絞り込みを消しても緑のまま通る**。断片を展開してから判定する
 * 3. **SELECT 句に列名があるだけでは認めない。** `s.visibility` を選んでいることと
 *    `WHERE` で絞っていることは別。比較として現れているときだけ認める
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

/** 1つの文字列リテラル（ソース上の見た目のまま） */
interface Literal {
  /** 中身（クォートを除いたソースの文字。`${…}` はそのまま残る） */
  body: string;
  /** `const NAME = <このリテラル>` の NAME。そうでなければ null */
  constName: string | null;
}

/**
 * ソースを1文字ずつ走って、**コメントの外にある**文字列リテラルを切り出す。
 *
 * 正規表現で切ると、**コメント中のバッククォート1個**でその先の対応がずれて
 * SQL を丸ごと取りこぼす。このリポジトリの注釈はバッククォートだらけなので、
 * 「いまはコメントの中か」を持って歩くしかない。
 */
function literalsOf(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  const n = src.length;
  /** 直前の非空白コード（`const X =` を見つけるために使う） */
  let codeSoFar = "";

  /** 開始位置 quote の文字列を読み飛ばし、中身を返す */
  const readString = (start: number, quote: string): [string, number] => {
    let j = start + 1;
    let body = "";
    let depth = 0; // テンプレートの `${` の入れ子
    while (j < n) {
      const c = src[j]!;
      if (c === "\\") {
        body += c + (src[j + 1] ?? "");
        j += 2;
        continue;
      }
      if (quote === "`" && c === "$" && src[j + 1] === "{") {
        depth++;
        body += "${";
        j += 2;
        continue;
      }
      if (quote === "`" && depth > 0) {
        // `${…}` の中は式。入れ子の文字列・テンプレートもここで読み飛ばす
        if (c === "}") {
          depth--;
          body += c;
          j++;
          continue;
        }
        if (c === "'" || c === '"' || c === "`") {
          const [inner, next] = readString(j, c);
          body += c + inner + c;
          j = next;
          continue;
        }
        body += c;
        j++;
        continue;
      }
      if (c === quote) return [body, j + 1];
      if (quote !== "`" && c === "\n") return [body, j + 1]; // 壊れた入力の保険
      body += c;
      j++;
    }
    return [body, n];
  };

  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const [body, after] = readString(i, c);
      const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/.exec(
        codeSoFar,
      );
      out.push({ body, constName: decl?.[1] ?? null });
      i = after;
      codeSoFar = "";
      continue;
    }
    codeSoFar += c;
    if (codeSoFar.length > 200) codeSoFar = codeSoFar.slice(-200);
    i++;
  }
  return out;
}

/** SQL 文の中のコメント (`-- …`) を落とす。**コメントを根拠に採らない** */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** `${NAME}` を、同じファイルの `const NAME = "…"` の中身で置き換える。
 * 本体の取得は `` `${SELECT} WHERE …` `` の形で組み立てているので、
 * 展開しないと **`FROM event_schedule_item` を持つ文として見えない** */
function expand(body: string, byName: Map<string, string>): string {
  let out = body;
  for (let round = 0; round < 3; round++) {
    const next = out.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (m, name: string) =>
      byName.has(name) ? byName.get(name)! : m,
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

const READS_ITEMS = /\b(?:FROM|JOIN)\s+event_schedule_item\b/i;

interface Statement {
  file: string;
  /** 展開済み・コメント除去済み（判定に使う） */
  sql: string;
  /** ソース上の見た目（報告に使う） */
  raw: string;
}

/** `event_schedule_item` を読んでいる SQL 文を全部集める。
 * **他のリテラルに埋め込まれる断片は、埋め込んだ先で見るのでここでは数えない** */
function statements(): Statement[] {
  const out: Statement[] = [];
  for (const [file, src] of Object.entries(sources)) {
    if (!src.includes("event_schedule_item")) continue;
    const literals = literalsOf(src);
    const byName = new Map<string, string>();
    for (const l of literals) {
      if (l.constName) byName.set(l.constName, l.body);
    }
    // 他のリテラルから `${NAME}` で参照されている断片の名前
    const embedded = new Set<string>();
    for (const l of literals) {
      for (const m of l.body.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
        if (byName.has(m[1]!)) embedded.add(m[1]!);
      }
    }
    for (const l of literals) {
      if (l.constName && embedded.has(l.constName)) continue;
      const sql = stripSqlComments(expand(l.body, byName));
      if (!READS_ITEMS.test(sql)) continue;
      out.push({ file, sql, raw: l.body });
    }
  }
  return out;
}

/**
 * `event_schedule_item` を読む SQL 文の数。
 *
 * **下限ではなく実数で固定する。** 「N 件以上」にすると、走査が壊れて半分しか
 * 見えなくなっても静かに通る（実際、切り出しがコメント中のバッククォート1個で
 * 壊れる形だった）。増減したらこの数を直すこと。**直す前に、増えた文が
 * 絞り込みを持っているかを必ず読むこと。**
 */
const EXPECTED_STATEMENTS = 13;

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
