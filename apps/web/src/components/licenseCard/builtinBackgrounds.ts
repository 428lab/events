/** 名札（イベントカード）のビルトイン背景。
 *
 * ライセンスカードの地紋（CardDecor の rosette / topo / arcs / flow）と同じ作り方をする:
 * 紙幣・旅券の地紋のように、数式で生成した細い連続線を何百本も重ねて模様を織る。
 * 塗りつぶしの面は使わず、地は白。線は地へ寄せた淡い不透明色（半透明は重ねると濁るので使わない）。
 * 模様は名前の下も含めてカード全面に敷き、文字は線の淡さで読ませる
 * （legibleStroke が、どの文字色とも WCAG 4.5:1 以上になるまで線の色を地へ寄せる）。
 *
 * 配色はライセンスカードの CARD_THEMES（accentA / accentB / accentBLight）をそのまま使うので、
 * 名札とライセンスカードが同じ製品の色に揃う。
 *
 * 長いパスデータは持たず、描くたびにコードで生成する（同じ背景は毎回同じ絵）。
 * 描画結果は React に依存しない要素木（BgNode）。React では BuiltinBackgroundLayer で
 * 要素に起こし、書き出しや検査では builtinBackgroundMarkup で文字列にする。 */
import { CARD_THEMES, type CardThemeKey } from "./cardTheme.js";

const W = 1074;
const H = 650;
const TAU = Math.PI * 2;

export type BgTag = "g" | "rect" | "path";
export interface BgNode { tag: BgTag; attrs: Record<string, string | number>; children?: BgNode[] }

export interface BuiltinBackgroundPalette {
  key: string;
  nameJa: string;
  nameEn: string;
  /** 地の色。名札データの background.color にもこの値を入れる。インク節約のため白だけ */
  base: string;
  /** 模様の線の色（CARD_THEMES の accentA / accentB / accentBLight）。実際の線はこれを地へ寄せた淡い色で引く */
  colors: readonly string[];
  /** 名前など主役の文字色 */
  ink: string;
  /** コミュニティ名・ハンドル・枠名などの補助の文字色 */
  inkSub: string;
  /** 見出し・帯の色 */
  accent: string;
  /** 帯の上の文字色 */
  onAccent: string;
}
export interface BuiltinBackground {
  key: string;
  nameJa: string;
  nameEn: string;
  palettes: readonly BuiltinBackgroundPalette[];
  draw: (palette: BuiltinBackgroundPalette, idPrefix: string) => BgNode[];
}

type Pt = readonly [number, number];
const el = (tag: BgTag, attrs: BgNode["attrs"], children?: BgNode[]): BgNode =>
  children ? { tag, attrs, children } : { tag, attrs };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 再現性のある乱数（同じ背景は毎回同じ絵になる） */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 2色を混ぜる。半透明を重ねずに済むので、重なりが濁らず印刷も安定する */
export function mixColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i]! - v) * clamp01(t)).toString(16).padStart(2, "0")).join("");
}
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
/** 模様の線と文字の色の差の下限（WCAG）。線は不透明なので重なっても暗くならない */
export const TEXT_ON_PATTERN_CONTRAST = 4.6;
/** 線の色を、配色のどの文字色（ink / inkSub / accent）とも TEXT_ON_PATTERN_CONTRAST 以上の差が出るまで地へ寄せる */
export function legibleStroke(p: BuiltinBackgroundPalette, color: string): string {
  const floor = TEXT_ON_PATTERN_CONTRAST * (Math.max(...[p.ink, p.inkSub, p.accent].map(luminance)) + 0.05) - 0.05;
  if (luminance(color) >= floor) return color;
  let lo = 0, hi = 1; // 地へ寄せる割合を二分探索
  for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (luminance(mixColor(color, p.base, m)) >= floor) hi = m; else lo = m; }
  return mixColor(color, p.base, hi);
}
function withLegibleStrokes(p: BuiltinBackgroundPalette, nodes: BgNode[]): BgNode[] {
  return nodes.map(n => {
    const stroke = n.attrs.stroke;
    const attrs = typeof stroke === "string" && stroke.startsWith("#") ? { ...n.attrs, stroke: legibleStroke(p, stroke) } : n.attrs;
    return n.children ? { tag: n.tag, attrs, children: withLegibleStrokes(p, n.children) } : { tag: n.tag, attrs };
  });
}

/** 線の束。同じ色・同じ太さの線は1本の <path>（複数の M）にまとめ、要素の数を抑える。
 * カードの外（余白 PAD より外）に出た部分は捨て、そこで線を切る */
const PAD = 6;
const inside = (x: number, y: number) => x >= -PAD && x <= W + PAD && y >= -PAD && y <= H + PAD;
const fmt = (v: number) => String(Math.round(v * 10) / 10);
class Strokes {
  private groups = new Map<string, string[]>();
  add(color: string, width: number, points: readonly Pt[]) {
    const key = `${color}|${width}`;
    let parts = this.groups.get(key);
    if (!parts) this.groups.set(key, parts = []);
    let run: string[] = [];
    let prev: Pt | undefined, prevIn = false;
    const flush = () => { if (run.length > 1) parts.push("M" + run.join(" ")); run = []; };
    for (const pt of points) {
      const isIn = inside(pt[0], pt[1]);
      if (isIn || prevIn) {
        if (!run.length && prev && !prevIn) run.push(`${fmt(prev[0])},${fmt(prev[1])}`);
        run.push(`${fmt(pt[0])},${fmt(pt[1])}`);
      }
      if (!isIn && prevIn) flush();
      prev = pt; prevIn = isIn;
    }
    flush();
  }
  nodes(): BgNode[] {
    return [...this.groups].map(([key, parts]) => {
      const [stroke, width] = key.split("|");
      return el("path", { d: parts.join(""), stroke: stroke!, "stroke-width": Number(width) });
    });
  }
}
/** t を [t0, t1] で n 等分して曲線を点列にする */
function sample(n: number, t0: number, t1: number, f: (t: number) => Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(f(t0 + (t1 - t0) * (i / n)));
  return out;
}
const polar = (cx: number, cy: number, r: number, a: number): Pt => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
/** 地の白と、線の束をまとめる <g> */
const frame = (p: BuiltinBackgroundPalette, s: Strokes): BgNode[] => [
  el("rect", { x: 0, y: 0, width: W, height: H, fill: p.base }),
  el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, s.nodes()),
];
/** 配色の i 番目の色を地へ t だけ寄せた線の色 */
const tint = (p: BuiltinBackgroundPalette, i: number, t: number) => mixColor(p.base, p.colors[i % p.colors.length]!, t);

/** 1. ロゼット: 何十周も巻く閉じた回転曲線（r = R + Σ A sin(kθ)）を同心の帯に重ねた、紙幣の地紋の花形。
 * 右寄りの中心に大きな花、左下にもう一つ小さな花。花のない所は、ゆるく波打つ横の細線が全面を流れて地をつくる */
function drawRosette(p: BuiltinBackgroundPalette): BgNode[] {
  const s = new Strokes();
  // 地の流線: 全面に横へ流れる細い波線。振幅が横へゆっくり変わり、光の筋のように疎密ができる
  for (let i = 0; i < 46; i++) {
    const y0 = -20 + i * 15.2;
    s.add(tint(p, 0, 0.22), 0.5, sample(180, -10, W + 10, x =>
      [x, y0 + 7 * Math.sin(x / 61 + i * 0.36) * (0.55 + 0.45 * Math.sin(x / 230 - i * 0.11))]));
  }
  // 花: 中心 (cx, cy) のまわりに、内から外へ帯を重ねる。各帯は閉じた1本の長い曲線を少しずつ回した複製
  const rosette = (cx: number, cy: number, scale: number, colorShift: number) => {
    const bands: { r: number; a: number; k: number; b: number; m: number; turns: number; copies: number; c: number; t: number; w: number }[] = [
      { r: 64, a: 22, k: 7.5, b: 8, m: 30.5, turns: 2, copies: 4, c: 1, t: 0.42, w: 0.5 },
      { r: 128, a: 34, k: 12.25, b: 9, m: 48.25, turns: 4, copies: 3, c: 0, t: 0.36, w: 0.5 },
      { r: 210, a: 38, k: 18.5, b: 10, m: 74.5, turns: 2, copies: 5, c: 1, t: 0.36, w: 0.5 },
      { r: 292, a: 30, k: 24.25, b: 14, m: 6.25, turns: 4, copies: 3, c: 0, t: 0.32, w: 0.5 },
      { r: 360, a: 20, k: 36, b: 8, m: 96, turns: 1, copies: 7, c: 2, t: 0.45, w: 0.45 },
    ];
    for (const [bi, band] of bands.entries()) {
      for (let j = 0; j < band.copies; j++) {
        const rot = (j / band.copies) * (TAU / band.k);
        const n = Math.ceil(band.r * scale * band.turns * TAU / 3 + band.m * band.turns * 6);
        s.add(tint(p, band.c + colorShift, band.t), band.w, sample(n, 0, TAU * band.turns, th => {
          const r = scale * (band.r + band.a * Math.sin(band.k * th + rot * band.k) + band.b * Math.sin(band.m * th + rot * 3));
          return polar(cx, cy, r, th + rot * 0.15 + bi * 0.07);
        }));
      }
    }
    // 花の芯の細かい同心円の輪
    for (let k = 0; k < 7; k++) s.add(tint(p, colorShift, 0.38), 0.45, sample(160, 0, TAU, th =>
      polar(cx, cy, scale * (18 + k * 5.5 + 2.4 * Math.sin(16 * th + k)), th)));
  };
  rosette(828, 318, 1, 0);
  rosette(118, 610, 0.62, 1);
  return frame(p, s);
}

/** 2. 干渉線（モアレ）: 横に流れるほぼ平行な波線の組と、カードの外（右上）に中心を持つ同心円の組を、
 * ほぼ同じ間隔で重ねる。2組の位相のずれが、線そのものにはない大きな双曲線の縞（モアレ）を全面に浮かばせる */
function drawMoire(p: BuiltinBackgroundPalette): BgNode[] {
  const s = new Strokes();
  for (let i = 0; i < 112; i++) {
    const y0 = -24 + i * 6.2;
    s.add(tint(p, 0, 0.38), 0.5, sample(120, -10, W + 10, x => [x, y0 + 9 * Math.sin(x / 210 + i * 0.012)]));
  }
  const cx = 1380, cy = -260;
  const near = Math.hypot(cx - W, cy) - 20, far = Math.hypot(cx, cy - H) + 20;
  for (let r = Math.floor(near / 6.8) * 6.8; r < far; r += 6.8) {
    s.add(tint(p, 1, 0.38), 0.5, sample(Math.ceil(r * 1.1 / 3), Math.PI * 0.5, Math.PI * 1.1, th => polar(cx, cy, r, th)));
  }
  return frame(p, s);
}

/** なめらかな乱数場（勾配ノイズの fBm）。等高線の地形に使う */
function fbm(seed: number) {
  const rand = rng(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j]!, perm[i]!]; }
  const grads = perm.map(() => { const a = rand() * TAU; return [Math.cos(a), Math.sin(a)] as const; });
  const hash = (i: number, j: number) => perm[(perm[i & 255]! + j) & 255]!;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const dot = (di: number, dj: number) => { const g = grads[hash(i + di, j + dj)]!; return g[0] * (fx - di) + g[1] * (fy - dj); };
    const u = fade(fx), v = fade(fy);
    const a = dot(0, 0) + (dot(1, 0) - dot(0, 0)) * u, b = dot(0, 1) + (dot(1, 1) - dot(0, 1)) * u;
    return a + (b - a) * v;
  };
  return (x: number, y: number) => {
    let sum = 0, amp = 1, freq = 1;
    for (let o = 0; o < 3; o++) { sum += amp * noise(x * freq + o * 17.3, y * freq - o * 9.1); amp *= 0.42; freq *= 2.03; }
    return sum;
  };
}
/** 格子上の値の等値線（マーチングスクエア）。線分を端点でつないで連続した折れ線にして返す */
function contours(field: (x: number, y: number) => number, cell: number, level: number, values: Float64Array, nx: number, ny: number): Pt[][] {
  const v = (i: number, j: number) => values[j * (nx + 1) + i]!;
  // 辺の id: 横の辺 (i,j)-(i+1,j) は 2*(j*(nx+1)+i)、縦の辺 (i,j)-(i,j+1) は 2*(j*(nx+1)+i)+1
  const edgePoint = new Map<number, Pt>();
  const point = (id: number): Pt => {
    let pt = edgePoint.get(id);
    if (pt) return pt;
    const k = id >> 1, i = k % (nx + 1), j = Math.floor(k / (nx + 1));
    const [i2, j2] = id & 1 ? [i, j + 1] : [i + 1, j];
    const a = v(i, j), b = v(i2, j2), t = (level - a) / (b - a);
    pt = [(i + (i2 - i) * t) * cell - PAD, (j + (j2 - j) * t) * cell - PAD];
    edgePoint.set(id, pt);
    return pt;
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
    const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const top = 2 * (j * (nx + 1) + i), bottom = 2 * ((j + 1) * (nx + 1) + i);
    const left = 2 * (j * (nx + 1) + i) + 1, right = 2 * (j * (nx + 1) + i + 1) + 1;
    const center = field(((i + 0.5) * cell) - PAD, ((j + 0.5) * cell) - PAD) > level;
    switch (code) {
      case 1: case 14: link(top, left); break;
      case 2: case 13: link(top, right); break;
      case 3: case 12: link(left, right); break;
      case 4: case 11: link(right, bottom); break;
      case 6: case 9: link(top, bottom); break;
      case 7: case 8: link(left, bottom); break;
      case 5: if (center) { link(top, right); link(left, bottom); } else { link(top, left); link(right, bottom); } break;
      case 10: if (center) { link(top, left); link(right, bottom); } else { link(top, right); link(left, bottom); } break;
    }
  }
  const lines: Pt[][] = [];
  const take = (a: number) => { const n = links.get(a); const b = n?.pop(); if (b !== undefined) { const m = links.get(b)!; m.splice(m.indexOf(a), 1); } return b; };
  // 端（つながりが1つ）から先に辿り、残った輪を最後に辿る
  const starts = [...links.keys()].sort((a, b) => (links.get(a)!.length === 1 ? 0 : 1) - (links.get(b)!.length === 1 ? 0 : 1));
  for (const start of starts) {
    while (links.get(start)!.length) {
      const ids = [start];
      for (let cur: number | undefined = take(start); cur !== undefined; cur = take(cur)) ids.push(cur);
      lines.push(ids.map(point));
    }
  }
  return lines;
}
/** 3. 等高線: なめらかな乱数場の地形を細い等高線で刻み、5本ごとに太い計曲線を入れる。
 * 斜面の急な所ほど線が詰まり、地図のような奥行きが出る */
function drawContours(p: BuiltinBackgroundPalette): BgNode[] {
  const s = new Strokes();
  const noise = fbm(7);
  const field = (x: number, y: number) => noise(x / 640, y / 640) + 0.5 * (x / W) - 0.3 * (y / H);
  const cell = 6, nx = Math.ceil((W + 2 * PAD) / cell), ny = Math.ceil((H + 2 * PAD) / cell);
  const values = new Float64Array((nx + 1) * (ny + 1));
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const val = field(i * cell - PAD, j * cell - PAD);
    values[j * (nx + 1) + i] = val; lo = Math.min(lo, val); hi = Math.max(hi, val);
  }
  const stepSize = 0.0135;
  for (let k = Math.ceil(lo / stepSize); k * stepSize < hi; k++) {
    const index = k % 5 === 0;
    for (const line of contours(field, cell, k * stepSize + 1e-6, values, nx, ny))
      s.add(index ? tint(p, 0, 0.5) : tint(p, 1, 0.34), index ? 0.95 : 0.5, line);
  }
  return frame(p, s);
}

/** 4. リボン: 平行な正弦の細線を数十本ずつ束ね、位相をずらしてねじれた帯にする。
 * 帯の中心・幅・ねじれがゆっくり変わるので、光沢のあるリボンが全面を横切って見える */
function drawRibbons(p: BuiltinBackgroundPalette): BgNode[] {
  const s = new Strokes();
  const ribbons = [
    { y: 150, amp: 70, fy: 1 / 260, py: 0.4, width: 78, fw: 1 / 190, twist: 1 / 150, n: 34, c: 0, t: 0.4 },
    { y: 360, amp: 95, fy: 1 / 310, py: 2.2, width: 96, fw: 1 / 230, twist: -1 / 175, n: 40, c: 1, t: 0.38 },
    { y: 560, amp: 60, fy: 1 / 240, py: 4.1, width: 70, fw: 1 / 170, twist: 1 / 135, n: 30, c: 0, t: 0.36 },
  ];
  // 地: 全面にごく淡い細い横線を引き、帯の外もうっすら刷る
  for (let i = 0; i < 66; i++) s.add(tint(p, 2, 0.2), 0.45, sample(60, -10, W + 10, x => [x, i * 10 + 3 * Math.sin(x / 90 + i * 0.5)]));
  for (const r of ribbons) {
    for (let i = 0; i < r.n; i++) {
      const phase = (i / r.n) * Math.PI;
      s.add(tint(p, r.c, r.t * (0.7 + 0.3 * Math.sin(phase))), 0.55, sample(220, -10, W + 10, x => {
        const center = r.y + r.amp * Math.sin(x * r.fy + r.py);
        const half = r.width * (0.6 + 0.4 * Math.sin(x * r.fw + r.py * 1.7));
        return [x, center + half * Math.cos(phase + x * r.twist)];
      }));
    }
  }
  return frame(p, s);
}

/** 5. 旋盤彫り: カードの外（左下）の中心から、波打つ同心の輪を何百本も広げる。
 * 輪ごとに波の位相を少しずつ進め、8本ごとに進む向きを反転させるので、
 * 懐中時計の文字盤のような麦粒（バーレーコーン）の山形の目が全面に立つ */
function drawEngineTurned(p: BuiltinBackgroundPalette): BgNode[] {
  const s = new Strokes();
  const cx = -150, cy = 820;
  const far = Math.hypot(W - cx, cy) + 10;
  const a0 = -Math.PI / 2 - 0.1, a1 = 0.06; // カードに掛かる角度の範囲
  const gap = 7.5, wave = 22, group = 8;
  for (let k = 0, r0 = 180; r0 < far; k++, r0 += gap) {
    const lobes = Math.round(r0 / (wave / TAU) / 2) * 2; // 輪のどこでも波長がほぼ同じ
    const g = Math.floor(k / group), inG = k % group;
    const phase = (g % 2 ? group - inG : inG) * (Math.PI / group);
    const c = g % 3 === 2 ? 1 : 0;
    s.add(tint(p, c, c ? 0.4 : 0.34), 0.5, sample(Math.ceil(r0 * (a1 - a0) / 2.5), a0, a1, th =>
      polar(cx, cy, r0 + 3.4 * Math.sin(lobes * th + phase), th)));
  }
  return frame(p, s);
}

/** 6. セキュリティメッシュ: 斜めに走る2組の波線を交差させた網目（旅券の地紋）を全面に張り、
 * 縁には位相をずらした正弦の細線を束ねたギョーシェの枠を巡らせる */
function drawMesh(p: BuiltinBackgroundPalette): BgNode[] {
  const s = new Strokes();
  const ang = 0.5, gap = 13, amp = 5.5, wl = 46;
  for (const sign of [1, -1]) {
    const ux = Math.cos(ang), uy = sign * Math.sin(ang); // 線の向き
    const vx = -uy, vy = ux; // 線の並ぶ向き
    const span = Math.hypot(W, H) / 2 + 20;
    for (let i = -Math.ceil(span / gap); i <= Math.ceil(span / gap); i++) {
      const off = i * gap;
      s.add(tint(p, sign === 1 ? 0 : 1, 0.4), 0.5, sample(Math.ceil(2 * span / 4), -span, span, t => {
        const d = off + amp * Math.sin(t / wl * TAU + i * 0.9);
        return [W / 2 + ux * t + vx * d, H / 2 + uy * t + vy * d];
      }));
    }
  }
  // 縁のギョーシェ枠: 角の丸い矩形の周に沿って、法線方向へ揺らした細線を位相をずらして重ねる
  const inset = 20, rad = 26;
  const x0 = inset, y0 = inset, x1 = W - inset, y1 = H - inset;
  const straight = [x1 - x0 - 2 * rad, y1 - y0 - 2 * rad];
  const arc = Math.PI * rad / 2;
  const per = 2 * (straight[0]! + straight[1]!) + 4 * arc;
  const along = (u: number): [Pt, Pt] => { // 周上の点と外向きの法線
    const segs: [number, (t: number) => [Pt, Pt]][] = [
      [straight[0]!, t => [[x0 + rad + t, y0], [0, -1]]],
      [arc, t => { const a = -Math.PI / 2 + t / rad; return [[x1 - rad + rad * Math.cos(a), y0 + rad + rad * Math.sin(a)], [Math.cos(a), Math.sin(a)]]; }],
      [straight[1]!, t => [[x1, y0 + rad + t], [1, 0]]],
      [arc, t => { const a = t / rad; return [[x1 - rad + rad * Math.cos(a), y1 - rad + rad * Math.sin(a)], [Math.cos(a), Math.sin(a)]]; }],
      [straight[0]!, t => [[x1 - rad - t, y1], [0, 1]]],
      [arc, t => { const a = Math.PI / 2 + t / rad; return [[x0 + rad + rad * Math.cos(a), y1 - rad + rad * Math.sin(a)], [Math.cos(a), Math.sin(a)]]; }],
      [straight[1]!, t => [[x0, y1 - rad - t], [-1, 0]]],
      [arc, t => { const a = Math.PI + t / rad; return [[x0 + rad + rad * Math.cos(a), y0 + rad + rad * Math.sin(a)], [Math.cos(a), Math.sin(a)]]; }],
    ];
    let t = ((u % per) + per) % per;
    for (const [len, f] of segs) { if (t <= len) return f(t); t -= len; }
    return segs[0]![1](0);
  };
  const waves = Math.round(per / 30);
  for (let j = 0; j < 12; j++) {
    const ph = (j / 12) * Math.PI;
    s.add(tint(p, j % 2 ? 2 : 0, 0.5), 0.5, sample(Math.ceil(per / 2.5), 0, per, u => {
      const [[px, py], [nx, ny]] = along(u);
      const d = 5 * Math.sin(u / per * waves * TAU + ph) + 2.5 * Math.sin(u / per * waves * 3 * TAU - ph * 2);
      return [px + nx * d, py + ny * d];
    }));
  }
  return frame(p, s);
}

const INK = "#101827", INK_SUB = "#334155";
/** CARD_THEMES の配色をそのまま線の色に使う。見出し・帯（accent）は模様の上でも読めるよう、
 * テーマの accentDeep と同じ色相のさらに濃い色にしてある */
const THEME_NAMES: Record<CardThemeKey, { ja: string; en: string; accent: string }> = {
  indigo: { ja: "インディゴ", en: "Indigo", accent: "#3730A3" },
  teal: { ja: "ティール", en: "Teal", accent: "#115E59" },
  rose: { ja: "ローズ", en: "Rose", accent: "#9D174D" },
  amber: { ja: "アンバー", en: "Amber", accent: "#7C2D12" },
  mono: { ja: "モノ", en: "Mono", accent: "#1E293B" },
};
const themePalette = (key: CardThemeKey): BuiltinBackgroundPalette => {
  const theme = CARD_THEMES.find(t => t.key === key)!;
  const names = THEME_NAMES[key];
  return {
    key, nameJa: names.ja, nameEn: names.en, base: "#FFFFFF",
    colors: [theme.accentA, theme.accentB, theme.accentBLight],
    ink: INK, inkSub: INK_SUB, accent: names.accent, onAccent: "#FFFFFF",
  };
};
const palettes = (...keys: CardThemeKey[]) => keys.map(themePalette);

export const BUILTIN_BACKGROUNDS: readonly BuiltinBackground[] = [
  { key: "rosette", nameJa: "ロゼット", nameEn: "Guilloché Rosette", draw: drawRosette, palettes: palettes("indigo", "teal", "rose", "amber", "mono") },
  { key: "moire", nameJa: "モアレ", nameEn: "Interference", draw: drawMoire, palettes: palettes("indigo", "teal", "rose", "mono") },
  { key: "contours", nameJa: "等高線", nameEn: "Contours", draw: drawContours, palettes: palettes("teal", "indigo", "amber", "mono") },
  { key: "ribbons", nameJa: "リボン", nameEn: "Ribbons", draw: drawRibbons, palettes: palettes("rose", "indigo", "teal", "amber") },
  { key: "engine", nameJa: "旋盤彫り", nameEn: "Engine Turned", draw: drawEngineTurned, palettes: palettes("amber", "indigo", "teal", "mono") },
  { key: "mesh", nameJa: "セキュリティメッシュ", nameEn: "Security Mesh", draw: drawMesh, palettes: palettes("indigo", "teal", "rose", "amber", "mono") },
];

export function findBuiltinBackground(key: string): BuiltinBackground | undefined {
  return BUILTIN_BACKGROUNDS.find(b => b.key === key);
}

/** 背景の要素木。idPrefix は同じページに複数枚並べたときの id 衝突よけ（今の模様は id を使わない） */
export function builtinBackgroundNodes(backgroundKey: string, paletteKey: string, idPrefix: string): BgNode[] {
  const bg = findBuiltinBackground(backgroundKey);
  const palette = bg?.palettes.find(p => p.key === paletteKey) ?? bg?.palettes[0];
  return bg && palette ? withLegibleStrokes(palette, bg.draw(palette, idPrefix)) : [];
}

const escapeAttr = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function nodeMarkup(n: BgNode): string {
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  return n.children?.length ? `<${n.tag}${attrs}>${n.children.map(nodeMarkup).join("")}</${n.tag}>` : `<${n.tag}${attrs}/>`;
}
/** 単体の SVG 文字列（書き出し・サイズ確認用） */
export function builtinBackgroundMarkup(backgroundKey: string, paletteKey: string, idPrefix = "bg"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${
    builtinBackgroundNodes(backgroundKey, paletteKey, idPrefix).map(nodeMarkup).join("")}</svg>`;
}
