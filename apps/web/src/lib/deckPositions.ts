import { DECK_POS_MAX_LENGTH, type DeckContent, type DeckSlide } from "@eventer/shared";

/**
 * スライドの並びを表す位置キー `pos`（docs/team-deck-live-sync.md §5.2）。
 *
 * ページの並びと、ページの中の要素の並び（重なり順）は、配列の順番とは別に
 * **分数の位置キー**を持つ。並べ替えは「動かしたものの `pos` を書き換える」だけになるので、
 * 同時に編集しているタブどうしで並びを欄の上書きとして合わせられる（同期は PR3 から）。
 *
 * キーは `0-9A-Za-z` の文字列で、文字コード順（ASCII 順）に比べる。値は「0.キー」という
 * 62 進の小数と考えると、どの2つのキーの間にも新しいキーを作れる。
 * 末尾が `0` のキーは作らない（作ると、その直前に入るキーが作れなくなる）。
 *
 * 守ること:
 * - **保存する中身は、配列の順と `pos` の順が一致している。** 編集画面はどの操作のあとも
 *   `withDeckPositions` を通す（配列の順が操作の意図なので、食い違ったら動いたほうの `pos` を振る）。
 *   保存の直前にも同じ関数を通す（最後の守り）。なので公開ビューアは配列の順を見るだけでよい
 * - **読み込んだときは `pos` が正。** `prepareLoadedContent` は `pos` の無いものにだけ振り、`pos` 順に並べる。
 *   取り直しのたびに全部を振り直すと、読み込んだ版が違うタブで同じ id のキーがずれる
 * - React にも MUI にも依存しない純関数（配信セット編集とは共有しない。配信セットには `pos` が無い）
 */

/** キーの長さの上限（`deckPosSchema` と同じ） */
const POS_MAX_LENGTH = DECK_POS_MAX_LENGTH;

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const POS_RE = /^[0-9A-Za-z]{1,32}$/;

export function isDeckPos(value: unknown): value is string {
  return typeof value === "string" && POS_RE.test(value);
}

/** 位置キーどうしの比較（文字コード順）。同じなら id で決める */
export function comparePositioned(
  a: { id: string; pos?: string },
  b: { id: string; pos?: string },
): number {
  const pa = a.pos ?? "";
  const pb = b.pos ?? "";
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * lo と hi の間に入るキー。lo が null なら先頭、hi が null なら末尾。
 * 間に入るキーが作れない（hi が lo の後ろに `0` を足しただけ、など）ときは null。
 * 長さの上限は見ない（呼ぶ側が見て、超えたら並び全体を振り直す）。
 */
export function posBetween(lo: string | null, hi: string | null): string | null {
  const a = lo ?? "";
  if (hi !== null && !(a < hi)) return null;
  return midpoint(a, hi);
}

function midpoint(a: string, b: string | null): string | null {
  // 共通の頭を飛ばす。a は足りない桁を 0 とみなす
  let n = 0;
  if (b !== null) {
    while (n < b.length && (a[n] ?? "0") === b[n]) n++;
    // b が「a の後ろに 0 を足しただけ」なら、間は空
    if (n === b.length) return null;
  }
  const prefix = b === null ? "" : b.slice(0, n);
  const da = n < a.length ? DIGITS.indexOf(a[n]) : 0;
  const db = b === null ? DIGITS.length : DIGITS.indexOf(b[n]);
  if (db - da > 1) return prefix + DIGITS[Math.floor((da + db + 1) / 2)];
  // 隣り合う桁。b にまだ続きがあれば、b をそこで切ったものが間に入る
  if (b !== null && b.length > n + 1) return prefix + b[n];
  const rest = midpoint(a.slice(n + 1), null);
  return rest === null ? null : prefix + DIGITS[da] + rest;
}

/** lo と hi の間に count 個のキーを、偏らないように振る。作れなければ null */
function spread(lo: string | null, hi: string | null, count: number): string[] | null {
  if (count === 0) return [];
  const middle = Math.floor(count / 2);
  const key = posBetween(lo, hi);
  if (key === null || key.length > POS_MAX_LENGTH) return null;
  const left = spread(lo, key, middle);
  const right = spread(key, hi, count - middle - 1);
  if (!left || !right) return null;
  return [...left, key, ...right];
}

/** 並び全体を振り直す。300 個でもキーは数文字で収まる */
function spreadAll(count: number): string[] {
  const keys = spread(null, null, count);
  if (!keys) throw new Error("deck positions: cannot spread keys");
  return keys;
}

function withPos<T extends { pos?: string }>(item: T, pos: string): T {
  return item.pos === pos ? item : { ...item, pos };
}

/**
 * 配列の順を正として、`pos` の順を合わせる（編集のあと・保存の直前）。
 *
 * 配列の順で `pos` が増えていく最長の並び（最長増加部分列）はそのまま残し、
 * それ以外（動かしたもの・新しく足したもの・写しで同じキーを持ったもの）にだけ
 * 前後のキーの間のキーを振る。なので、1つ動かしたら書き換わる `pos` は1つだけ。
 * 何も変えなかったら、受け取った配列そのものを返す（同一性を保つ）。
 * 最長が複数あるときは、配列の前にあるほうを残す（写しより元のほうを残す）。
 */
export function placeInArrayOrder<T extends { id: string; pos?: string }>(items: readonly T[]): T[] {
  const n = items.length;
  const valid = items.map((item) => isDeckPos(item.pos));
  const length = new Array<number>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);
  let best = -1;
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    length[i] = 1;
    for (let j = 0; j < i; j++) {
      if (valid[j] && items[j].pos! < items[i].pos! && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1;
        parent[i] = j;
      }
    }
    if (best < 0 || length[i] > length[best]) best = i;
  }
  const keep = new Set<number>();
  for (let i = best; i >= 0; i = parent[i]) keep.add(i);
  if (keep.size === n) return items as T[];

  const out = [...items];
  let lo: string | null = null;
  let i = 0;
  while (i < n) {
    if (keep.has(i)) {
      lo = items[i].pos!;
      i++;
      continue;
    }
    let k = i;
    while (k < n && !keep.has(k)) k++;
    const hi = k < n ? items[k].pos! : null;
    const keys = spread(lo, hi, k - i);
    if (!keys) {
      // 間に入るキーが作れない（保存済みのキーが末尾 0 で詰まっている等）。並び全体を振り直す
      const all = spreadAll(n);
      return items.map((item, j) => withPos(item, all[j]));
    }
    for (let j = i; j < k; j++) out[j] = withPos(items[j], keys[j - i]);
    lo = keys[keys.length - 1];
    i = k;
  }
  return out;
}

/** ページの並びと、各ページの要素の並びの `pos` を、配列の順に合わせる。変えなければ同じ配列を返す */
export function withDeckPositions(slides: readonly DeckSlide[]): DeckSlide[] {
  let changed = false;
  const inner = slides.map((slide) => {
    const elements = placeInArrayOrder(slide.elements);
    if (elements === slide.elements) return slide;
    changed = true;
    return { ...slide, elements };
  });
  const placed = placeInArrayOrder(inner);
  if (placed !== inner) changed = true;
  return changed ? placed : (slides as DeckSlide[]);
}

/**
 * `pos` を持たないものにだけ、配列の前後から決まるキーを振る（読み込み時）。
 * すでに持っているキーは変えない。前後のキーの間に作れないときだけ、並び全体を振り直す。
 */
function assignMissing<T extends { id: string; pos?: string }>(items: readonly T[]): T[] {
  if (items.every((item) => isDeckPos(item.pos))) return items as T[];
  const out = [...items];
  let lo: string | null = null;
  let i = 0;
  while (i < items.length) {
    if (isDeckPos(items[i].pos)) {
      lo = items[i].pos!;
      i++;
      continue;
    }
    let k = i;
    while (k < items.length && !isDeckPos(items[k].pos)) k++;
    // 上の境は、lo より大きい最初のキー（食い違って並んでいる保存済みのキーは飛ばす）
    let hi: string | null = null;
    for (let j = k; j < items.length; j++) {
      const p = items[j].pos;
      if (isDeckPos(p) && (lo === null || p > lo)) {
        hi = p;
        break;
      }
    }
    const keys = spread(lo, hi, k - i);
    if (!keys) {
      const all = spreadAll(items.length);
      return items.map((item, j) => withPos(item, all[j]));
    }
    for (let j = i; j < k; j++) out[j] = withPos(items[j], keys[j - i]);
    lo = keys[keys.length - 1];
    i = k;
  }
  return out;
}

function sortedByPos<T extends { id: string; pos?: string }>(items: readonly T[]): T[] {
  for (let i = 1; i < items.length; i++) {
    if (comparePositioned(items[i - 1], items[i]) > 0) return [...items].sort(comparePositioned);
  }
  return items as T[];
}

/**
 * 読み込んだ中身を編集できる形にする: `pos` の無いページ・要素にだけ配列の順から振り、
 * `pos`（同じなら id）の順に並べる。何も変えなければ同じオブジェクトを返す。
 * 既存のデッキ（`pos` 導入前・取り込み・AI が書いたもの）は、ここで初めて `pos` を持つ。
 */
export function prepareLoadedContent(content: DeckContent): DeckContent {
  let changed = false;
  const inner = content.slides.map((slide) => {
    const elements = sortedByPos(assignMissing(slide.elements));
    if (elements === slide.elements) return slide;
    changed = true;
    return { ...slide, elements };
  });
  const slides = sortedByPos(assignMissing(inner));
  if (slides !== inner) changed = true;
  return changed ? { ...content, slides } : content;
}
