/** 名札（イベントカード）のビルトイン背景。
 *
 * どれも外部画像を使わず、コードで組み立てる SVG（パラメトリック）なので、
 * どの倍率でもにじまず、印刷でも線がつぶれない。長いパスデータを持たず、
 * ループで要素を並べるだけにしてファイルを小さく保つ。
 *
 * 文字が載る場所（既定テンプレートの見出し・名前・ハンドル・枠の列）は
 * CALM_ZONES として避け、模様は右上・右端・下端に寄せる。
 * 各配色は文字色（ink / inkSub / accent / onAccent）も持ち、
 * 暗い背景でも既定テンプレートの文字を読めるように塗り替えられる。
 *
 * 描画結果は React に依存しない要素木（BgNode）。React では renderBgNodes 相当で
 * 要素に起こし、書き出しや検査では builtinBackgroundMarkup で文字列にする。 */
const W = 1074;
const H = 650;

export type BgTag = "g" | "rect" | "circle" | "ellipse" | "path" | "polygon" | "defs"
  | "linearGradient" | "radialGradient" | "stop" | "clipPath" | "mask" | "pattern" | "filter" | "feGaussianBlur";
export interface BgNode { tag: BgTag; attrs: Record<string, string | number>; children?: BgNode[] }

export interface BuiltinBackgroundPalette {
  key: string;
  nameJa: string;
  nameEn: string;
  tone: "light" | "dark";
  /** 地の色。名札データの background.color にもこの値を入れる */
  base: string;
  /** 模様の色（先頭ほど主役） */
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

/** 既定テンプレートで文字が載る範囲。見出しは横に長いので別の箱にしてある */
export const CALM_ZONES = [
  { x0: 40, y0: 30, x1: 925, y1: 150 },
  { x0: 40, y0: 150, x1: 800, y1: 475 },
] as const;

const el = (tag: BgTag, attrs: BgNode["attrs"], children?: BgNode[]): BgNode =>
  children ? { tag, attrs, children } : { tag, attrs };
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
/** 文字の範囲からの距離で 0（範囲内）→1（falloff 以上離れた）になる */
export function calmFactor(x: number, y: number, falloff: number): number {
  let d = Infinity;
  for (const z of CALM_ZONES) {
    const dx = Math.max(z.x0 - x, 0, x - z.x1), dy = Math.max(z.y0 - y, 0, y - z.y1);
    d = Math.min(d, Math.hypot(dx, dy));
  }
  return smooth(d / falloff);
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
const full = (fill: string, extra: BgNode["attrs"] = {}) => el("rect", { x: 0, y: 0, width: W, height: H, fill, ...extra });
const linear = (id: string, stops: [number, string, number?][], dir = { x1: 0, y1: 0, x2: 1, y2: 1 }) =>
  el("linearGradient", { id, ...dir }, stops.map(([o, c, a]) => el("stop", { offset: o, "stop-color": c, "stop-opacity": a ?? 1 })));
const radial = (id: string, color: string, alpha: number) => el("radialGradient", { id }, [
  el("stop", { offset: 0, "stop-color": color, "stop-opacity": alpha }),
  el("stop", { offset: 0.45, "stop-color": color, "stop-opacity": alpha * 0.55 }),
  el("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }),
]);
const c = (p: BuiltinBackgroundPalette, i: number) => p.colors[i % p.colors.length]!;

/** 1. ジオメトリック: 斜めのグラデーションに、三角形の格子が右と下から崩れて現れる */
function drawGeometric(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const rand = rng(11);
  const s = 72, h = s * Math.sqrt(3) / 2;
  const tris: BgNode[] = [];
  for (let j = -1; j * h < H + h; j++) for (let i = -1; i * s < W + s; i++) {
    const x = i * s + (j % 2 ? s / 2 : 0), y = j * h;
    for (const pts of [[[x, y + h], [x + s, y + h], [x + s / 2, y]], [[x + s / 2, y], [x + s * 1.5, y], [x + s, y + h]]]) {
      const cx = (pts[0]![0]! + pts[1]![0]! + pts[2]![0]!) / 3, cy = (pts[0]![1]! + pts[1]![1]! + pts[2]![1]!) / 3;
      const f = calmFactor(cx, cy, 240);
      const roll = rand(), pick = rand(), shade = rand();
      if (f < 0.1 || roll > f * 0.9) continue;
      const color = c(p, pick < 0.45 ? 0 : pick < 0.8 ? 1 : 2);
      tris.push(el("polygon", { points: pts.map(([a, b]) => `${r1(a!)},${r1(b!)}`).join(" "),
        fill: mixColor(p.base, color, 0.25 + 0.75 * f * (0.45 + 0.55 * shade)) }));
    }
  }
  return [
    el("defs", {}, [linear(`${id}-wash`, [[0, p.base], [0.55, p.base], [1, mixColor(p.base, c(p, 2), p.tone === "dark" ? 0.18 : 0.35)]])]),
    full(`url(#${id}-wash)`),
    el("circle", { cx: 1030, cy: 40, r: 250, fill: mixColor(p.base, c(p, 2), p.tone === "dark" ? 0.16 : 0.3) }),
    el("g", { stroke: p.base, "stroke-width": 1.5, "stroke-linejoin": "round" }, tris),
  ];
}

/** 2. ネオンライン: 右上の角を囲む光の弧と、下端を走る回路のような線 */
function drawNeon(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const dark = p.tone === "dark";
  const glow = (d: string, color: string, alpha = 1): BgNode[] => [
    ...(dark ? [el("path", { d, stroke: color, "stroke-width": 10, "stroke-opacity": 0.14 * alpha }),
      el("path", { d, stroke: color, "stroke-width": 5, "stroke-opacity": 0.22 * alpha })] : []),
    el("path", { d, stroke: color, "stroke-width": dark ? 2.2 : 2.6, "stroke-opacity": alpha }),
  ];
  const arcs: BgNode[] = [];
  for (let i = 0; i < 7; i++) {
    const r = 64 + i * 15;
    arcs.push(...glow(`M${W - r} 0A${r} ${r} 0 0 0 ${W} ${r}`, c(p, i % 2), 1 - i * 0.09));
  }
  const nodes = [[700, 618], [742, 600], [760, 634], [22, 470]].map(([x, y]) =>
    el("circle", { cx: x!, cy: y!, r: 4.5, fill: p.base, stroke: c(p, x === 742 ? 1 : 0), "stroke-width": 2.2 }));
  return [
    el("defs", {}, [radial(`${id}-a`, c(p, 0), dark ? 0.38 : 0.18), radial(`${id}-b`, c(p, 1), dark ? 0.3 : 0.14)]),
    full(p.base),
    el("ellipse", { cx: W, cy: 0, rx: 340, ry: 300, fill: `url(#${id}-a)` }),
    el("ellipse", { cx: 0, cy: H, rx: 520, ry: 300, fill: `url(#${id}-b)` }),
    el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
      ...arcs,
      ...glow(`M0 618H700M742 600H${W}M700 618L742 600`, c(p, 0)),
      ...glow(`M0 634H760M760 634H${W}`, c(p, 1), 0.8),
      ...glow("M22 180V470", c(p, 1), 0.7),
      ...glow("M10 230V420", c(p, 0), 0.45),
    ]),
    ...nodes,
  ];
}

/** 文字の範囲を黒、外を白にしたマスク。境目をぼかして模様を文字の手前で消す */
function calmMask(id: string, blur: number): BgNode[] {
  return [
    el("filter", { id: `${id}-soft`, x: -0.2, y: -0.2, width: 1.4, height: 1.4 }, [el("feGaussianBlur", { stdDeviation: blur })]),
    el("mask", { id: `${id}-calm`, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H }, [
      full("#fff"),
      el("g", { filter: `url(#${id}-soft)`, fill: "#000" }, CALM_ZONES.map(z =>
        el("rect", { x: z.x0 - 50, y: z.y0 - 50, width: z.x1 - z.x0 + 100, height: z.y1 - z.y0 + 100 }))),
    ]),
  ];
}

/** 3. 青海波: 重なる同心円の波。1枚のタイル（2R×R）を敷き詰め、文字の下はマスクで消す。
 * タイルに掛かる円を上の段から順に描くので、外の円の塗り（地の色）が上の段のうしろを隠し、
 * 無限に並べたときと同じ重なりになる */
function drawSeigaiha(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const R = 34, scale: BgNode[] = [];
  for (const cy of [-R / 2, 0, R / 2, R, R * 1.5]) for (const cx of (cy / (R / 2)) % 2 ? [-R, R, 3 * R] : [0, 2 * R]) {
    scale.push(
      el("circle", { cx, cy, r: R, fill: p.base }),
      el("circle", { cx, cy, r: R, stroke: c(p, 0) }),
      el("circle", { cx, cy, r: R * 0.75, stroke: c(p, 0) }),
      el("circle", { cx, cy, r: R * 0.5, stroke: c(p, 0) }),
      el("circle", { cx, cy, r: R * 0.25, fill: c(p, 1) }),
    );
  }
  return [
    el("defs", {}, [
      el("pattern", { id: `${id}-wave`, width: 2 * R, height: R, patternUnits: "userSpaceOnUse", x: 3, y: 0 },
        [el("g", { fill: "none", "stroke-width": 1.8 }, scale)]),
      ...calmMask(id, 55),
    ]),
    full(p.base),
    el("g", { mask: `url(#${id}-calm)`, opacity: 0.75 }, [full(`url(#${id}-wave)`)]),
  ];
}

/** 4. 麻の葉: 三角格子の各三角形に重心への線を引く。文字の下でもごく淡く続く */
function drawAsanoha(p: BuiltinBackgroundPalette): BgNode[] {
  // 濃さを10段に丸め、段ごとに1本のパスにまとめる（要素数とファイルサイズを抑える）
  const s = 66, h = s * Math.sqrt(3) / 2, buckets = new Map<number, string>();
  for (let j = -1; j * h < H + h; j++) for (let i = -1; i * s < W + s; i++) {
    const x = i * s + (j % 2 ? s / 2 : 0), y = j * h;
    const tri = (pts: number[][], edges: boolean) => {
      const cx = (pts[0]![0]! + pts[1]![0]! + pts[2]![0]!) / 3, cy = (pts[0]![1]! + pts[1]![1]! + pts[2]![1]!) / 3;
      const level = Math.round(calmFactor(cx, cy, 230) * 10);
      const P = pts.map(([a1, b1]) => `${Math.round(a1!)} ${Math.round(b1!)}`);
      const C = `${Math.round(cx)} ${Math.round(cy)}`;
      // 上向きの三角形だけ辺を描けば、格子の辺はちょうど一度ずつ引かれる
      buckets.set(level, (buckets.get(level) ?? "") +
        `${edges ? `M${P[0]}L${P[1]}L${P[2]}Z` : ""}M${P[0]}L${C}M${P[1]}L${C}M${P[2]}L${C}`);
    };
    tri([[x, y + h], [x + s, y + h], [x + s / 2, y]], true);
    tri([[x + s / 2, y], [x + s * 1.5, y], [x + s, y + h]], false);
  }
  return [
    full(p.base),
    el("g", { fill: "none", "stroke-width": 1.3, "stroke-linejoin": "round" }, [...buckets].sort(([a], [b]) => a - b)
      .map(([level, d]) => el("path", { d, stroke: mixColor(p.base, c(p, 0), 0.07 + 0.06 * level) }))),
  ];
}

/** 5. サイバーグリッド: 方眼と遠近の床、右上にストライプの太陽 */
function drawCyberGrid(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const dark = p.tone === "dark";
  let grid = "";
  for (let x = 0; x <= W; x += 40) grid += `M${x} 0V${H}`;
  for (let y = 10; y <= H; y += 40) grid += `M0 ${y}H${W}`;
  const horizon = 500, vx = 930;
  let floor = "";
  for (let x = -2400; x <= 4200; x += 110) floor += `M${vx} ${horizon}L${x} ${H}`;
  for (let k = 1; k <= 7; k++) floor += `M0 ${r1(horizon + (H - horizon) * (k / 7) ** 1.8)}H${W}`;
  const sun = { cx: 1000, cy: 118, r: 56 };
  const cuts: BgNode[] = [];
  for (let k = 0; k < 6; k++) {
    const y = sun.cy + 6 + k * 9 + k * k * 0.5;
    cuts.push(el("rect", { x: sun.cx - sun.r, y: r1(y), width: sun.r * 2, height: r1(1.6 + k * 1.1), fill: p.base }));
  }
  return [
    el("defs", {}, [
      linear(`${id}-sky`, [[0, p.base], [1, mixColor(p.base, c(p, 1), dark ? 0.14 : 0.1)]], { x1: 0, y1: 0, x2: 0, y2: 1 }),
      linear(`${id}-sun`, [[0, c(p, 1)], [1, c(p, 0)]], { x1: 0, y1: 0, x2: 0, y2: 1 }),
      linear(`${id}-mx`, [[0.87, "#fff", 0], [0.93, "#fff", 1]], { x1: 0, y1: 0, x2: 1, y2: 0 }),
      linear(`${id}-my`, [[0.73, "#fff", 0], [0.77, "#fff", 1]], { x1: 0, y1: 0, x2: 0, y2: 1 }),
      el("mask", { id: `${id}-edge` }, [full("#000"), full(`url(#${id}-mx)`), full(`url(#${id}-my)`)]),
      el("clipPath", { id: `${id}-sunclip` }, [el("circle", sun)]),
      el("clipPath", { id: `${id}-floor` }, [el("rect", { x: 0, y: horizon, width: W, height: H - horizon })]),
    ]),
    full(`url(#${id}-sky)`),
    el("path", { d: grid, stroke: c(p, 0), "stroke-width": 1, "stroke-opacity": dark ? 0.07 : 0.08, fill: "none" }),
    el("path", { d: grid, stroke: c(p, 0), "stroke-width": 1, "stroke-opacity": dark ? 0.32 : 0.3, fill: "none", mask: `url(#${id}-edge)` }),
    el("g", { "clip-path": `url(#${id}-sunclip)` }, [el("circle", { ...sun, fill: `url(#${id}-sun)` }), ...cuts]),
    el("path", { d: floor, stroke: c(p, 0), "stroke-width": 1.4, "stroke-opacity": dark ? 0.55 : 0.4, fill: "none", "clip-path": `url(#${id}-floor)` }),
    el("rect", { x: 0, y: horizon - 3, width: W, height: 6, fill: c(p, 1), opacity: dark ? 0.25 : 0.15 }),
    el("rect", { x: 0, y: horizon - 1, width: W, height: 2, fill: c(p, 1) }),
  ];
}

/** 6. 和紙: 細い繊維と淡いむら、細い二重の枠。どの文字色でも読める静かな地 */
function drawWashi(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const rand = rng(29), fibers: BgNode[] = [];
  for (let k = 0; k < 360; k++) {
    const long = k < 40;
    const x = rand() * W, y = rand() * H, len = long ? 60 + rand() * 70 : 8 + rand() * 34, ang = rand() * Math.PI;
    const bend = (rand() - 0.5) * len * 0.6, calm = 0.35 + 0.65 * calmFactor(x, y, 120);
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    fibers.push(el("path", {
      d: `M${r1(x)} ${r1(y)}q${r1(dx / 2 - dy * bend / len)} ${r1(dy / 2 + dx * bend / len)} ${r1(dx)} ${r1(dy)}`,
      stroke: mixColor(p.base, c(p, 0), ((long ? 0.12 : 0.16) + rand() * 0.18) * calm),
      "stroke-width": r1(0.5 + rand() * (long ? 0.6 : 1)),
    }));
  }
  return [
    el("defs", {}, [radial(`${id}-m`, c(p, 1), p.tone === "dark" ? 0.12 : 0.18)]),
    full(p.base),
    el("ellipse", { cx: 980, cy: 80, rx: 420, ry: 300, fill: `url(#${id}-m)` }),
    el("ellipse", { cx: 120, cy: 600, rx: 460, ry: 260, fill: `url(#${id}-m)` }),
    el("g", { fill: "none", "stroke-linecap": "round" }, fibers),
    el("rect", { x: 20, y: 24, width: W - 40, height: H - 44, fill: "none", stroke: p.accent, "stroke-width": 1.6, "stroke-opacity": 0.45 }),
    el("rect", { x: 27, y: 31, width: W - 54, height: H - 58, fill: "none", stroke: p.accent, "stroke-width": 0.8, "stroke-opacity": 0.35 }),
  ];
}

/** 7. ストライプ: 右上から立ち上がる太い斜めの帯と、下端の細い帯 */
function drawBands(p: BuiltinBackgroundPalette): BgNode[] {
  const k = 0.25, drop = k * H;
  const band = (x: number, w: number, fill: string) =>
    el("polygon", { points: `${x},0 ${x + w},0 ${r1(x + w - drop)},${H} ${r1(x - drop)},${H}`, fill });
  let pin = "";
  for (let x = -drop; x < W + drop; x += 16) pin += `M${r1(x)} 0L${r1(x - drop)} ${H}`;
  return [
    full(p.base),
    el("path", { d: pin, stroke: c(p, 0), "stroke-width": 1, "stroke-opacity": p.tone === "dark" ? 0.07 : 0.05 }),
    band(964, 10, c(p, 1)),
    band(992, 92, c(p, 0)),
    band(1102, 26, c(p, 2)),
    band(1146, 140, c(p, 1)),
    el("rect", { x: 0, y: 610, width: W, height: 6, fill: c(p, 2) }),
    el("rect", { x: 0, y: 624, width: W, height: 26, fill: c(p, 0) }),
  ];
}

/** 8. ハーフトーン: 右上と左下の角から、網点が中央に向かって小さくなる */
function drawHalftone(p: BuiltinBackgroundPalette): BgNode[] {
  const step = 20, dots: BgNode[] = [];
  for (let j = 0, y = 0; y <= H + step; j++, y += step * 0.866) for (let x = j % 2 ? step / 2 : 0; x <= W + step; x += step) {
    const a = Math.max(0, 1 - Math.hypot(W - x, y) / 520), b = Math.max(0, 1 - Math.hypot(x, H - y) / 420);
    const r = 8.6 * Math.max(a, b) ** 1.15 * calmFactor(x, y, 150);
    if (r < 0.6) continue;
    dots.push(el("circle", { cx: r1(x), cy: r1(y), r: r1(r), fill: a >= b ? c(p, 0) : c(p, 1) }));
  }
  return [full(p.base), el("g", {}, dots)];
}

/** 9. オーロラ: ぼかした色の塊を重ねたメッシュグラデーション。文字の下だけ地の色でならす */
function drawAurora(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const blobs = [
    { cx: 1074, cy: 0, rx: 330, ry: 260, i: 0, a: 0.95 },
    { cx: 780, cy: 660, rx: 560, ry: 220, i: 1, a: 0.85 },
    { cx: 1080, cy: 500, rx: 320, ry: 320, i: 2, a: 0.9 },
    { cx: 80, cy: 680, rx: 420, ry: 170, i: 0, a: 0.6 },
    { cx: 1074, cy: 300, rx: 200, ry: 260, i: 1, a: 0.6 },
  ];
  return [
    el("defs", {}, [
      ...blobs.map((b, k) => radial(`${id}-b${k}`, c(p, b.i), b.a)),
      el("radialGradient", { id: `${id}-veil` }, [
        el("stop", { offset: 0, "stop-color": p.base, "stop-opacity": 0.92 }),
        el("stop", { offset: 0.62, "stop-color": p.base, "stop-opacity": 0.8 }),
        el("stop", { offset: 1, "stop-color": p.base, "stop-opacity": 0 }),
      ]),
    ]),
    full(p.base),
    ...blobs.map((b, k) => el("ellipse", { cx: b.cx, cy: b.cy, rx: b.rx, ry: b.ry, fill: `url(#${id}-b${k})` })),
    el("ellipse", { cx: 440, cy: 250, rx: 680, ry: 400, fill: `url(#${id}-veil)` }),
  ];
}

/** 10. 紙吹雪: 角と縁に色とりどりの紙片。文字の範囲には落とさない */
function drawConfetti(p: BuiltinBackgroundPalette): BgNode[] {
  const rand = rng(7), bits: BgNode[] = [];
  for (let k = 0; k < 420 && bits.length < 150; k++) {
    const x = rand() * W, y = rand() * H, kind = rand(), rot = Math.round(rand() * 180), pick = rand(), size = 0.8 + rand() * 0.6;
    if (rand() > calmFactor(x, y, 110) * 0.95) continue;
    const fill = c(p, Math.floor(pick * p.colors.length));
    const at = `translate(${r1(x)} ${r1(y)}) rotate(${rot}) scale(${r1(size)})`;
    bits.push(kind < 0.42 ? el("rect", { x: -9, y: -3.5, width: 18, height: 7, rx: 1.5, fill, transform: at })
      : kind < 0.64 ? el("circle", { r: 4.5, fill, transform: at })
      : kind < 0.82 ? el("polygon", { points: "0,-7 6.5,5 -6.5,5", fill, transform: at })
      : el("path", { d: "M-12 0q3-6 6 0t6 0t6 0t6 0", fill: "none", stroke: fill, "stroke-width": 3, "stroke-linecap": "round", transform: at }));
  }
  return [full(p.base), ...bits];
}

const pal = (key: string, nameJa: string, nameEn: string, tone: "light" | "dark", base: string,
  colors: string[], ink: string, inkSub: string, accent: string, onAccent: string): BuiltinBackgroundPalette =>
  ({ key, nameJa, nameEn, tone, base, colors, ink, inkSub, accent, onAccent });
const LIGHT_INK = "#101827", LIGHT_SUB = "#334155", DARK_INK = "#F8FAFC", DARK_SUB = "#CBD5E1";

export const BUILTIN_BACKGROUNDS: readonly BuiltinBackground[] = [
  { key: "geometric", nameJa: "ジオメトリック", nameEn: "Geometric", draw: drawGeometric, palettes: [
    pal("teal", "ティール", "Teal", "light", "#F4FBFA", ["#0F766E", "#2DD4BF", "#99F6E4"], LIGHT_INK, LIGHT_SUB, "#0F766E", "#FFFFFF"),
    pal("sunset", "サンセット", "Sunset", "light", "#FFF8F2", ["#EA580C", "#FB7185", "#FDBA74"], LIGHT_INK, LIGHT_SUB, "#9A3412", "#FFFFFF"),
    pal("indigo", "インディゴ", "Indigo", "light", "#F6F7FF", ["#4338CA", "#818CF8", "#C7D2FE"], LIGHT_INK, LIGHT_SUB, "#4338CA", "#FFFFFF"),
    pal("night", "夜祭", "Night Festival", "dark", "#0E1426", ["#2DD4BF", "#FB923C", "#FB7185"], DARK_INK, DARK_SUB, "#2DD4BF", "#06231D"),
  ] },
  { key: "neon", nameJa: "ネオンライン", nameEn: "Neon Lines", draw: drawNeon, palettes: [
    pal("cyber", "シアン×マゼンタ", "Cyan & Magenta", "dark", "#0A0E1F", ["#22D3EE", "#E879F9"], DARK_INK, DARK_SUB, "#22D3EE", "#04141A"),
    pal("lime", "ライム", "Lime", "dark", "#0A1210", ["#A3E635", "#34D399"], DARK_INK, DARK_SUB, "#A3E635", "#0F1A05"),
    pal("sunset", "サンセット", "Sunset", "dark", "#170B1C", ["#FB923C", "#F43F5E"], DARK_INK, DARK_SUB, "#FB923C", "#2A1400"),
    pal("daylight", "デイライト", "Daylight", "light", "#F8FAFC", ["#0891B2", "#DB2777"], LIGHT_INK, LIGHT_SUB, "#0E7490", "#FFFFFF"),
  ] },
  { key: "seigaiha", nameJa: "青海波", nameEn: "Seigaiha Waves", draw: drawSeigaiha, palettes: [
    pal("ai", "藍", "Indigo", "light", "#F7F8FB", ["#1E3A8A", "#3B5BDB"], LIGHT_INK, LIGHT_SUB, "#1E3A8A", "#FFFFFF"),
    pal("shu", "朱", "Vermilion", "light", "#FFF8F3", ["#C2410C", "#E11D48"], LIGHT_INK, LIGHT_SUB, "#B91C1C", "#FFFFFF"),
    pal("matcha", "抹茶", "Matcha", "light", "#F7F9F1", ["#4D7C0F", "#65A30D"], LIGHT_INK, LIGHT_SUB, "#3F6212", "#FFFFFF"),
    pal("kon", "紺に金", "Navy & Gold", "dark", "#0F1A33", ["#D9B36A", "#F2D49B"], DARK_INK, DARK_SUB, "#D9B36A", "#1A1405"),
  ] },
  { key: "asanoha", nameJa: "麻の葉", nameEn: "Asanoha", draw: drawAsanoha, palettes: [
    pal("sakura", "桜", "Sakura", "light", "#FFF6F8", ["#BE185D"], LIGHT_INK, LIGHT_SUB, "#BE185D", "#FFFFFF"),
    pal("ai", "藍", "Indigo", "light", "#F4F7FB", ["#1D4ED8"], LIGHT_INK, LIGHT_SUB, "#1E40AF", "#FFFFFF"),
    pal("kincha", "金茶", "Gold Tea", "light", "#FBF7EE", ["#A16207"], LIGHT_INK, LIGHT_SUB, "#92400E", "#FFFFFF"),
    pal("sumi", "墨に金", "Ink & Gold", "dark", "#16181D", ["#D4AF6A"], DARK_INK, DARK_SUB, "#D4AF6A", "#1A1405"),
  ] },
  { key: "cybergrid", nameJa: "サイバーグリッド", nameEn: "Cyber Grid", draw: drawCyberGrid, palettes: [
    pal("synth", "シンセ", "Synthwave", "dark", "#0D0623", ["#E879F9", "#FBBF24"], DARK_INK, DARK_SUB, "#E879F9", "#22052A"),
    pal("matrix", "マトリクス", "Matrix", "dark", "#03130B", ["#22C55E", "#BEF264"], DARK_INK, DARK_SUB, "#22C55E", "#03130B"),
    pal("ice", "アイス", "Ice", "dark", "#061223", ["#38BDF8", "#A5F3FC"], DARK_INK, DARK_SUB, "#38BDF8", "#061223"),
    pal("blueprint", "ブループリント", "Blueprint", "light", "#EEF4FF", ["#2563EB", "#F97316"], LIGHT_INK, LIGHT_SUB, "#1D4ED8", "#FFFFFF"),
  ] },
  { key: "washi", nameJa: "和紙", nameEn: "Washi Paper", draw: drawWashi, palettes: [
    pal("kinari", "生成り", "Natural", "light", "#FAF6EE", ["#A8977A", "#D6C7A8"], LIGHT_INK, "#44403C", "#0F766E", "#FFFFFF"),
    pal("sakura", "桜", "Sakura", "light", "#FCF3F3", ["#C9A0A6", "#F4C6CD"], LIGHT_INK, "#4C3A3D", "#B4235A", "#FFFFFF"),
    pal("sora", "空", "Sky", "light", "#F2F6FA", ["#94A8C0", "#C6D6EA"], LIGHT_INK, LIGHT_SUB, "#1E40AF", "#FFFFFF"),
    pal("sumi", "墨", "Sumi", "dark", "#22201D", ["#8C8476", "#5C564C"], "#F5F0E6", "#D6D0C4", "#E2B45A", "#22201D"),
  ] },
  { key: "bands", nameJa: "ストライプ", nameEn: "Bold Bands", draw: drawBands, palettes: [
    pal("teal", "ティール×オレンジ", "Teal & Orange", "light", "#FFFFFF", ["#0F766E", "#2DD4BF", "#FB923C"], LIGHT_INK, LIGHT_SUB, "#0F766E", "#FFFFFF"),
    pal("royal", "ロイヤル", "Royal", "light", "#FFFFFF", ["#1E3A8A", "#3B82F6", "#FBBF24"], LIGHT_INK, LIGHT_SUB, "#1E3A8A", "#FFFFFF"),
    pal("berry", "ベリー", "Berry", "light", "#FFFFFF", ["#9D174D", "#F472B6", "#FCD34D"], LIGHT_INK, LIGHT_SUB, "#9D174D", "#FFFFFF"),
    pal("amber", "アンバー", "Amber", "dark", "#111827", ["#F59E0B", "#FDE68A", "#F8FAFC"], DARK_INK, DARK_SUB, "#F59E0B", "#1C1203"),
  ] },
  { key: "halftone", nameJa: "ハーフトーン", nameEn: "Halftone", draw: drawHalftone, palettes: [
    pal("pop", "ポップ", "Pop", "light", "#FFFBEB", ["#F43F5E", "#F59E0B"], LIGHT_INK, LIGHT_SUB, "#E11D48", "#FFFFFF"),
    pal("cyan", "シアン", "Cyan", "light", "#F0FDFF", ["#0891B2", "#6366F1"], LIGHT_INK, LIGHT_SUB, "#0E7490", "#FFFFFF"),
    pal("ink", "インク", "Ink", "light", "#FFFFFF", ["#111827", "#64748B"], LIGHT_INK, LIGHT_SUB, "#111827", "#FFFFFF"),
    pal("gold", "夜に金", "Night Gold", "dark", "#111827", ["#FBBF24", "#2DD4BF"], DARK_INK, DARK_SUB, "#FBBF24", "#1C1203"),
  ] },
  { key: "aurora", nameJa: "オーロラ", nameEn: "Aurora", draw: drawAurora, palettes: [
    pal("northern", "ノーザン", "Northern", "dark", "#0B1023", ["#2DD4BF", "#6366F1", "#A855F7"], DARK_INK, DARK_SUB, "#2DD4BF", "#06231D"),
    pal("dawn", "夜明け", "Dawn", "light", "#FFF9F6", ["#FDBA74", "#F9A8D4", "#C4B5FD"], LIGHT_INK, LIGHT_SUB, "#9A3412", "#FFFFFF"),
    pal("lagoon", "ラグーン", "Lagoon", "light", "#F4FBFF", ["#67E8F9", "#A7F3D0", "#93C5FD"], LIGHT_INK, LIGHT_SUB, "#0E7490", "#FFFFFF"),
    pal("ember", "残り火", "Ember", "dark", "#1A0B0B", ["#F97316", "#E11D48", "#FBBF24"], DARK_INK, "#E7D5CF", "#FDBA74", "#2A1400"),
  ] },
  { key: "confetti", nameJa: "紙吹雪", nameEn: "Festival Confetti", draw: drawConfetti, palettes: [
    pal("festival", "フェス", "Festival", "light", "#FFFDF7", ["#F43F5E", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6"], LIGHT_INK, LIGHT_SUB, "#E11D48", "#FFFFFF"),
    pal("natsumatsuri", "夏祭り", "Summer Night", "dark", "#0E1426", ["#2DD4BF", "#FB923C", "#FB7185", "#FBBF24"], DARK_INK, DARK_SUB, "#2DD4BF", "#06231D"),
    pal("pastel", "パステル", "Pastel", "light", "#FFFFFF", ["#F9A8D4", "#A5B4FC", "#6EE7B7", "#FDE68A"], LIGHT_INK, LIGHT_SUB, "#7C3AED", "#FFFFFF"),
    pal("gold", "ゴールド", "Gold", "light", "#FFFFFF", ["#C99A2E", "#E5C76B", "#9A7420", "#111827"], LIGHT_INK, LIGHT_SUB, "#111827", "#F5D98B"),
  ] },
];

export function findBuiltinBackground(key: string): BuiltinBackground | undefined {
  return BUILTIN_BACKGROUNDS.find(b => b.key === key);
}

/** 背景の要素木。idPrefix は同じページに複数枚並べたときの gradient などの id 衝突を防ぐ */
export function builtinBackgroundNodes(backgroundKey: string, paletteKey: string, idPrefix: string): BgNode[] {
  const bg = findBuiltinBackground(backgroundKey);
  const palette = bg?.palettes.find(p => p.key === paletteKey) ?? bg?.palettes[0];
  return bg && palette ? bg.draw(palette, idPrefix) : [];
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
