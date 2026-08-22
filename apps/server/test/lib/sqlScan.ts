/**
 * ソースから SQL 文を切り出す走査。**#383 と #393 の監査テストが共有する。**
 *
 * 「この表を触る SQL がどこに書かれているか」を機械で見張る仕掛けは、
 * いま2つある（`staff-timeline-sql-audit.test.ts` と `staff-todo-sql-audit.test.ts`）。
 * 切り出しの実装を各テストが写し取ると、**片方だけ直った状態**が必ず生まれる。
 * 走査が緩んだ側は「在るのに何も守っていない」テストになり、しかもそれは緑なので
 * 誰も気づかない。守り方そのものは1つにしておく。
 *
 * ## この走査が自分自身に課している条件
 *
 * 素朴に書くと肝心なところを見ない形をいくつも持っている。実際に踏んだので3つとも塞いである。
 * **緩めるときは、緩めた状態で実装を壊して落ちることを確かめること。**
 *
 * 1. **コメントを根拠にしない。** SQL コメントに絞り込みの名前が書いてあるだけで
 *    合格していた（#383 の実装中に踏んだ）。JS/SQL どちらのコメントも先に落とす
 * 2. **組み立てた SQL も見る。** 本体の取得は `` `${SELECT} WHERE …` `` の形で、
 *    リテラル自身は `FROM 表名` を持たない。素朴に走査すると**絞り込みを消しても
 *    緑のまま通る**。断片を展開してから判定する
 * 3. **正規表現でリテラルを切らない。** コメント中のバッククォート1個でその先の対応が
 *    ずれ、SQL を丸ごと取りこぼす。このリポジトリの注釈はバッククォートだらけなので、
 *    1文字ずつ走って「いまはコメントの中か」を持って歩くしかない
 */

/** 1つの文字列リテラル（ソース上の見た目のまま） */
export interface Literal {
  /** 中身（クォートを除いたソースの文字。`${…}` はそのまま残る） */
  body: string;
  /** `const NAME = <このリテラル>` の NAME。そうでなければ null */
  constName: string | null;
}

/** ソースを1文字ずつ走って、**コメントの外にある**文字列リテラルを切り出す */
export function literalsOf(src: string): Literal[] {
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
export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** `${NAME}` を、同じファイルの `const NAME = "…"` の中身で置き換える */
export function expand(body: string, byName: Map<string, string>): string {
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

export interface Statement {
  file: string;
  /** 展開済み・コメント除去済み（判定に使う） */
  sql: string;
  /** ソース上の見た目（報告に使う） */
  raw: string;
}

/**
 * `matches` に当たる SQL 文を全部集める。
 *
 * **他のリテラルに埋め込まれる断片は、埋め込んだ先で見るのでここでは数えない**
 * （同じ SQL を2回数えると、許可リストと実数の突き合わせがずれる）。
 *
 * @param needle そのファイルを読む価値があるかの粗いふるい（表名など）
 * @param matches 展開後の SQL がその表を読み書きしているかの判定
 */
export function scanStatements(
  sources: Record<string, string>,
  needle: string,
  matches: RegExp,
): Statement[] {
  const out: Statement[] = [];
  for (const [file, src] of Object.entries(sources)) {
    if (!src.includes(needle)) continue;
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
      if (!matches.test(sql)) continue;
      out.push({ file, sql, raw: l.body });
    }
  }
  return out;
}
