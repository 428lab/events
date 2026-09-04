import type { DeckElement, DeckSlide } from "@eventer/shared";
import { uid } from "./editor/uid.js";

/**
 * スライドの中身をいじる操作。
 *
 * 画面から切り離した純粋な関数として置く。並べ替え・重なり順・グループ化は
 * 「見た目は同じでも中身の並びが違う」という壊れ方をするため、画面を描かずに
 * 確かめられる形にしておきたい。React にも MUI にも依存しない。
 *
 * 要素の配列は「後ろほど手前」。z 座標は持たず、並び順がそのまま重なり順。
 */

// ===== ページ（スライド） =====

/** 白紙のページ */
export function newSlide(): DeckSlide {
  return { id: uid(), background: "#ffffff", elements: [] };
}

/**
 * ページの写し。中の要素の id も振り直す。
 * 同じ id が2枚に跨って存在すると、選択や差し替えがもう一方にも及んでしまう。
 */
export function copySlide(slide: DeckSlide): DeckSlide {
  return {
    ...slide,
    id: uid(),
    elements: slide.elements.map((e) => ({ ...e, id: uid() })),
  };
}

/** i の直後に差し込む。差し込んだページの位置は i+1 */
export function insertSlideAfter(
  slides: DeckSlide[],
  i: number,
  slide: DeckSlide,
): DeckSlide[] {
  return [...slides.slice(0, i + 1), slide, ...slides.slice(i + 1)];
}

export function removeSlideAt(slides: DeckSlide[], i: number): DeckSlide[] {
  return slides.filter((_, j) => j !== i);
}

/** i と j を入れ替える。どちらも範囲内であること（呼ぶ側で確かめる） */
export function swapSlides(
  slides: DeckSlide[],
  i: number,
  j: number,
): DeckSlide[] {
  const a = [...slides];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

/** i 枚目そのものの設定（背景など）を差し替える */
export function patchSlide(
  slides: DeckSlide[],
  i: number,
  patch: Partial<DeckSlide>,
): DeckSlide[] {
  return slides.map((sl, j) => (j === i ? { ...sl, ...patch } : sl));
}

/** i 枚目の要素だけを差し替える。他のページはそのまま */
export function mapSlideElements(
  slides: DeckSlide[],
  i: number,
  fn: (els: DeckElement[]) => DeckElement[],
): DeckSlide[] {
  return slides.map((sl, j) =>
    j === i ? { ...sl, elements: fn(sl.elements) } : sl,
  );
}

// ===== 置いたばかりの要素 =====

/**
 * 新しいテキスト。中央寄りに置いて、すぐ掴める大きさにする。
 * 文言は保存されるデータなので訳さない（方針は #364 / #367）。
 */
export function newTextElement(): DeckElement {
  return {
    id: uid(),
    type: "text",
    x: 120,
    y: 200,
    w: 480,
    h: 100,
    rotation: 0,
    text: "テキスト",
    fontSize: 40,
    color: "#0f172a",
    align: "left",
  };
}

/** 上げ終わった画像。縦横比は中身に合わせて contain で収める */
export function newImageElement(src: string): DeckElement {
  return {
    id: uid(),
    type: "image",
    x: 200,
    y: 120,
    w: 400,
    h: 300,
    rotation: 0,
    src,
  };
}

// ===== 選択 =====

/** いま選ばれているもの */
export interface DeckSelection {
  /** 選択の記録 */
  ids: string[];
  /** そのうち今のページにある実体 */
  els: DeckElement[];
  /** 1つだけ選ばれているときの要素。プロパティ編集と変形ハンドルはこの時だけ出す */
  one: DeckElement | null;
}

export function readSelection(
  els: DeckElement[],
  ids: string[],
): DeckSelection {
  const set = new Set(ids);
  const selected = els.filter((e) => set.has(e.id));
  return {
    ids,
    els: selected,
    one: selected.length === 1 ? selected[0] : null,
  };
}

/**
 * その要素を選ぶときに一緒に選ばれる id。
 * グループの一員なら相方も含める（グループは丸ごと動かすもの）。
 */
export function expandGroup(els: DeckElement[], elId: string): string[] {
  const el = els.find((e) => e.id === elId);
  if (el?.groupId) {
    return els.filter((e) => e.groupId === el.groupId).map((e) => e.id);
  }
  return [elId];
}

/**
 * 追加選択したときの選択。
 * すでに members が全部入っていれば外す＝同じ操作で付け外しできる。
 */
export function toggleSelection(
  selected: string[],
  members: string[],
): string[] {
  const set = new Set(selected);
  const allIn = members.every((id) => set.has(id));
  members.forEach((id) => (allIn ? set.delete(id) : set.add(id)));
  return [...set];
}

// ===== 要素 =====

export function patchElement(
  els: DeckElement[],
  elId: string,
  patch: Partial<DeckElement>,
): DeckElement[] {
  return els.map((e) => (e.id === elId ? { ...e, ...patch } : e));
}

/** 1段だけ前後へ。隣と入れ替える。端なら何もしない */
export function moveElementZ(
  els: DeckElement[],
  elId: string,
  dir: 1 | -1,
): DeckElement[] {
  const a = [...els];
  const i = a.findIndex((e) => e.id === elId);
  const to = i + dir;
  if (i < 0 || to < 0 || to >= a.length) return els;
  [a[i], a[to]] = [a[to], a[i]];
  return a;
}

/** 選択を最前面へ。選択どうしの並びは保つ */
export function bringToFront(
  els: DeckElement[],
  ids: readonly string[],
): DeckElement[] {
  const set = new Set(ids);
  return [
    ...els.filter((e) => !set.has(e.id)),
    ...els.filter((e) => set.has(e.id)),
  ];
}

/** 選択を最背面へ。選択どうしの並びは保つ */
export function sendToBack(
  els: DeckElement[],
  ids: readonly string[],
): DeckElement[] {
  const set = new Set(ids);
  return [
    ...els.filter((e) => set.has(e.id)),
    ...els.filter((e) => !set.has(e.id)),
  ];
}

export function removeElements(
  els: DeckElement[],
  ids: readonly string[],
): DeckElement[] {
  const set = new Set(ids);
  return els.filter((e) => !set.has(e.id));
}

/** 選択をまとめて動かす */
export function nudgeElements(
  els: DeckElement[],
  ids: readonly string[],
  dx: number,
  dy: number,
): DeckElement[] {
  const set = new Set(ids);
  return els.map((e) =>
    set.has(e.id) ? { ...e, x: e.x + dx, y: e.y + dy } : e,
  );
}

/** つかんで動かし終えた位置をまとめて反映する */
export function applyPositions(
  els: DeckElement[],
  moves: readonly { id: string; x: number; y: number }[],
): DeckElement[] {
  const byId = new Map(moves.map((m) => [m.id, m] as const));
  return els.map((e) => {
    const m = byId.get(e.id);
    return m ? { ...e, x: m.x, y: m.y } : e;
  });
}

/**
 * 選択の写し。少しずらして重なりを分かるようにする。
 * 2つ以上なら写した側を新しいグループにする（元のグループと混ざらないように）。
 * 戻り値は写しだけ。並べるのは呼ぶ側。
 */
export function copyElements(
  els: DeckElement[],
  ids: readonly string[],
): DeckElement[] {
  const set = new Set(ids);
  const targets = els.filter((e) => set.has(e.id));
  const newGroupId = targets.length > 1 ? uid() : undefined;
  return targets.map((e) => ({
    ...e,
    id: uid(),
    x: e.x + 20,
    y: e.y + 20,
    groupId: newGroupId ?? e.groupId,
  }));
}

/** 選択を1つのグループにする */
export function groupElements(
  els: DeckElement[],
  ids: readonly string[],
): DeckElement[] {
  const set = new Set(ids);
  const gid = uid();
  return els.map((e) => (set.has(e.id) ? { ...e, groupId: gid } : e));
}

/** 選択のグループを外す */
export function ungroupElements(
  els: DeckElement[],
  ids: readonly string[],
): DeckElement[] {
  const set = new Set(ids);
  return els.map((e) => (set.has(e.id) ? { ...e, groupId: undefined } : e));
}

// ===== 画面から呼ぶ操作のまとまり =====

/** ページに対する操作。左の一覧が受け取る */
export interface DeckSlideCommands {
  add: () => void;
  duplicate: () => void;
  remove: () => void;
  /** -1 で前へ、1 で後ろへ */
  move: (d: number) => void;
}

/** 選択した要素に対する操作。キャンバスと右の設定欄が受け取る */
export interface DeckElementCommands {
  patch: (elId: string, patch: Partial<DeckElement>) => void;
  remove: () => void;
  duplicate: () => void;
  group: () => void;
  ungroup: () => void;
  toFront: () => void;
  toBack: () => void;
  moveZ: (elId: string, dir: 1 | -1) => void;
  nudge: (dx: number, dy: number) => void;
  /** つかんで動かし終えた位置。動いたものだけ渡る */
  moveTo: (moves: { id: string; x: number; y: number }[]) => void;
}
