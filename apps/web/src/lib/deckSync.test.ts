import { describe, expect, it } from "vitest";
import type { DeckContent, DeckElement, DeckHlc, DeckOp, DeckSlide } from "@eventer/shared";
import {
  FLOOR,
  applyDeckOps,
  compareHlc,
  createDeckClock,
  deckDelta,
  diffDeck,
  expirePendingRecords,
  loadDeckState,
  parseDeckOp,
  projectDeckOps,
  rebaseAfterGap,
  rebaseOnConflict,
  splitFocusedText,
  stateDoc,
  type DeckDoc,
  type DeckSyncState,
} from "./deckSync.js";
import { posBetween, prepareLoadedContent, withDeckPositions } from "./deckPositions.js";

/**
 * 同時編集の当て方（docs/team-deck-live-sync.md §5・§7.4・§8・§10 の PR1 の範囲）。
 * 通信・暗号・画面はまだ無い。タブは「状態＋時計」で模す。
 */

// ===== 道具 =====

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const text = (id: string, over: Partial<DeckElement> = {}): DeckElement => ({ id, type: "text", x: 0, y: 0, w: 100, h: 40, rotation: 0, text: id, ...over });
const page = (id: string, elements: DeckElement[] = []): DeckSlide => ({ id, background: "#ffffff", elements });
const doc = (slides: DeckSlide[], title = "発表"): DeckDoc => ({ title, content: prepareLoadedContent({ slides }) });

/** 手で書いた時計（同じ t を何度も使って、c と clientId の決着を試す） */
const hlc = (t: number, c = 0, clientId = "a"): DeckHlc => ({ t, c, clientId });

/** 画面の変更（配列を書き換えて pos を合わせる）を模す */
function edit(d: DeckDoc, fn: (slides: DeckSlide[]) => DeckSlide[]): DeckDoc {
  return { ...d, content: { ...d.content, slides: withDeckPositions(fn(d.content.slides)) } };
}

/** タブ: 状態と時計。自分の変更を op にして当て、送る */
class Tab {
  state: DeckSyncState;
  clock;
  log: DeckOp[] = [];
  constructor(start: DeckDoc, readonly id: string, now: () => number) {
    this.state = loadDeckState(start);
    this.clock = createDeckClock(id, now);
  }
  get doc() {
    return stateDoc(this.state);
  }
  /** 自分の操作。送る op を返す */
  change(fn: (slides: DeckSlide[]) => DeckSlide[]): DeckOp[] {
    const next = edit(this.doc, fn);
    const ops = diffDeck(this.doc, next, this.clock);
    this.state = applyDeckOps(this.state, ops).state;
    this.log.push(...ops);
    return ops;
  }
  receive(ops: readonly DeckOp[]) {
    for (const op of ops) this.clock.observe(op.hlc);
    this.state = applyDeckOps(this.state, ops).state;
  }
}

/** 中身を比べやすい形に（並び・欄の値） */
const shape = (c: DeckContent) => JSON.parse(JSON.stringify(c));

// ===== 時計 =====

describe("時計", () => {
  it("同じミリ秒の op も、op ごとに別の印になる。全順序で、clientId で必ず決まる", () => {
    const clock = createDeckClock("a", () => 1000);
    const marks = [clock.tick(), clock.tick(), clock.tick()];
    expect(marks.map((m) => m.c)).toEqual([0, 1, 2]);
    expect(compareHlc(hlc(5, 1, "a"), hlc(5, 1, "b"))).toBeLessThan(0);
    expect(compareHlc(hlc(5, 2, "a"), hlc(5, 1, "z"))).toBeGreaterThan(0);
    expect(compareHlc(FLOOR, hlc(0, 0, "a"))).toBeLessThan(0);
  });

  it("受け取った印より後の印を出す（壁時計が遅れていても）", () => {
    const clock = createDeckClock("a", () => 100);
    clock.observe(hlc(5000, 3, "b"));
    const next = clock.tick();
    expect(compareHlc(next, hlc(5000, 3, "b"))).toBeGreaterThan(0);
  });
});

// ===== diffDeck と applyDeckOps =====

describe("diffDeck → applyDeckOps", () => {
  it("往復すると元に戻り、変えなかった要素・ページは同じオブジェクトのまま", () => {
    const start = doc([page("s1", [text("a"), text("b")]), page("s2", [text("c")])]);
    const tab = new Tab(start, "a", () => 10);
    const next = edit(start, (slides) => [
      { ...slides[0], elements: [slides[0].elements[0], { ...slides[0].elements[1], x: 50, text: "変えた" }] },
      slides[1],
      page("s3", [text("d")]),
    ]);
    const ops = diffDeck(start, next, tab.clock);
    const applied = applyDeckOps(tab.state, ops).state.content;
    expect(shape(applied)).toEqual(shape(next.content));
    expect(applied.slides[1]).toBe(start.content.slides[1]);
    expect(applied.slides[0].elements[0]).toBe(start.content.slides[0].elements[0]);
  });

  it("当てた結果からもう一度差分を取っても op は出ない（受け取った変更を送り返さない）", () => {
    const start = doc([page("s1", [text("a")])]);
    const a = new Tab(start, "a", () => 10);
    const b = new Tab(start, "b", () => 10);
    const ops = a.change((s) => [{ ...s[0], elements: [{ ...s[0].elements[0], x: 99 }] }]);
    const before = b.doc;
    b.receive(ops);
    const next = b.doc;
    expect(next).not.toBe(before);
    // 画面は「当てた結果」を基準にするので、次の差分は空
    expect(diffDeck(next, next, b.clock)).toEqual([]);
    expect(diffDeck(next, stateDoc(applyDeckOps(b.state, ops).state), b.clock)).toEqual([]);
  });

  it("グループを外す（欄を消す）も op になり、相手でも外れる", () => {
    const start = doc([page("s1", [text("a", { groupId: "g" }), text("b", { groupId: "g" })])]);
    const a = new Tab(start, "a", () => 10);
    const b = new Tab(start, "b", () => 10);
    b.receive(a.change((s) => [{ ...s[0], elements: s[0].elements.map((e) => ({ ...e, groupId: undefined })) }]));
    expect(b.doc.content.slides[0].elements.every((e) => e.groupId === undefined)).toBe(true);
  });

  it("同じバッチで el.add のすぐ後に el.set（同じ要素）→ どのタブでも同じ結果", () => {
    const start = doc([page("s1")]);
    const a = new Tab(start, "a", () => 10);
    const add = a.change((s) => [{ ...s[0], elements: [text("n")] }]);
    const set = a.change((s) => [{ ...s[0], elements: [{ ...s[0].elements[0], text: "打った" }] }]);
    const b = new Tab(start, "b", () => 10);
    const c = new Tab(start, "c", () => 10);
    b.receive([...add, ...set]);
    c.receive([...set, ...add]);
    expect(shape(b.doc.content)).toEqual(shape(a.doc.content));
    expect(shape(c.doc.content)).toEqual(shape(a.doc.content));
    expect(a.doc.content.slides[0].elements[0].text).toBe("打った");
  });
});

// ===== 印の決着 =====

describe("あとから操作したほうが勝つ（欄ごと）", () => {
  const start = doc([page("s1", [text("a")])]);
  const base = () => loadDeckState(start);
  const pos = () => start.content.slides[0].elements[0].pos!;

  it("同じ欄・同じ t なら c、同じ c なら clientId で決まり、届く順に関係ない", () => {
    const ops: DeckOp[] = [
      { op: "el.set", hlc: hlc(10, 0, "a"), slideId: "s1", elementId: "a", fields: { x: 1 } },
      { op: "el.set", hlc: hlc(10, 1, "a"), slideId: "s1", elementId: "a", fields: { x: 2 } },
      { op: "el.set", hlc: hlc(10, 1, "b"), slideId: "s1", elementId: "a", fields: { x: 3 } },
    ];
    for (const order of [ops, [...ops].reverse(), [ops[1], ops[2], ops[0]]]) {
      expect(applyDeckOps(base(), order).state.content.slides[0].elements[0].x).toBe(3);
    }
  });

  it("別々の欄なら両方残る", () => {
    const r = applyDeckOps(base(), [
      { op: "el.set", hlc: hlc(10, 0, "a"), slideId: "s1", elementId: "a", fields: { x: 5 } },
      { op: "el.set", hlc: hlc(9, 0, "b"), slideId: "s1", elementId: "a", fields: { text: "べつ" } },
    ]).state.content.slides[0].elements[0];
    expect(r).toMatchObject({ x: 5, text: "べつ" });
  });

  it("消した要素は、古い印の更新では生き返らない（墓標）。墓標への el.set は当たっても見えない", () => {
    const removed = applyDeckOps(base(), [{ op: "el.remove", hlc: hlc(20), slideId: "s1", elementId: "a" }]).state;
    const after = applyDeckOps(removed, [{ op: "el.set", hlc: hlc(30, 0, "b"), slideId: "s1", elementId: "a", fields: { x: 9 } }]);
    expect(after.state.content.slides[0].elements).toEqual([]);
    const late = applyDeckOps(removed, [{ op: "el.add", hlc: hlc(10, 0, "b"), slideId: "s1", element: { ...text("a"), pos: pos() } }]);
    expect(late.state.content.slides[0].elements).toEqual([]);
    expect(late.effective).toEqual([]);
  });

  it("消すのと動かすのが同時でも、どの順で当てても同じ（消した印が新しければ消える）", () => {
    const ops: DeckOp[] = [
      { op: "el.remove", hlc: hlc(20, 0, "a"), slideId: "s1", elementId: "a" },
      { op: "el.set", hlc: hlc(19, 0, "b"), slideId: "s1", elementId: "a", fields: { pos: posBetween(pos(), null)! } },
    ];
    expect(applyDeckOps(base(), ops).state.content.slides[0].elements).toEqual([]);
    expect(applyDeckOps(base(), [...ops].reverse()).state.content.slides[0].elements).toEqual([]);
  });

  it("消してから足し直した要素は、遅れて届いた古い削除では消えない", () => {
    const readd = applyDeckOps(base(), [
      { op: "el.remove", hlc: hlc(10), slideId: "s1", elementId: "a" },
      { op: "el.add", hlc: hlc(30, 0, "b"), slideId: "s1", element: { ...text("a"), pos: pos() } },
    ]).state;
    const late = applyDeckOps(readd, [{ op: "el.remove", hlc: hlc(20), slideId: "s1", elementId: "a" }]);
    expect(late.state.content.slides[0].elements.map((e) => e.id)).toEqual(["a"]);
    expect(late.effective).toEqual([]);
  });

  it("同じ op を何度当てても変わらない（リプレイ）", () => {
    const op: DeckOp = { op: "el.set", hlc: hlc(10), slideId: "s1", elementId: "a", fields: { x: 7 } };
    const once = applyDeckOps(base(), [op]).state;
    const twice = applyDeckOps(once, [op, op]);
    expect(twice.state.content).toBe(once.content);
    expect(twice.effective).toEqual([]);
  });

  it("ページを全部消し合うと 0 枚になる（画面が「ページ追加」で戻す。PR3）", () => {
    const r = applyDeckOps(base(), [{ op: "slide.remove", hlc: hlc(10), slideId: "s1" }]);
    expect(r.state.content.slides).toEqual([]);
  });
});

// ===== 収束（性質テスト） =====

/** ランダムな操作を1つ（数の上限はローカルで守る） */
function randomEdit(rand: () => number, slides: DeckSlide[], next: () => string): DeckSlide[] {
  const s = slides.map((p) => ({ ...p, elements: [...p.elements] }));
  const r = rand();
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  if (s.length === 0 || r < 0.08) {
    const at = Math.floor(rand() * (s.length + 1));
    s.splice(at, 0, page(next(), [text(next())]));
    return s;
  }
  const p = Math.floor(rand() * s.length);
  if (r < 0.13 && s.length > 1) {
    s.splice(p, 1);
    return s;
  }
  if (r < 0.2 && s.length > 1) {
    const [x] = s.splice(p, 1);
    s.splice(Math.floor(rand() * (s.length + 1)), 0, x);
    return s;
  }
  if (r < 0.25) {
    s[p] = { ...s[p], background: pick(["#ffffff", "#000000", "#ff0000"]) };
    return s;
  }
  const els = s[p].elements;
  if (els.length === 0 || r < 0.4) {
    els.splice(Math.floor(rand() * (els.length + 1)), 0, text(next(), { x: Math.floor(rand() * 900) }));
    return s;
  }
  const e = Math.floor(rand() * els.length);
  if (r < 0.5) {
    els.splice(e, 1);
  } else if (r < 0.62) {
    const [x] = els.splice(e, 1);
    els.splice(Math.floor(rand() * (els.length + 1)), 0, x);
  } else if (r < 0.72) {
    els[e] = { ...els[e], groupId: rand() < 0.5 ? undefined : pick(["g1", "g2"]) };
  } else if (r < 0.86) {
    els[e] = { ...els[e], text: `t${Math.floor(rand() * 100)}` };
  } else {
    els[e] = { ...els[e], x: Math.floor(rand() * 900), y: Math.floor(rand() * 500) };
  }
  return s;
}

/** 重複・抜けのあとに再送、をまぜた届け方 */
function deliveries(rand: () => number, ops: DeckOp[]): DeckOp[] {
  const out: DeckOp[] = [];
  for (const op of ops) {
    out.push(op);
    if (rand() < 0.1) out.push(op);
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("収束（数百通り）", () => {
  it("3つのタブが同時に編集し、どの順・重複で受け取っても同じ中身になる", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = seeded(seed);
      let counter = 0;
      const next = () => `${seed}-${counter++}`;
      let now = 1000;
      const clockNow = () => now;
      const start = doc([page("s1", [text("a"), text("b")]), page("s2", [text("c")])]);
      const tabs = ["a", "b", "c"].map((id) => new Tab(start, id, clockNow));
      // 2〜4 回、各タブがばらばらに編集し、そのつど一部だけ交換する
      const sent: DeckOp[][] = [[], [], []];
      for (let round = 0; round < 4; round++) {
        for (let i = 0; i < tabs.length; i++) {
          const steps = 1 + Math.floor(rand() * 3);
          for (let k = 0; k < steps; k++) {
            if (rand() < 0.3) now += Math.floor(rand() * 3);
            sent[i].push(...tabs[i].change((s) => randomEdit(rand, s, next)));
          }
        }
        // 部分的な交換（届いたものだけ当てる）
        for (let i = 0; i < tabs.length; i++) {
          for (let j = 0; j < tabs.length; j++) {
            if (i === j || rand() < 0.4) continue;
            tabs[j].receive(deliveries(rand, sent[i].slice(0, Math.floor(rand() * (sent[i].length + 1)))));
          }
        }
      }
      // 最後に全部を（ばらばらの順・重複で）受け取る
      for (let i = 0; i < tabs.length; i++) {
        for (let j = 0; j < tabs.length; j++) if (i !== j) tabs[j].receive(deliveries(rand, sent[i]));
      }
      const [a, b, c] = tabs.map((t) => shape(t.doc.content));
      expect(b, `seed ${seed}`).toEqual(a);
      expect(c, `seed ${seed}`).toEqual(a);
    }
  });

  it("読み込んだ版が違うタブ（rev 3 と rev 5）でも、それぞれ間に差し込んだ並びが同じになる", () => {
    const now = () => 100;
    const v3 = doc([page("s1", [text("a"), text("b"), text("c")])]);
    const writer = new Tab(v3, "w", now);
    const later = writer.change((s) => [{ ...s[0], elements: [s[0].elements[0], text("d"), ...s[0].elements.slice(1)] }]);
    // rev 5 は保存された中身（pos 付き）を読み込む
    const v5: DeckDoc = { title: v3.title, content: prepareLoadedContent(JSON.parse(JSON.stringify(writer.doc.content))) };
    const old = new Tab(v3, "x", now);
    const fresh = new Tab(v5, "y", now);
    const fromOld = old.change((s) => [{ ...s[0], elements: [s[0].elements[0], s[0].elements[1], text("e"), s[0].elements[2]] }]);
    const fromFresh = fresh.change((s) => [{ ...s[0], elements: [text("f"), ...s[0].elements] }]);
    old.receive([...later, ...fromFresh]);
    fresh.receive(fromOld);
    writer.receive([...fromOld, ...fromFresh]);
    const order = (t: Tab) => t.doc.content.slides[0].elements.map((e) => e.id);
    expect(order(old)).toEqual(order(writer));
    expect(order(fresh)).toEqual(order(writer));
    expect(order(writer)).toEqual(["f", "a", "d", "b", "e", "c"]);
  });

  it("同時の並べ替え・差し込み・削除でも同じ中身になる", () => {
    const now = () => 100;
    const start = doc([page("s1", [text("a"), text("b"), text("c"), text("d")])]);
    const x = new Tab(start, "x", now);
    const y = new Tab(start, "y", now);
    const z = new Tab(start, "z", now);
    const ox = x.change((s) => [{ ...s[0], elements: [s[0].elements[3], ...s[0].elements.slice(0, 3)] }]); // d を最背面へ
    const oy = y.change((s) => [{ ...s[0], elements: [s[0].elements[0], text("n"), ...s[0].elements.slice(1)] }]); // a と b の間へ
    const oz = z.change((s) => [{ ...s[0], elements: s[0].elements.filter((e) => e.id !== "b") }]); // b を消す
    x.receive([...oz, ...oy]);
    y.receive([...ox, ...oz]);
    z.receive([...oy, ...ox]);
    expect(shape(y.doc.content)).toEqual(shape(x.doc.content));
    expect(shape(z.doc.content)).toEqual(shape(x.doc.content));
    expect(x.doc.content.slides[0].elements.map((e) => e.id)).toEqual(["d", "a", "n", "c"]);
  });
});

// ===== 保留（先に欄だけ届いた） =====

describe("保留", () => {
  it("el.add より先に届いた el.set は画面に出さず、el.add が来たら当たる", () => {
    const state = loadDeckState(doc([page("s1")]));
    const set: DeckOp = { op: "el.set", hlc: hlc(20), slideId: "s1", elementId: "n", fields: { x: 77 } };
    const add: DeckOp = { op: "el.add", hlc: hlc(10), slideId: "s1", element: { ...text("n"), pos: "V" } };
    const first = applyDeckOps(state, [set], 1000).state;
    expect(first.content.slides[0].elements).toEqual([]);
    expect(applyDeckOps(first, [add]).state.content.slides[0].elements[0].x).toBe(77);
  });

  it("30 秒たった保留は捨てて、取り直しを1回予約する", () => {
    const state = applyDeckOps(loadDeckState(doc([page("s1")])), [
      { op: "el.set", hlc: hlc(20), slideId: "s1", elementId: "n", fields: { x: 1 } },
    ], 1000).state;
    expect(expirePendingRecords(state, 20_000).refetch).toBe(false);
    const expired = expirePendingRecords(state, 32_000);
    expect(expired.refetch).toBe(true);
    expect(expired.state.slides.get("s1")!.elements.has("n")).toBe(false);
  });
});

// ===== Undo の写し =====

describe("印を見ない射影（Undo）", () => {
  it("A が x を変え、B が y を変え、A が Undo → y は残る", () => {
    const now = () => 100;
    const start = doc([page("s1", [text("x"), text("y")])]);
    const a = new Tab(start, "a", now);
    const b = new Tab(start, "b", now);
    // A の Undo の履歴: 変更前のスナップショット
    let undoStack: DeckDoc[] = [a.doc];
    const ax = a.change((s) => [{ ...s[0], elements: [{ ...s[0].elements[0], x: 11 }, s[0].elements[1]] }]);
    const by = b.change((s) => [{ ...s[0], elements: [s[0].elements[0], { ...s[0].elements[1], x: 22 }] }]);
    b.receive(ax);
    // A が B の変更を受け取る: 実際に当たったぶんを、履歴のスナップショットにも写す
    const result = applyDeckOps(a.state, by);
    a.state = result.state;
    undoStack = undoStack.map((snap) => projectDeckOps(snap, result.effective));
    // A が Undo: スナップショットへ戻し、その差分を自分の op として送る
    const restored = undoStack.pop()!;
    const undoOps = diffDeck(a.doc, restored, a.clock);
    a.state = applyDeckOps(a.state, undoOps).state;
    b.receive(undoOps);
    const xy = (t: Tab) => t.doc.content.slides[0].elements.map((e) => e.x);
    expect(xy(a)).toEqual([0, 22]);
    expect(xy(b)).toEqual([0, 22]);
  });

  it("負けた op は写さない（印で負けた変更を Undo の履歴に入れない）", () => {
    const start = doc([page("s1", [text("x")])]);
    const won = applyDeckOps(loadDeckState(start), [{ op: "el.set", hlc: hlc(50), slideId: "s1", elementId: "x", fields: { x: 5 } }]).state;
    const lost = applyDeckOps(won, [{ op: "el.set", hlc: hlc(40, 0, "b"), slideId: "s1", elementId: "x", fields: { x: 9 } }]);
    expect(lost.effective).toEqual([]);
    expect(projectDeckOps(start, lost.effective)).toBe(start);
  });

  it("スナップショットに無い要素への書き換えは飛ばし、足された要素は差し込む", () => {
    const snap = doc([page("s1", [text("x")])]);
    const projected = projectDeckOps(snap, [
      { op: "el.set", hlc: FLOOR, slideId: "s1", elementId: "ghost", fields: { x: 3 } },
      { op: "el.add", hlc: FLOOR, slideId: "s1", element: { ...text("n"), pos: posBetween(null, snap.content.slides[0].elements[0].pos!)! } },
    ]);
    expect(projected.content.slides[0].elements.map((e) => e.id)).toEqual(["n", "x"]);
  });

  it("当て直しの結果は、差分（印なし）にして写すと同じ中身になる", () => {
    const before = doc([page("s1", [text("x"), text("y")])]);
    const after = edit(before, (s) => [{ ...s[0], elements: [{ ...s[0].elements[1], text: "取り直した" }] }, page("s2")]);
    const delta = deckDelta(before, after);
    expect(delta.every((op) => compareHlc(op.hlc, FLOOR) === 0)).toBe(true);
    expect(shape(projectDeckOps(before, delta).content)).toEqual(shape(after.content));
  });
});

// ===== 取り直した中身と合わせる（§7.4） =====

describe("取り直し・当て直し", () => {
  const start = doc([page("s1", [text("f"), text("g")])]);

  it("B（途切れの無い 409）: 受け取っていた他人の op も、自分の未保存の op も残る", () => {
    const now = () => 100;
    const me = new Tab(start, "me", now);
    const other = new Tab(start, "other", now);
    me.receive(other.change((s) => [{ ...s[0], elements: [{ ...s[0].elements[0], x: 1 }, s[0].elements[1]] }]));
    const mine = me.change((s) => [{ ...s[0], elements: [s[0].elements[0], { ...s[0].elements[1], text: "未保存" }] }]);
    // サーバーには他人の保存が入っていて、f の x はまだ古い（相手は保存前）
    const fetched = edit(start, (s) => [{ ...s[0], elements: [s[0].elements[0], { ...s[0].elements[1], y: 300 }] }]);
    const merged = stateDoc(rebaseOnConflict(me.state, fetched, mine)).content.slides[0].elements;
    expect(merged[0].x).toBe(1); // 受け取っていた他人の op
    expect(merged[1].text).toBe("未保存"); // 自分の未保存
    expect(merged[1].y).toBe(300); // 床の印のままだった欄は、取り直した中身
  });

  it("A（途切れのあと）: 自分の pending log 以外は取り直した中身になる", () => {
    const now = () => 100;
    const me = new Tab(start, "me", now);
    const other = new Tab(start, "other", now);
    me.receive(other.change((s) => [{ ...s[0], elements: [{ ...s[0].elements[0], x: 1 }, s[0].elements[1]] }]));
    const mine = me.change((s) => [{ ...s[0], elements: [s[0].elements[0], { ...s[0].elements[1], text: "未保存" }] }]);
    // 途切れのあいだに別の人が f の x を 2 にして保存した
    const fetched = edit(start, (s) => [{ ...s[0], elements: [{ ...s[0].elements[0], x: 2 }, s[0].elements[1]] }]);
    const merged = stateDoc(rebaseAfterGap(me.state, fetched, mine)).content.slides[0].elements;
    expect(merged[0].x).toBe(2);
    expect(merged[1].text).toBe("未保存");
  });

  it("B: 手元で消した要素は、取り直した中身にあっても墓標が勝つ。取り直した中身に無いものは消える", () => {
    const now = () => 100;
    const me = new Tab(start, "me", now);
    me.change((s) => [{ ...s[0], elements: [s[0].elements[1]] }]); // f を消す（保存前）
    const fetched = edit(start, (s) => [{ ...s[0], elements: [s[0].elements[0]] }]); // g はほかの人が消して保存済み
    const ids = stateDoc(rebaseOnConflict(me.state, fetched, me.log)).content.slides[0].elements.map((e) => e.id);
    expect(ids).toEqual([]);
  });

  it("合わせた結果を基準にすると、差分から op が出ない（受け取った変更の経路）", () => {
    const now = () => 100;
    const me = new Tab(start, "me", now);
    const mine = me.change((s) => [{ ...s[0], elements: [{ ...s[0].elements[0], text: "自分" }, s[0].elements[1]] }]);
    const fetched = edit(start, (s) => [{ ...s[0], background: "#000000" }]);
    const merged = stateDoc(rebaseOnConflict(me.state, fetched, mine));
    expect(diffDeck(merged, merged, me.clock)).toEqual([]);
    expect(merged.content.slides[0].background).toBe("#000000");
  });
});

// ===== 打っている文字欄 =====

describe("フォーカス中の文字欄の保留（§5.4）", () => {
  it("打っている欄の text だけを保留し、ほかの欄は当てる。フォーカスが外れたら印で比べて当てる", () => {
    const start = doc([page("s1", [text("a")])]);
    const incoming: DeckOp[] = [{ op: "el.set", hlc: hlc(30, 0, "b"), slideId: "s1", elementId: "a", fields: { text: "相手", x: 5 } }];
    const { apply, held } = splitFocusedText(incoming, { slideId: "s1", elementId: "a" });
    const state = applyDeckOps(loadDeckState(start), apply).state;
    expect(state.content.slides[0].elements[0]).toMatchObject({ x: 5, text: "a" });
    // 自分は相手よりあとに打った
    const typed = applyDeckOps(state, [{ op: "el.set", hlc: hlc(40, 0, "a"), slideId: "s1", elementId: "a", fields: { text: "自分" } }]).state;
    expect(applyDeckOps(typed, held).state.content.slides[0].elements[0].text).toBe("自分");
    // 自分のほうが古ければ相手の文が残る（同じ欄を同時に打ったら、あとの人の文）
    const older = applyDeckOps(state, [{ op: "el.set", hlc: hlc(20, 0, "a"), slideId: "s1", elementId: "a", fields: { text: "自分" } }]).state;
    expect(applyDeckOps(older, held).state.content.slides[0].elements[0].text).toBe("相手");
  });
});

// ===== 形の検証（§8） =====

describe("op の形の検証", () => {
  const now = 1_000_000;
  const ok: DeckOp = { op: "el.set", hlc: hlc(now), slideId: "s1", elementId: "a", fields: { x: 1 } };

  it("正しい形は通る", () => {
    expect(parseDeckOp(ok, now)).toEqual(ok);
    expect(parseDeckOp({ op: "el.add", hlc: hlc(now), slideId: "s1", element: { ...text("a"), pos: "V" } }, now)).not.toBeNull();
  });

  it("id や種類を変える el.set、知らない欄、長すぎる文字、不正な pos は弾く", () => {
    for (const fields of [{ id: "b" }, { type: "image" }, { unknown: 1 }, { text: "x".repeat(10001) }, { pos: "a-b" }, { pos: "a".repeat(33) }]) {
      expect(parseDeckOp({ ...ok, fields }, now)).toBeNull();
    }
  });

  it("pos の無い el.add・長すぎる id・背景・タイトル、知らない op は弾く", () => {
    expect(parseDeckOp({ op: "el.add", hlc: hlc(now), slideId: "s1", element: text("a") }, now)).toBeNull();
    expect(parseDeckOp({ ...ok, slideId: "s".repeat(65) }, now)).toBeNull();
    expect(parseDeckOp({ op: "slide.set", hlc: hlc(now), slideId: "s1", fields: { background: "#".repeat(51) } }, now)).toBeNull();
    expect(parseDeckOp({ op: "title.set", hlc: hlc(now), title: "t".repeat(121) }, now)).toBeNull();
    expect(parseDeckOp({ op: "deck.drop", hlc: hlc(now) }, now)).toBeNull();
  });

  it("60 秒より先の未来の時計は弾く", () => {
    expect(parseDeckOp({ ...ok, hlc: hlc(now + 60_001) }, now)).toBeNull();
    expect(parseDeckOp({ ...ok, hlc: hlc(now + 60_000) }, now)).not.toBeNull();
  });

  it("数の上限は届いた op では見ない（201 個目の要素も当たる。保存で弾かれる）", () => {
    const many = Array.from({ length: 200 }, (_, i) => text(`e${i}`));
    const state = loadDeckState(doc([page("s1", many)]));
    const op = parseDeckOp({ op: "el.add", hlc: hlc(now), slideId: "s1", element: { ...text("extra"), pos: "zz" } }, now)!;
    expect(applyDeckOps(state, [op]).state.content.slides[0].elements).toHaveLength(201);
  });
});
