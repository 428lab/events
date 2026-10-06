/** 名札（イベントカード）のビルトイン背景。
 *
 * 名札は会場や家庭のプリンタで刷るので、どの背景もインクを食わない線画にしてある。
 * 地は白（ごく淡い色まで）で、塗りつぶしの面・グラデーション・太い帯は使わない。
 * 模様は名前の下も含めてカード全面に敷く（文字のために穴を空けない）。
 * 文字は空白ではなく色で読ませる。線は地に寄せた淡い色にし、左上（既定テンプレートの文字の側）ほど
 * なだらかに淡くする（strengthAt）。名前の濃い文字と線の色の差は WCAG 4.5:1 以上を保つ。
 *
 * どれも外部画像を使わず、コードで組み立てる SVG（パラメトリック）なので、
 * どの倍率でもにじまず、印刷でも線がつぶれない。長いパスデータを持たず、
 * ループで要素を並べるだけにしてファイルを小さく保つ。
 * 各配色は文字色（ink / inkSub / accent / onAccent）も持ち、白い地の上で濃いインクの文字にする。
 *
 * 描画結果は React に依存しない要素木（BgNode）。React では BuiltinBackgroundLayer で
 * 要素に起こし、書き出しや検査では builtinBackgroundMarkup で文字列にする。 */
const W = 1074;
const H = 650;

export type BgTag = "g" | "rect" | "circle" | "ellipse" | "path" | "polygon" | "defs"
  | "clipPath" | "pattern";
export interface BgNode { tag: BgTag; attrs: Record<string, string | number>; children?: BgNode[] }

export interface BuiltinBackgroundPalette {
  key: string;
  nameJa: string;
  nameEn: string;
  /** 地の色。名札データの background.color にもこの値を入れる。インク節約のため白かごく淡い色だけ */
  base: string;
  /** 模様の線の色（先頭ほど主役）。実際の線はこれを地の色へ寄せた淡い色で引く */
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

const el = (tag: BgTag, attrs: BgNode["attrs"], children?: BgNode[]): BgNode =>
  children ? { tag, attrs, children } : { tag, attrs };
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
/** 模様の濃さの倍率。左上（文字の側）で STRENGTH_MIN、右下で 1 へ、カード全体でなだらかに変わる。
 * 穴にはせず、名前の下でも模様は同じ形のまま淡く続く */
export const STRENGTH_MIN = 0.6;
export function strengthAt(x: number, y: number): number {
  return STRENGTH_MIN + (1 - STRENGTH_MIN) * smooth((x / W) * 0.75 + (y / H) * 0.45 - 0.2);
}
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
/** 模様の線と文字の色の差の下限（WCAG）。線は不透明なので重なっても暗くならず、にじみは地へ寄るだけ */
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
const full = (fill: string) => el("rect", { x: 0, y: 0, width: W, height: H, fill });
const c = (p: BuiltinBackgroundPalette, i: number) => p.colors[i % p.colors.length]!;
/** 配色の i 番目の色を、地へ寄せた淡い線の色にする（t は 0..1 の濃さ、x/y はその線のある位置） */
const tint = (p: BuiltinBackgroundPalette, i: number, t: number, x = W, y = H) =>
  mixColor(p.base, c(p, i), t * strengthAt(x, y));
/** 色の数を抑えるため、濃さを段に丸めてからまとめる（段ごとに1本のパスにする） */
const STEPS = 8;
const step = (x: number, y: number) => Math.round(((strengthAt(x, y) - STRENGTH_MIN) / (1 - STRENGTH_MIN)) * STEPS);
const stepStrength = (s: number) => STRENGTH_MIN + (1 - STRENGTH_MIN) * (s / STEPS);
function bucketPaths(add: (put: (x: number, y: number, d: string) => void) => void,
  stroke: (strength: number) => string, attrs: BgNode["attrs"] = {}): BgNode[] {
  const buckets = new Map<number, string>();
  add((x, y, d) => { const s = step(x, y); buckets.set(s, (buckets.get(s) ?? "") + d); });
  return [...buckets].sort(([a], [b]) => a - b).map(([s, d]) => el("path", { d, stroke: stroke(stepStrength(s)), ...attrs }));
}
const pts = (list: number[][]) => list.map(([a, b]) => `${r1(a!)},${r1(b!)}`).join(" ");

/** 1. ジオメトリック: 全面に淡い三角格子を張り、ところどころの三角形を内側にもう一回り、配色の色で縁取る */
function drawGeometric(p: BuiltinBackgroundPalette): BgNode[] {
  const rand = rng(11);
  const s = 64, h = s * Math.sqrt(3) / 2;
  const tris: number[][][] = [];
  for (let j = -1; j * h < H + h; j++) for (let i = -1; i * s < W + s; i++) {
    const x = i * s + (j % 2 ? s / 2 : 0), y = j * h;
    tris.push([[x, y + h], [x + s, y + h], [x + s / 2, y]], [[x + s / 2, y], [x + s * 1.5, y], [x + s, y + h]]);
  }
  const center = (t: number[][]) => [(t[0]![0]! + t[1]![0]! + t[2]![0]!) / 3, (t[0]![1]! + t[1]![1]! + t[2]![1]!) / 3] as const;
  const lattice = bucketPaths(put => {
    for (const [k, t] of tris.entries()) if (k % 2 === 0) {
      const [cx, cy] = center(t);
      put(cx, cy, `M${pts(t).replace(/ /g, "L")}Z`);
    }
  }, st => mixColor(p.base, c(p, 0), 0.2 * st), { "stroke-width": 0.6 });
  const accents: BgNode[] = [];
  for (const t of tris) {
    const roll = rand(), pick = rand(), size = rand();
    if (roll > 0.2) continue;
    const [cx, cy] = center(t), k = 0.42 + 0.36 * size;
    const i = pick < 0.5 ? 0 : pick < 0.8 ? 1 : 2;
    accents.push(el("polygon", {
      points: pts(t.map(([a, b]) => [cx + (a! - cx) * k, cy + (b! - cy) * k])),
      stroke: tint(p, i, i === 2 ? 0.75 : 0.6, cx, cy), "stroke-width": size > 0.7 ? 1.4 : 1,
    }));
  }
  return [
    full(p.base),
    el("g", { fill: "none", "stroke-linejoin": "round" }, [...lattice, ...accents]),
  ];
}

/** 2. 回路ライン: 細い配線が左右にカード全体を横切り、45度で折れて、白抜きの丸い端子で終わる */
function drawCircuit(p: BuiltinBackgroundPalette): BgNode[] {
  const rand = rng(5), g = 26, rows = Math.floor(H / g);
  const traces: BgNode[] = [], pads: BgNode[] = [];
  for (let row = 1; row < rows; row++) for (let seg = 0; seg < 2; seg++) {
    if (rand() < 0.25) continue;
    let x = seg === 0 ? -g : Math.round((W * 0.35 + rand() * W * 0.4) / g) * g, y = row * g + 0.5;
    const end = seg === 0 ? Math.round((W * (0.3 + rand() * 0.45)) / g) * g : W + g;
    const i = rand() < 0.65 ? 0 : 1, wide = rand() < 0.25;
    let d = `M${x} ${y}`;
    while (x < end) {
      const run = g * (2 + Math.floor(rand() * 6));
      x = Math.min(end, x + run); d += `H${x}`;
      if (x < end && rand() < 0.5) {
        const dir = rand() < 0.5 ? -1 : 1, ny = y + dir * g;
        if (ny > g / 2 && ny < H - g / 2) { x += g; y = ny; d += `L${x} ${y}`; }
      }
    }
    const stroke = tint(p, i, wide ? 0.62 : 0.5, x, y);
    traces.push(el("path", { d, stroke, "stroke-width": wide ? 1.6 : 0.9 }));
    if (seg === 0 && x < W) pads.push(el("circle", { cx: x, cy: y, r: wide ? 5 : 3.6, fill: p.base, stroke, "stroke-width": 1.2 }));
    if (seg === 1) {
      const sx = Number(d.slice(1, d.indexOf(" ")));
      pads.push(el("circle", { cx: sx, cy: row * g + 0.5, r: 3.6, fill: p.base, stroke, "stroke-width": 1.2 }));
    }
  }
  return [
    full(p.base),
    el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, traces),
    ...pads,
  ];
}

/** 3. 青海波: 重なる同心円の波を細い線で、カード全面に敷き詰める。1枚のタイル（2R×R）を繰り返す。
 * タイルに掛かる円を上の段から順に描くので、外の円の白い塗りが上の段のうしろを隠し、
 * 無限に並べたときと同じ重なりになる（白はインクを使わない） */
function drawSeigaiha(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const R = 30, scale: BgNode[] = [];
  const outer = mixColor(p.base, c(p, 0), 0.42), inner = mixColor(p.base, c(p, 1), 0.42);
  for (const cy of [-R / 2, 0, R / 2, R, R * 1.5]) for (const cx of (cy / (R / 2)) % 2 ? [-R, R, 3 * R] : [0, 2 * R]) {
    scale.push(
      el("circle", { cx, cy, r: R, fill: p.base }),
      el("circle", { cx, cy, r: R, stroke: outer, "stroke-width": 1 }),
      el("circle", { cx, cy, r: R * 0.76, stroke: inner }),
      el("circle", { cx, cy, r: R * 0.52, stroke: inner }),
      el("circle", { cx, cy, r: R * 0.28, stroke: inner }),
    );
  }
  return [
    el("defs", {}, [
      el("pattern", { id: `${id}-wave`, width: 2 * R, height: R, patternUnits: "userSpaceOnUse", x: 0, y: 0 },
        [el("g", { fill: "none", "stroke-width": 0.7 }, scale)]),
    ]),
    full(p.base),
    full(`url(#${id}-wave)`),
  ];
}

/** 4. 麻の葉: 三角格子の各三角形に重心への細い線を引き、カード全面に敷く */
function drawAsanoha(p: BuiltinBackgroundPalette): BgNode[] {
  const s = 62, h = s * Math.sqrt(3) / 2;
  const lines = bucketPaths(put => {
    for (let j = -1; j * h < H + h; j++) for (let i = -1; i * s < W + s; i++) {
      const x = i * s + (j % 2 ? s / 2 : 0), y = j * h;
      const tri = (corners: number[][], edges: boolean) => {
        const cx = (corners[0]![0]! + corners[1]![0]! + corners[2]![0]!) / 3, cy = (corners[0]![1]! + corners[1]![1]! + corners[2]![1]!) / 3;
        const P = corners.map(([a1, b1]) => `${Math.round(a1!)} ${Math.round(b1!)}`);
        const C = `${Math.round(cx)} ${Math.round(cy)}`;
        // 上向きの三角形だけ辺を描けば、格子の辺はちょうど一度ずつ引かれる
        put(cx, cy, `${edges ? `M${P[0]}L${P[1]}L${P[2]}Z` : ""}M${P[0]}L${C}M${P[1]}L${C}M${P[2]}L${C}`);
      };
      tri([[x, y + h], [x + s, y + h], [x + s / 2, y]], true);
      tri([[x + s / 2, y], [x + s * 1.5, y], [x + s, y + h]], false);
    }
  }, st => mixColor(p.base, c(p, 0), 0.4 * st), { "stroke-width": 0.7 });
  return [full(p.base), el("g", { fill: "none", "stroke-linejoin": "round" }, lines)];
}

/** 5. サイバーグリッド: 上の方の地平線へ向かう遠近の方眼がカード全面に広がり、右上に輪郭だけの太陽が昇る */
function drawCyberGrid(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const horizon = 150, vx = 700, sun = { cx: 930, cy: horizon, r: 96 };
  const floor = bucketPaths(put => {
    // 消失点から放射する縦の線。線を短い区間に分けて、場所ごとの濃さで引く
    for (let k = -30; k <= 30; k++) {
      const bx = vx + k * 70;
      for (let s = 0; s < 6; s++) {
        const t0 = s / 6, t1 = (s + 1) / 6;
        const y0 = horizon + (H - horizon) * t0, y1 = horizon + (H - horizon) * t1;
        const x0 = vx + (bx - vx) * t0, x1 = vx + (bx - vx) * t1;
        if (Math.max(x0, x1) < 0 || Math.min(x0, x1) > W) continue;
        put((x0 + x1) / 2, (y0 + y1) / 2, `M${r1(x0)} ${r1(y0)}L${r1(x1)} ${r1(y1)}`);
      }
    }
    // 奥ほど詰まる横の線
    for (let k = 1; k <= 14; k++) {
      const y = r1(horizon + (H - horizon) * (k / 14) ** 1.7);
      for (let x = 0; x < W; x += W / 4) put(x + W / 8, y, `M${r1(x)} ${y}h${r1(W / 4)}`);
    }
  }, st => mixColor(p.base, c(p, 0), 0.42 * st), { "stroke-width": 0.8 });
  // 地平線より上は、細い点線の星座のような目盛り
  let sky = "";
  for (let y = 30; y < horizon; y += 30) sky += `M0 ${y}H${W}`;
  let cuts = "";
  for (let k = 0; k < 7; k++) cuts += `M${sun.cx - sun.r} ${r1(sun.cy - 10 - k * 12 + k * k * 0.6)}h${sun.r * 2}`;
  return [
    el("defs", {}, [
      el("clipPath", { id: `${id}-sky` }, [el("rect", { x: 0, y: 0, width: W, height: horizon })]),
    ]),
    full(p.base),
    el("path", { d: sky, stroke: mixColor(p.base, c(p, 0), 0.12), "stroke-width": 0.6, "stroke-dasharray": "2 10", fill: "none" }),
    el("g", { fill: "none", "clip-path": `url(#${id}-sky)` }, [
      el("circle", { ...sun, stroke: tint(p, 1, 0.8, sun.cx, sun.cy), "stroke-width": 1.6 }),
      el("circle", { ...sun, r: sun.r + 10, stroke: tint(p, 1, 0.55, sun.cx, sun.cy), "stroke-width": 0.8 }),
      el("path", { d: cuts, stroke: tint(p, 1, 0.6, sun.cx, sun.cy), "stroke-width": 1 }),
    ]),
    el("g", { fill: "none" }, floor),
    el("path", { d: `M0 ${horizon}H${W}`, stroke: tint(p, 1, 0.7, W * 0.7, horizon), "stroke-width": 1.2, fill: "none" }),
  ];
}

/** 6. 和紙: 全面に漉き込んだ細い繊維と、横に流れる霞（すやり霞）の細い二重線、細い二重の枠 */
function drawWashi(p: BuiltinBackgroundPalette): BgNode[] {
  const rand = rng(29), fibers: BgNode[] = [];
  for (let k = 0; k < 340; k++) {
    const long = k < 50;
    const x = rand() * W, y = rand() * H, len = long ? 60 + rand() * 80 : 8 + rand() * 34, ang = rand() * Math.PI;
    const bend = (rand() - 0.5) * len * 0.6;
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    fibers.push(el("path", {
      d: `M${r1(x)} ${r1(y)}q${r1(dx / 2 - dy * bend / len)} ${r1(dy / 2 + dx * bend / len)} ${r1(dx)} ${r1(dy)}`,
      stroke: tint(p, 0, (long ? 0.18 : 0.24) + rand() * 0.2, x, y),
      "stroke-width": r1(0.4 + rand() * (long ? 0.5 : 0.7)),
    }));
  }
  // 霞: 角の丸い細長い帯の輪郭を、ずらして重ねる
  const mist: BgNode[] = [];
  for (const [x, y, w] of [[-60, 70, 620], [520, 190, 640], [-80, 330, 560], [430, 470, 720], [90, 575, 520]] as const) {
    for (const [dy, t, sw] of [[0, 0.5, 1], [7, 0.32, 0.6]] as const)
      mist.push(el("rect", { x, y: y + dy, width: w, height: 44 - dy * 2, rx: 22 - dy, stroke: tint(p, 1, t, x + w / 2, y), "stroke-width": sw }));
  }
  return [
    full(p.base),
    el("g", { fill: "none", "stroke-linecap": "round" }, [...fibers, ...mist]),
    el("rect", { x: 20, y: 24, width: W - 40, height: H - 44, fill: "none", stroke: tint(p, 1, 0.85), "stroke-width": 1.4 }),
    el("rect", { x: 27, y: 31, width: W - 54, height: H - 58, fill: "none", stroke: tint(p, 1, 0.7), "stroke-width": 0.6 }),
  ];
}

/** 7. ピンストライプ: 全面に細い斜線を等間隔に引き、数本おきに配色の色の線を二本ずつ通す */
function drawPinstripe(p: BuiltinBackgroundPalette): BgNode[] {
  const k = 0.42, drop = k * H, gap = 12;
  const plain = bucketPaths(put => {
    for (let x = -drop; x < W + gap; x += gap) if (Math.round((x + drop) / gap) % 6) {
      for (let s = 0; s < 4; s++) {
        const y0 = (H / 4) * s, y1 = y0 + H / 4;
        put(x + drop / 2 - k * (y0 + y1) / 2 + drop / 2, (y0 + y1) / 2, `M${r1(x + drop - k * y0)} ${r1(y0)}L${r1(x + drop - k * y1)} ${r1(y1)}`);
      }
    }
  }, st => mixColor(p.base, c(p, 0), 0.18 * st), { "stroke-width": 0.6 });
  const accent: BgNode[] = [];
  let n = 0;
  for (let x = -drop; x < W + gap; x += gap) if (Math.round((x + drop) / gap) % 6 === 0) {
    const i = n++ % 3 === 2 ? 2 : n % 2;
    const d = bucketPaths(put => {
      for (let s = 0; s < 4; s++) {
        const y0 = (H / 4) * s, y1 = y0 + H / 4, mx = x + drop - k * (y0 + y1) / 2;
        put(mx, (y0 + y1) / 2, `M${r1(x + drop - k * y0)} ${r1(y0)}L${r1(x + drop - k * y1)} ${r1(y1)}`
          + `M${r1(x + drop - k * y0 + 3.5)} ${r1(y0)}L${r1(x + drop - k * y1 + 3.5)} ${r1(y1)}`);
      }
    }, st => mixColor(p.base, c(p, i), (i === 2 ? 0.7 : 0.55) * st), { "stroke-width": 0.9 });
    accent.push(...d);
  }
  return [full(p.base), el("g", { fill: "none" }, [...plain, ...accent])];
}

/** 8. ハーフトーン: 全面に輪郭だけの網点を並べ、輪の大きさが斜めの大きな波のように満ち引きする */
function drawHalftone(p: BuiltinBackgroundPalette): BgNode[] {
  const pitch = 32, rings: [number, number, number][] = [];
  for (let j = 0, y = 0; y <= H + pitch; j++, y += pitch * 0.866) for (let x = j % 2 ? pitch / 2 : 0; x <= W + pitch; x += pitch) {
    const wave = 0.5 + 0.5 * Math.sin((x * 0.8 + y) / 150 - 1.2);
    const r = 2.2 + 7.6 * smooth(wave * 0.75 + (x / W + y / H) * 0.2);
    rings.push([x, y, r]);
  }
  // 輪は整数の位置と 0.5 刻みの半径に丸めて、パスを短く保つ
  const circle = (x: number, y: number, r: number) => {
    const q = Math.round(r * 2) / 2;
    return `M${Math.round(x - q)} ${Math.round(y)}a${q} ${q} 0 1 0 ${2 * q} 0a${q} ${q} 0 1 0-${2 * q} 0`;
  };
  // 輪の大きさで色を分け、大きい輪を主役の色にする
  const paths = (big: boolean, i: number, t: number) => bucketPaths(put => {
    for (const [x, y, r] of rings) if ((r >= 6) === big) put(x, y, circle(x, y, r));
  }, st => mixColor(p.base, c(p, i), t * st), { "stroke-width": 0.8 });
  return [full(p.base), el("g", { fill: "none" }, [...paths(false, 1, 0.45), ...paths(true, 0, 0.5)])];
}

/** 9. オーロラ: 左から右へカード全面を横切る細い等高線が、ゆるやかにうねる。色は上から下へ配色の順に移り変わる */
function drawAurora(p: BuiltinBackgroundPalette): BgNode[] {
  const lines: BgNode[] = [];
  const shade = (t: number) => {
    const scaled = t * (p.colors.length - 1), i = Math.min(p.colors.length - 2, Math.floor(scaled));
    return mixColor(c(p, i), c(p, i + 1), scaled - i);
  };
  const n = 30;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), base = -60 + t * (H + 120);
    let d = "";
    for (let x = 0; x <= W + 0.01; x += 18) {
      const y = base + 70 * Math.sin(x / 260 + t * 2.4) + 34 * Math.sin(x / 113 - t * 5.1) - 40 * Math.cos(t * 3.1 + x / 520);
      d += `${x ? "L" : "M"}${r1(x)} ${r1(y)}`;
    }
    // 1本の線は1色で通す（区間で色を変えると継ぎ目が縦に並んで見える）
    lines.push(el("path", { d, stroke: mixColor(p.base, shade(t), k % 5 === 0 ? 0.62 : 0.42), "stroke-width": k % 5 === 0 ? 1.3 : 0.8 }));
  }
  return [full(p.base), el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, lines)];
}

/** 10. 紙吹雪: カード全面に、輪郭だけの紙片（細長い短冊・丸・三角・波線）が舞う */
function drawConfetti(p: BuiltinBackgroundPalette): BgNode[] {
  const rand = rng(7), bits: BgNode[] = [];
  // 格子に1つずつ揺らして置き、全面にむらなく散らす
  const gx = 62, gy = 54;
  for (let y = gy / 2; y < H + gy / 2; y += gy) for (let x = gx / 2; x < W + gx / 2; x += gx) {
    const px = x + (rand() - 0.5) * gx * 0.9, py = y + (rand() - 0.5) * gy * 0.9;
    const kind = rand(), rot = Math.round(rand() * 180), pick = rand(), size = 0.75 + rand() * 0.6;
    const stroke = tint(p, Math.floor(pick * p.colors.length), 0.7, px, py);
    const at = `translate(${r1(px)} ${r1(py)}) rotate(${rot}) scale(${r1(size)})`;
    bits.push(kind < 0.4 ? el("rect", { x: -9, y: -3.5, width: 18, height: 7, rx: 1.5, stroke, transform: at })
      : kind < 0.6 ? el("circle", { r: 4.5, stroke, transform: at })
      : kind < 0.8 ? el("polygon", { points: "0,-7 6.5,5 -6.5,5", stroke, transform: at })
      : el("path", { d: "M-12 0q3-6 6 0t6 0t6 0t6 0", stroke, "stroke-linecap": "round", transform: at }));
  }
  return [full(p.base), el("g", { fill: "none", "stroke-width": 1.2, "stroke-linejoin": "round" }, bits)];
}

const pal = (key: string, nameJa: string, nameEn: string, base: string,
  colors: string[], accent: string, ink = INK, inkSub = INK_SUB): BuiltinBackgroundPalette =>
  ({ key, nameJa, nameEn, base, colors, ink, inkSub, accent, onAccent: "#FFFFFF" });
const INK = "#101827", INK_SUB = "#334155", WHITE = "#FFFFFF";

/** accent は模様の上に載る見出しでも 4.5:1 を割らないよう、白に対して約 7:1 以上の濃い色にしてある */
export const BUILTIN_BACKGROUNDS: readonly BuiltinBackground[] = [
  { key: "geometric", nameJa: "ジオメトリック", nameEn: "Geometric", draw: drawGeometric, palettes: [
    pal("teal", "ティール", "Teal", WHITE, ["#0F766E", "#2DD4BF", "#F59E0B"], "#115E59"),
    pal("sunset", "サンセット", "Sunset", WHITE, ["#EA580C", "#FB7185", "#FBBF24"], "#9A3412"),
    pal("indigo", "インディゴ", "Indigo", WHITE, ["#4338CA", "#818CF8", "#38BDF8"], "#4338CA"),
  ] },
  { key: "circuit", nameJa: "回路ライン", nameEn: "Circuit Lines", draw: drawCircuit, palettes: [
    pal("daylight", "デイライト", "Daylight", WHITE, ["#0891B2", "#DB2777"], "#155E75"),
    pal("mint", "ミント", "Mint", WHITE, ["#059669", "#84CC16"], "#065F46"),
    pal("violet", "バイオレット", "Violet", WHITE, ["#7C3AED", "#F97316"], "#6D28D9"),
  ] },
  { key: "seigaiha", nameJa: "青海波", nameEn: "Seigaiha Waves", draw: drawSeigaiha, palettes: [
    pal("ai", "藍", "Indigo", WHITE, ["#1E3A8A", "#6B8CEB"], "#1E3A8A"),
    pal("shu", "朱", "Vermilion", WHITE, ["#C2410C", "#F08A7A"], "#991B1B"),
    pal("matcha", "抹茶", "Matcha", WHITE, ["#4D7C0F", "#9CC25A"], "#3F6212"),
    pal("kin", "金", "Gold", WHITE, ["#A07A2C", "#D9B36A"], "#6B4E0F"),
  ] },
  { key: "asanoha", nameJa: "麻の葉", nameEn: "Asanoha", draw: drawAsanoha, palettes: [
    pal("sakura", "桜", "Sakura", WHITE, ["#BE185D"], "#9D174D"),
    pal("ai", "藍", "Indigo", WHITE, ["#1D4ED8"], "#1E40AF"),
    pal("kincha", "金茶", "Gold Tea", WHITE, ["#A16207"], "#92400E"),
    pal("sumi", "墨", "Sumi", WHITE, ["#374151"], "#374151"),
  ] },
  { key: "cybergrid", nameJa: "サイバーグリッド", nameEn: "Cyber Grid", draw: drawCyberGrid, palettes: [
    pal("blueprint", "ブループリント", "Blueprint", WHITE, ["#2563EB", "#F97316"], "#1E40AF"),
    pal("synth", "シンセ", "Synthwave", WHITE, ["#C026D3", "#F59E0B"], "#86198F"),
    pal("matrix", "マトリクス", "Matrix", WHITE, ["#16A34A", "#0891B2"], "#166534"),
  ] },
  { key: "washi", nameJa: "和紙", nameEn: "Washi Paper", draw: drawWashi, palettes: [
    pal("kinari", "生成り", "Natural", "#FFFDF8", ["#A8977A", "#B9A57E"], "#115E59", INK, "#44403C"),
    pal("sakura", "桜", "Sakura", "#FFFBFB", ["#C9A0A6", "#D98A98"], "#9F1239", INK, "#4C3A3D"),
    pal("sora", "空", "Sky", "#FBFDFF", ["#94A8C0", "#8FA9D0"], "#1E40AF"),
  ] },
  { key: "pinstripe", nameJa: "ピンストライプ", nameEn: "Pinstripes", draw: drawPinstripe, palettes: [
    pal("teal", "ティール×オレンジ", "Teal & Orange", WHITE, ["#0F766E", "#2DD4BF", "#FB923C"], "#115E59"),
    pal("royal", "ロイヤル", "Royal", WHITE, ["#1E3A8A", "#3B82F6", "#FBBF24"], "#1E3A8A"),
    pal("berry", "ベリー", "Berry", WHITE, ["#9D174D", "#F472B6", "#F59E0B"], "#9D174D"),
  ] },
  { key: "halftone", nameJa: "ハーフトーン", nameEn: "Halftone Rings", draw: drawHalftone, palettes: [
    pal("pop", "ポップ", "Pop", WHITE, ["#F43F5E", "#F59E0B"], "#9F1239"),
    pal("cyan", "シアン", "Cyan", WHITE, ["#0891B2", "#6366F1"], "#155E75"),
    pal("ink", "インク", "Ink", WHITE, ["#334155", "#94A3B8"], "#111827"),
  ] },
  { key: "aurora", nameJa: "オーロラライン", nameEn: "Aurora Lines", draw: drawAurora, palettes: [
    pal("northern", "ノーザン", "Northern", WHITE, ["#14B8A6", "#6366F1", "#A855F7"], "#115E59"),
    pal("dawn", "夜明け", "Dawn", WHITE, ["#F97316", "#EC4899", "#8B5CF6"], "#9A3412"),
    pal("lagoon", "ラグーン", "Lagoon", WHITE, ["#06B6D4", "#10B981", "#3B82F6"], "#155E75"),
  ] },
  { key: "confetti", nameJa: "紙吹雪", nameEn: "Festival Confetti", draw: drawConfetti, palettes: [
    pal("festival", "フェス", "Festival", WHITE, ["#F43F5E", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6"], "#9F1239"),
    pal("pastel", "パステル", "Pastel", WHITE, ["#EC8FC0", "#8E9CF5", "#4FD1A5", "#E8C547"], "#5B21B6"),
    pal("gold", "ゴールド", "Gold", WHITE, ["#C99A2E", "#E5C76B", "#9A7420", "#475569"], "#111827"),
  ] },
];

export function findBuiltinBackground(key: string): BuiltinBackground | undefined {
  return BUILTIN_BACKGROUNDS.find(b => b.key === key);
}

/** 背景の要素木。idPrefix は同じページに複数枚並べたときの pattern や clipPath の id 衝突を防ぐ */
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
