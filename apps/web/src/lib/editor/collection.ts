import { uid } from "./uid.js";

/**
 * 編集画面が扱う「並び」の操作。
 *
 * スライド編集も配信セット編集も、中身は
 * 「ページの並び」と「そのページが持つ要素の並び」という同じ形をしている。
 * 差し込む・入れ替える・重なり順を変える・まとめて動かす、といった式は
 * 編集対象の型を一切見ずに書けるので、ここに 1 つだけ置く。
 * 型ごとに書き直すと、同じ操作なのに画面によって挙動が違うという壊れ方をする。
 *
 * 要素の配列は **後ろほど手前**。z 座標は持たず、並び順がそのまま重なり順。
 */

/** 並びの中で自分を名指しできるもの。ここが id を見る唯一の前提 */
export interface Identified {
  id: string;
}

/** 置き場所を持つもの。動かす式だけがこれを要求する */
export interface Positioned extends Identified {
  x: number;
  y: number;
}

/** 要素の並びを持つページ。ページ単位の式だけがこれを要求する */
export interface HasElements extends Identified {
  elements: Identified[];
}

/** 写しをずらす量。重なって見分けが付かなくなるのを防ぐ */
export const DUPLICATE_OFFSET = 20;

// ===== ページの並び =====

/** i の直後に差し込む。差し込んだものの位置は i+1 */
export function insertAfter<T>(list: readonly T[], i: number, item: T): T[] {
  return [...list.slice(0, i + 1), item, ...list.slice(i + 1)];
}

export function removeAt<T>(list: readonly T[], i: number): T[] {
  return list.filter((_, j) => j !== i);
}

/** i と j を入れ替える。どちらも範囲内であること（呼ぶ側で確かめる） */
export function swapAt<T>(list: readonly T[], i: number, j: number): T[] {
  const a = [...list];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

/** i 番目そのものの設定を差し替える */
export function patchAt<T>(
  list: readonly T[],
  i: number,
  patch: Partial<T>,
): T[] {
  return list.map((item, j) => (j === i ? { ...item, ...patch } : item));
}

/** i 番目の要素の並びだけを差し替える。他のページはそのまま */
export function mapElementsAt<P extends HasElements>(
  pages: readonly P[],
  i: number,
  fn: (els: P["elements"]) => P["elements"],
): P[] {
  return pages.map((p, j) => (j === i ? { ...p, elements: fn(p.elements) } : p));
}

/**
 * ページの写し。**中の要素の id も振り直す。**
 * 同じ id が 2 ページに跨って存在すると、選択や差し替えがもう一方にも及ぶ。
 */
export function copyPage<P extends HasElements>(page: P): P {
  return {
    ...page,
    id: uid(),
    elements: page.elements.map((e) => ({ ...e, id: uid() })),
  };
}

// ===== 要素の並び =====

export function patchById<T extends Identified>(
  items: readonly T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/**
 * 1 段だけ前後へ。隣と入れ替える。
 * 端まで来ているときと、居ない要素を指したときは**入力をそのまま返す**
 * （ここだけ新しい配列を返すと、呼ぶ側が同一性で「変わっていない」を
 * 見分けられなくなる。中身は書き換えないので共有して構わない）。
 */
export function moveZ<T extends Identified>(
  items: readonly T[],
  id: string,
  dir: 1 | -1,
): T[] {
  const i = items.findIndex((e) => e.id === id);
  const to = i + dir;
  if (i < 0 || to < 0 || to >= items.length) return items as T[];
  const a = [...items];
  [a[i], a[to]] = [a[to], a[i]];
  return a;
}

/** 指定を最前面へ。指定どうしの並びは保つ */
export function toFront<T extends Identified>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const set = new Set(ids);
  return [
    ...items.filter((e) => !set.has(e.id)),
    ...items.filter((e) => set.has(e.id)),
  ];
}

/** 指定を最背面へ。指定どうしの並びは保つ */
export function toBack<T extends Identified>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const set = new Set(ids);
  return [
    ...items.filter((e) => set.has(e.id)),
    ...items.filter((e) => !set.has(e.id)),
  ];
}

export function removeByIds<T extends Identified>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const set = new Set(ids);
  return items.filter((e) => !set.has(e.id));
}

/** 指定をまとめて動かす（矢印キーなど、相対の移動） */
export function nudgeByIds<T extends Positioned>(
  items: readonly T[],
  ids: readonly string[],
  dx: number,
  dy: number,
): T[] {
  const set = new Set(ids);
  return items.map((e) =>
    set.has(e.id) ? { ...e, x: e.x + dx, y: e.y + dy } : e,
  );
}

/** つかんで動かし終えた位置をまとめて反映する（絶対の位置） */
export function applyPositions<T extends Positioned>(
  items: readonly T[],
  moves: readonly { id: string; x: number; y: number }[],
): T[] {
  const byId = new Map(moves.map((m) => [m.id, m] as const));
  return items.map((e) => {
    const m = byId.get(e.id);
    return m ? { ...e, x: m.x, y: m.y } : e;
  });
}

/**
 * 指定の写し。少しずらして重なりが分かるようにする。
 * 戻り値は写しだけ。並べるのは呼ぶ側（元の並びのどこへ置くかは画面が決める）。
 */
export function copyByIds<T extends Positioned>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const set = new Set(ids);
  return items
    .filter((e) => set.has(e.id))
    .map((e) => ({
      ...e,
      id: uid(),
      x: e.x + DUPLICATE_OFFSET,
      y: e.y + DUPLICATE_OFFSET,
    }));
}
