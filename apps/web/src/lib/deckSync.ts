import {
  DECK_ELEMENT_FIELDS,
  deckOpSchema,
  type DeckContent,
  type DeckElement,
  type DeckElementField,
  type DeckElementFields,
  type DeckHlc,
  type DeckOp,
  type DeckSlide,
} from "@eventer/shared";
import { comparePositioned } from "./deckPositions.js";

/**
 * チームのスライドの同時編集の「当て方」（docs/team-deck-live-sync.md §5・§7.4・§8）。
 *
 * 通信も暗号も画面も持たない純関数のまとまり。編集画面へのつなぎ込みは PR3。
 *
 * - 全ての状態は「欄 → (値, 印)」。印はハイブリッド論理時計 (t, c, clientId) で、全順序。
 *   当て方は「印が大きいほうを残す」だけなので、同じ op の集まりはどの順で当てても同じ中身になる
 * - 生存（足した・消した）も欄。消すと墓標が残り、後から来た古い更新では生き返らない
 * - 並びは保存される位置キー `pos` の欄（apps/web/src/lib/deckPositions.ts）
 * - 印はメモリだけ。読み込んだ中身は全て床の印（どの本物の印にも負ける）で始まる
 */

// ===== 時計 =====

/** 読み込んだ中身の印。どの本物の印にも負ける */
export const FLOOR: DeckHlc = Object.freeze({ t: 0, c: 0, clientId: "" });

export function compareHlc(a: DeckHlc, b: DeckHlc): number {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  if (a.c !== b.c) return a.c < b.c ? -1 : 1;
  return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
}

const isFloor = (m: DeckHlc) => compareHlc(m, FLOOR) === 0;

/** タブごとの時計。op ごとに tick し、受け取った・当てた印は observe する */
export interface DeckClock {
  readonly clientId: string;
  tick: () => DeckHlc;
  observe: (mark: DeckHlc) => void;
}

export function createDeckClock(clientId: string, now: () => number = Date.now): DeckClock {
  let t = 0;
  let c = 0;
  return {
    clientId,
    tick() {
      const wall = now();
      if (wall > t) {
        t = wall;
        c = 0;
      } else {
        c += 1;
      }
      return { t, c, clientId };
    },
    observe(mark) {
      if (mark.t > t || (mark.t === t && mark.c > c)) {
        t = mark.t;
        c = mark.c;
      }
    },
  };
}

// ===== 状態 =====

/** タイトルを含む「スライド1つ分」の中身 */
export interface DeckDoc {
  title: string;
  content: DeckContent;
}

interface Reg<T> {
  v: T;
  m: DeckHlc;
}

type FieldValue = DeckElement[DeckElementField] | null;

interface ElementRec {
  /** null: まだ足しても消してもいない（先に欄だけ届いた。§5.6 の保留） */
  alive: Reg<boolean> | null;
  /** 種類は el.add が決める（印の大きい el.add のもの） */
  type: Reg<DeckElement["type"]> | null;
  fields: Partial<Record<DeckElementField, Reg<FieldValue>>>;
  /** 保留を最初に受け取った時刻（期限切れの判定だけに使う） */
  seen: number;
}

interface SlideRec {
  alive: Reg<boolean> | null;
  background: Reg<string> | null;
  pos: Reg<string> | null;
  elements: Map<string, ElementRec>;
  seen: number;
}

export interface DeckSyncState {
  readonly title: Reg<string>;
  readonly slides: ReadonlyMap<string, SlideRec>;
  /** 当てた結果（画面に出す中身）。並びは pos（同じなら id）の順 */
  readonly content: DeckContent;
}

const reg = <T>(v: T, m: DeckHlc): Reg<T> => ({ v, m });

function elementRecOf(el: DeckElement): ElementRec {
  const fields: ElementRec["fields"] = {};
  for (const f of DECK_ELEMENT_FIELDS) fields[f] = reg((el[f] ?? null) as FieldValue, FLOOR);
  return { alive: reg(true, FLOOR), type: reg(el.type, FLOOR), fields, seen: 0 };
}

function slideRecOf(slide: DeckSlide): SlideRec {
  return {
    alive: reg(true, FLOOR),
    background: reg(slide.background, FLOOR),
    pos: reg(slide.pos ?? "", FLOOR),
    elements: new Map(slide.elements.map((e) => [e.id, elementRecOf(e)])),
    seen: 0,
  };
}

/**
 * 読み込んだ中身から状態を作る。全ての印は床の印。
 * 中身は `prepareLoadedContent` を通したもの（pos を持ち、pos 順に並んでいる）を渡す。
 * `content` は受け取ったオブジェクトをそのまま使う。
 */
export function loadDeckState(doc: DeckDoc): DeckSyncState {
  return {
    title: reg(doc.title, FLOOR),
    slides: new Map(doc.content.slides.map((s) => [s.id, slideRecOf(s)])),
    content: doc.content,
  };
}

export function stateDoc(state: DeckSyncState): DeckDoc {
  return { title: state.title.v, content: state.content };
}

// ===== 中身を組み立てる（変えなかったものは同じオブジェクトを使い回す） =====

function buildElement(id: string, rec: ElementRec): DeckElement | null {
  if (!rec.alive?.v || !rec.type) return null;
  const el: Record<string, unknown> = { id, type: rec.type.v };
  for (const f of DECK_ELEMENT_FIELDS) {
    const v = rec.fields[f]?.v;
    if (v !== null && v !== undefined) el[f] = v;
  }
  for (const f of ["x", "y", "w", "h"] as const) if (typeof el[f] !== "number") return null;
  return el as DeckElement;
}

function sameElement(a: DeckElement, b: DeckElement): boolean {
  if (a.id !== b.id || a.type !== b.type) return false;
  for (const f of DECK_ELEMENT_FIELDS) if ((a[f] ?? null) !== (b[f] ?? null)) return false;
  return true;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function buildSlide(id: string, rec: SlideRec, prev: DeckSlide | undefined): DeckSlide | null {
  if (!rec.alive?.v) return null;
  const prevEls = new Map((prev?.elements ?? []).map((e) => [e.id, e]));
  const elements: DeckElement[] = [];
  for (const [elId, er] of rec.elements) {
    const built = buildElement(elId, er);
    if (!built) continue;
    const old = prevEls.get(elId);
    elements.push(old && sameElement(old, built) ? old : built);
  }
  elements.sort(comparePositioned);
  const background = rec.background?.v ?? "#ffffff";
  const pos = rec.pos?.v || undefined;
  if (prev && prev.background === background && (prev.pos ?? undefined) === pos && sameList(prev.elements, elements)) {
    return prev;
  }
  const slide: DeckSlide = { id, background, elements };
  if (pos !== undefined) slide.pos = pos;
  return slide;
}

/** touched のページだけ組み直す。null なら全部 */
function rebuild(
  slides: ReadonlyMap<string, SlideRec>,
  prev: DeckContent,
  touched: ReadonlySet<string> | null,
): DeckContent {
  const prevById = new Map(prev.slides.map((s) => [s.id, s]));
  const out: DeckSlide[] = [];
  for (const [id, rec] of slides) {
    const old = prevById.get(id);
    if (touched && !touched.has(id)) {
      if (old) out.push(old);
      continue;
    }
    const built = buildSlide(id, rec, old);
    if (built) out.push(built);
  }
  out.sort(comparePositioned);
  return sameList(prev.slides, out) ? prev : { ...prev, slides: out };
}

// ===== 当てる =====

export interface ApplyResult {
  state: DeckSyncState;
  /**
   * 実際に当たった（印で勝った）ぶんだけにした op。Undo の履歴へ写すとき（`projectDeckOps`）に使う。
   * 負けた欄は含めない。生き返った・足されたページと要素は、当てた結果の値で持つ。
   */
  effective: DeckOp[];
}

const gt = (a: DeckHlc, b: DeckHlc | undefined) => b === undefined || compareHlc(a, b) > 0;

/** 印が新しいときだけ書く。書いたら true */
function setReg<T>(current: Reg<T> | null | undefined, v: T, m: DeckHlc, write: (r: Reg<T>) => void): boolean {
  if (current && !gt(m, current.m)) return false;
  write(reg(v, m));
  return true;
}

/**
 * op を当てる。純関数（渡した状態は書き換えない）。時計の observe は呼ぶ側が行う。
 * 同じ op を何度当てても、どの順で当てても同じ結果になる。
 * `now` は保留（先に欄だけ届いたもの）を受け取った時刻として記録するだけ。
 */
export function applyDeckOps(state: DeckSyncState, ops: readonly DeckOp[], now = 0): ApplyResult {
  let title = state.title;
  const slides = new Map(state.slides);
  const touched = new Set<string>();
  const effective: DeckOp[] = [];
  /** このバッチで複製したページ（同じページを何度も複製しない） */
  const ownSlides = new Set<string>();
  const ownElements = new Set<string>();

  const slideFor = (slideId: string): SlideRec => {
    let rec = slides.get(slideId);
    if (!rec) {
      rec = { alive: null, background: null, pos: null, elements: new Map(), seen: now };
      ownSlides.add(slideId);
    } else if (!ownSlides.has(slideId)) {
      rec = { ...rec, elements: new Map(rec.elements) };
      ownSlides.add(slideId);
    }
    slides.set(slideId, rec);
    touched.add(slideId);
    return rec;
  };
  const elementFor = (slide: SlideRec, slideId: string, elementId: string): ElementRec => {
    const key = `${slideId}\u0000${elementId}`;
    let rec = slide.elements.get(elementId);
    if (!rec) {
      rec = { alive: null, type: null, fields: {}, seen: now };
      ownElements.add(key);
    } else if (!ownElements.has(key)) {
      rec = { ...rec, fields: { ...rec.fields } };
      ownElements.add(key);
    }
    slide.elements.set(elementId, rec);
    return rec;
  };

  for (const op of ops) {
    switch (op.op) {
      case "title.set": {
        if (gt(op.hlc, title.m)) {
          title = reg(op.title, op.hlc);
          effective.push(op);
        }
        break;
      }
      case "slide.add":
      case "slide.remove":
      case "slide.set": {
        const rec = slideFor(op.slideId);
        if (op.op === "slide.remove") {
          if (setReg(rec.alive, false, op.hlc, (r) => (rec.alive = r))) effective.push(op);
          break;
        }
        if (op.op === "slide.add") {
          const revived = setReg(rec.alive, true, op.hlc, (r) => (rec.alive = r));
          setReg(rec.background, op.background, op.hlc, (r) => (rec.background = r));
          setReg(rec.pos, op.pos, op.hlc, (r) => (rec.pos = r));
          if (revived) {
            effective.push({
              op: "slide.add", hlc: op.hlc, slideId: op.slideId,
              pos: rec.pos!.v, background: rec.background!.v,
            });
          }
          break;
        }
        const won: { background?: string; pos?: string } = {};
        if (op.fields.background !== undefined && setReg(rec.background, op.fields.background, op.hlc, (r) => (rec.background = r))) {
          won.background = op.fields.background;
        }
        if (op.fields.pos !== undefined && setReg(rec.pos, op.fields.pos, op.hlc, (r) => (rec.pos = r))) {
          won.pos = op.fields.pos;
        }
        if (Object.keys(won).length > 0) effective.push({ ...op, fields: won });
        break;
      }
      case "el.add":
      case "el.remove":
      case "el.set": {
        const slide = slideFor(op.slideId);
        const elementId = op.op === "el.add" ? op.element.id : op.elementId;
        const rec = elementFor(slide, op.slideId, elementId);
        if (op.op === "el.remove") {
          if (setReg(rec.alive, false, op.hlc, (r) => (rec.alive = r))) effective.push(op);
          break;
        }
        if (op.op === "el.add") {
          const revived = setReg(rec.alive, true, op.hlc, (r) => (rec.alive = r));
          setReg(rec.type, op.element.type, op.hlc, (r) => (rec.type = r));
          for (const f of DECK_ELEMENT_FIELDS) {
            setReg(rec.fields[f], (op.element[f] ?? null) as FieldValue, op.hlc, (r) => (rec.fields[f] = r));
          }
          if (revived) {
            const live = buildElement(elementId, rec);
            if (live) effective.push({ op: "el.add", hlc: op.hlc, slideId: op.slideId, element: live as DeckElement & { pos: string } });
          }
          break;
        }
        const won: Record<string, unknown> = {};
        for (const [f, v] of Object.entries(op.fields) as [DeckElementField, FieldValue | undefined][]) {
          if (v === undefined) continue;
          if (setReg(rec.fields[f], v, op.hlc, (r) => (rec.fields[f] = r))) won[f] = v;
        }
        if (Object.keys(won).length > 0) effective.push({ ...op, fields: won as DeckElementFields });
        break;
      }
    }
  }

  const content = rebuild(slides, state.content, touched);
  return { state: { title, slides, content }, effective };
}

// ===== 保留の期限（§5.6） =====

/** 保留の上限（先に欄だけ届いて、まだ足されていない要素・ページの数） */
export const DECK_SYNC_PENDING_MAX = 500;
/** 保留の期限 */
export const DECK_SYNC_PENDING_TTL_MS = 30_000;

/**
 * 期限を過ぎた保留を捨てる。捨てたら `refetch: true`（HTTP の取り直しを1回予約する）。
 * 保留は画面に出ていないので、捨てても中身は変わらない。
 */
export function expirePendingRecords(state: DeckSyncState, now: number): { state: DeckSyncState; refetch: boolean } {
  type Item = { slideId: string; elementId: string | null; seen: number };
  const pending: Item[] = [];
  for (const [slideId, s] of state.slides) {
    if (s.alive === null) pending.push({ slideId, elementId: null, seen: s.seen });
    for (const [elementId, e] of s.elements) if (e.alive === null) pending.push({ slideId, elementId, seen: e.seen });
  }
  pending.sort((a, b) => b.seen - a.seen);
  const drop = pending.filter((p, i) => i >= DECK_SYNC_PENDING_MAX || now - p.seen > DECK_SYNC_PENDING_TTL_MS);
  if (drop.length === 0) return { state, refetch: false };
  const slides = new Map(state.slides);
  for (const d of drop) {
    const s = slides.get(d.slideId);
    if (!s) continue;
    if (d.elementId === null) {
      slides.delete(d.slideId);
      continue;
    }
    const elements = new Map(s.elements);
    elements.delete(d.elementId);
    slides.set(d.slideId, { ...s, elements });
  }
  return { state: { ...state, slides }, refetch: true };
}

// ===== 自分の変更を op にする =====

const valueOf = (el: DeckElement, f: DeckElementField): FieldValue => (el[f] ?? null) as FieldValue;
const REQUIRED_FIELDS = new Set<DeckElementField>(["x", "y", "w", "h", "rotation", "pos"]);

function needPos<T extends { id: string; pos?: string }>(item: T): string {
  if (!item.pos) throw new Error(`deck sync: ${item.id} has no pos (run withDeckPositions first)`);
  return item.pos;
}

/**
 * 前の中身から次の中身への変更を op にする。op ごとに時計を進める。
 * 次の中身のページと要素は、全て `pos` を持っていること（`withDeckPositions` を通したもの）。
 * タイトルは前後の空白を除いて比べる（保存と同じ。打っている途中の空白で op を出さない）。
 */
export function diffDeck(prev: DeckDoc, next: DeckDoc, clock: DeckClock): DeckOp[] {
  const ops: DeckOp[] = [];
  if (prev.title.trim() !== next.title.trim()) {
    ops.push({ op: "title.set", hlc: clock.tick(), title: next.title.trim() });
  }
  if (prev.content === next.content) return ops;
  const before = new Map(prev.content.slides.map((s) => [s.id, s]));
  const after = new Set(next.content.slides.map((s) => s.id));
  for (const slide of prev.content.slides) {
    if (!after.has(slide.id)) ops.push({ op: "slide.remove", hlc: clock.tick(), slideId: slide.id });
  }
  for (const slide of next.content.slides) {
    const old = before.get(slide.id);
    if (!old) {
      ops.push({ op: "slide.add", hlc: clock.tick(), slideId: slide.id, pos: needPos(slide), background: slide.background });
      for (const el of slide.elements) {
        ops.push({ op: "el.add", hlc: clock.tick(), slideId: slide.id, element: { ...el, pos: needPos(el) } });
      }
      continue;
    }
    if (old === slide) continue;
    const fields: { background?: string; pos?: string } = {};
    if (old.background !== slide.background) fields.background = slide.background;
    if ((old.pos ?? "") !== needPos(slide)) fields.pos = slide.pos;
    if (Object.keys(fields).length > 0) ops.push({ op: "slide.set", hlc: clock.tick(), slideId: slide.id, fields });
    if (old.elements === slide.elements) continue;
    const oldEls = new Map(old.elements.map((e) => [e.id, e]));
    const newIds = new Set(slide.elements.map((e) => e.id));
    for (const el of old.elements) {
      if (!newIds.has(el.id)) ops.push({ op: "el.remove", hlc: clock.tick(), slideId: slide.id, elementId: el.id });
    }
    for (const el of slide.elements) {
      const was = oldEls.get(el.id);
      if (was === el) continue;
      if (!was || was.type !== el.type) {
        if (was) ops.push({ op: "el.remove", hlc: clock.tick(), slideId: slide.id, elementId: el.id });
        ops.push({ op: "el.add", hlc: clock.tick(), slideId: slide.id, element: { ...el, pos: needPos(el) } });
        continue;
      }
      const changed: Record<string, FieldValue> = {};
      for (const f of DECK_ELEMENT_FIELDS) {
        const a = valueOf(was, f);
        const b = valueOf(el, f);
        if (a === b) continue;
        if (b === null && REQUIRED_FIELDS.has(f)) continue;
        changed[f] = b;
      }
      if (Object.keys(changed).length > 0) {
        ops.push({ op: "el.set", hlc: clock.tick(), slideId: slide.id, elementId: el.id, fields: changed as DeckElementFields });
      }
    }
  }
  return ops;
}

// ===== 印を見ない射影（Undo の履歴・当て直しの結果を写す） =====

function withField(el: DeckElement, f: DeckElementField, v: FieldValue): DeckElement {
  if ((el[f] ?? null) === v) return el;
  const next = { ...el } as Record<string, unknown>;
  if (v === null) delete next[f];
  else next[f] = v;
  return next as DeckElement;
}

/**
 * op を印を見ずに書く（§5.5）。Undo と Redo のスナップショットに、他人の変更を写すのに使う。
 * スナップショットに無い要素・ページへの書き換えは飛ばし、`el.add`・`slide.add` は差し込む。
 * 渡すのは `applyDeckOps` の `effective`（実際に当たったぶん）か、`deckDelta` の結果。
 * 変えなかったものは同じオブジェクトを使い回す。
 */
export function projectDeckOps(doc: DeckDoc, ops: readonly DeckOp[]): DeckDoc {
  let title = doc.title;
  let slides = doc.content.slides;
  const reorderSlides = { needed: false };
  const touchElements = new Set<string>();
  const editSlide = (slideId: string, fn: (s: DeckSlide) => DeckSlide) => {
    const i = slides.findIndex((s) => s.id === slideId);
    if (i < 0) return;
    const updated = fn(slides[i]);
    if (updated === slides[i]) return;
    slides = slides.map((s, j) => (j === i ? updated : s));
  };
  for (const op of ops) {
    switch (op.op) {
      case "title.set":
        title = op.title;
        break;
      case "slide.add": {
        const i = slides.findIndex((s) => s.id === op.slideId);
        if (i < 0) {
          slides = [...slides, { id: op.slideId, background: op.background, elements: [], pos: op.pos }];
          reorderSlides.needed = true;
        } else {
          editSlide(op.slideId, (s) => (s.background === op.background && s.pos === op.pos ? s : { ...s, background: op.background, pos: op.pos }));
          reorderSlides.needed = true;
        }
        break;
      }
      case "slide.remove":
        if (slides.some((s) => s.id === op.slideId)) slides = slides.filter((s) => s.id !== op.slideId);
        break;
      case "slide.set":
        editSlide(op.slideId, (s) => {
          const bg = op.fields.background ?? s.background;
          const pos = op.fields.pos ?? s.pos;
          return bg === s.background && pos === s.pos ? s : { ...s, background: bg, pos };
        });
        if (op.fields.pos !== undefined) reorderSlides.needed = true;
        break;
      case "el.add":
        editSlide(op.slideId, (s) => {
          const i = s.elements.findIndex((e) => e.id === op.element.id);
          const elements = i < 0 ? [...s.elements, op.element] : s.elements.map((e, j) => (j === i ? op.element : e));
          touchElements.add(op.slideId);
          return { ...s, elements };
        });
        break;
      case "el.remove":
        editSlide(op.slideId, (s) => (s.elements.some((e) => e.id === op.elementId) ? { ...s, elements: s.elements.filter((e) => e.id !== op.elementId) } : s));
        break;
      case "el.set":
        editSlide(op.slideId, (s) => {
          const i = s.elements.findIndex((e) => e.id === op.elementId);
          if (i < 0) return s;
          let el = s.elements[i];
          for (const [f, v] of Object.entries(op.fields) as [DeckElementField, FieldValue | undefined][]) {
            if (v !== undefined) el = withField(el, f, v);
          }
          if (el === s.elements[i]) return s;
          if (op.fields.pos !== undefined) touchElements.add(op.slideId);
          return { ...s, elements: s.elements.map((e, j) => (j === i ? el : e)) };
        });
        break;
    }
  }
  for (const slideId of touchElements) {
    editSlide(slideId, (s) => {
      const sorted = [...s.elements].sort(comparePositioned);
      return sameList(sorted, s.elements) ? s : { ...s, elements: sorted };
    });
  }
  if (reorderSlides.needed) {
    const sorted = [...slides].sort(comparePositioned);
    if (!sameList(sorted, slides)) slides = sorted;
  }
  const content = slides === doc.content.slides ? doc.content : { ...doc.content, slides };
  return title === doc.title && content === doc.content ? doc : { title, content };
}

/**
 * 前の中身から次の中身への変更を、印の無い op にする（§7.4 の当て直しの結果を Undo の履歴へ写すとき）。
 * 送らない・記録しない。印は全て床の印。
 */
export function deckDelta(prev: DeckDoc, next: DeckDoc): DeckOp[] {
  const floorClock: DeckClock = { clientId: "", tick: () => FLOOR, observe: () => undefined };
  return diffDeck(prev, next, floorClock);
}

// ===== 打っている文字欄の保留（§5.4） =====

/** いまフォーカスしている文字欄 */
export interface FocusedText {
  slideId: string;
  elementId: string;
}

/**
 * 届いた op のうち、自分がフォーカスしている文字欄の `text` だけを保留に分ける。
 * ほかの欄は当てる。保留したものは、フォーカスが外れたときに `applyDeckOps` で当てる
 * （印を比べるので、自分があとから打った文は残り、相手のほうが新しければ相手の文になる）。
 */
export function splitFocusedText(ops: readonly DeckOp[], focus: FocusedText | null): { apply: DeckOp[]; held: DeckOp[] } {
  if (!focus) return { apply: [...ops], held: [] };
  const apply: DeckOp[] = [];
  const held: DeckOp[] = [];
  for (const op of ops) {
    if (op.op !== "el.set" || op.slideId !== focus.slideId || op.elementId !== focus.elementId || op.fields.text === undefined) {
      apply.push(op);
      continue;
    }
    const { text, ...rest } = op.fields;
    held.push({ ...op, fields: { text } });
    if (Object.keys(rest).length > 0) apply.push({ ...op, fields: rest });
  }
  return { apply, held };
}

// ===== 取り直した中身と合わせる（§7.4） =====

/**
 * A. 途切れのあと: 取り直した中身が勝つ。自分の未保存の op（pending log）だけを当て直す。
 * `fetched` は `prepareLoadedContent` を通したもの。
 */
export function rebaseAfterGap(state: DeckSyncState, fetched: DeckDoc, pending: readonly DeckOp[]): DeckSyncState {
  const fresh = loadDeckState({ title: fetched.title, content: fetched.content });
  const merged = applyDeckOps(fresh, pending).state;
  return { ...merged, content: rebuild(merged.slides, state.content, null) };
}

function keepOrFetched<T>(local: Reg<T> | null, fetched: Reg<T> | null | undefined, absent: Reg<T> | null): Reg<T> | null {
  if (local && !isFloor(local.m)) return local;
  return fetched ?? absent ?? local;
}

/**
 * B. 途切れの無い 409: メモリ上の印と墓標は残す。床の印のままの欄だけ取り直した中身にし、
 * 自分の未保存の op を当て直す。取り直した中身に無いものは、床の印で「消えた」にする。
 */
export function rebaseOnConflict(state: DeckSyncState, fetched: DeckDoc, pending: readonly DeckOp[]): DeckSyncState {
  const remote = loadDeckState({ title: fetched.title, content: fetched.content });
  const dead = reg(false, FLOOR);
  const slides = new Map<string, SlideRec>();
  const ids = new Set([...state.slides.keys(), ...remote.slides.keys()]);
  for (const id of ids) {
    const local = state.slides.get(id);
    const far = remote.slides.get(id);
    if (!local) {
      slides.set(id, far!);
      continue;
    }
    const elements = new Map<string, ElementRec>();
    const elIds = new Set([...local.elements.keys(), ...(far?.elements.keys() ?? [])]);
    for (const elId of elIds) {
      const le = local.elements.get(elId);
      const fe = far?.elements.get(elId);
      if (!le) {
        elements.set(elId, fe!);
        continue;
      }
      const fields: ElementRec["fields"] = {};
      for (const f of DECK_ELEMENT_FIELDS) {
        const kept = keepOrFetched(le.fields[f] ?? null, fe?.fields[f], null);
        if (kept) fields[f] = kept;
      }
      elements.set(elId, {
        alive: keepOrFetched(le.alive, fe?.alive, dead),
        type: keepOrFetched(le.type, fe?.type, null),
        fields,
        seen: le.seen,
      });
    }
    slides.set(id, {
      alive: keepOrFetched(local.alive, far?.alive, dead),
      background: keepOrFetched(local.background, far?.background, null),
      pos: keepOrFetched(local.pos, far?.pos, null),
      elements,
      seen: local.seen,
    });
  }
  const title = isFloor(state.title.m) ? remote.title : state.title;
  const base: DeckSyncState = { title, slides, content: state.content };
  const merged = applyDeckOps({ ...base, content: rebuild(slides, state.content, null) }, pending).state;
  return merged;
}

// ===== 形の検証（§8） =====

/** 未来にこれ以上ずれた時計の op は捨てる */
export const DECK_SYNC_MAX_FUTURE_MS = 60_000;

/**
 * 届いた op の形だけを確かめる（手元の状態は見ない。見ると届いた順で結果が変わる）。
 * 通らないものは null。数の上限（ページ 300・要素 200）はここでは見ない（保存で弾かれる）。
 */
export function parseDeckOp(raw: unknown, now: number): DeckOp | null {
  const parsed = deckOpSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.hlc.t > now + DECK_SYNC_MAX_FUTURE_MS) return null;
  return parsed.data;
}
