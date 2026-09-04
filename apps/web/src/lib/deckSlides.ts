import type { DeckElement, DeckSlide } from "@eventer/shared";
import { copyByIds } from "./editor/collection.js";
import { uid } from "./editor/uid.js";

/**
 * スライド **固有** の操作。
 *
 * 画面から切り離した純粋な関数として置く。グループ化は「見た目は同じでも中身が
 * 違う」という壊れ方をするため、画面を描かずに確かめられる形にしておきたい。
 * React にも MUI にも依存しない。
 *
 * 差し込む・入れ替える・重なり順・まとめて動かす、といった型を見ない式は
 * 配信セット編集と共通なので `editor/collection.ts` にある。ここには置かない。
 */

// ===== ページ（スライド） =====

/** 白紙のページ */
export function newSlide(): DeckSlide {
  return { id: uid(), background: "#ffffff", elements: [] };
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

/**
 * 選択の写し。ずらす量と id の振り直しは共通の `copyByIds` に任せ、
 * ここは **2つ以上なら写した側を新しいグループにする** ぶんだけを足す
 * （元のグループと混ざると、片方を動かしたときにもう片方まで付いてくる）。
 * 戻り値は写しだけ。並べるのは呼ぶ側。
 */
export function copyElements(
  els: DeckElement[],
  ids: readonly string[],
): DeckElement[] {
  const copies = copyByIds(els, ids);
  if (copies.length < 2) return copies;
  const newGroupId = uid();
  return copies.map((e) => ({ ...e, groupId: newGroupId }));
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
