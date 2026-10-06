/** 名札（イベントカード）のビルトイン背景。
 *
 * 名札は会場や家庭のプリンタで刷るので、どの背景もインクを食わない線画にしてある。
 * 地は白（ごく淡い色まで）で、塗りつぶしの面・全面のグラデーション・太い帯は使わない。
 * 細い線・輪郭だけの図形・まばらな小さい模様を、文字の載らない角と縁に置く。
 *
 * どれも外部画像を使わず、コードで組み立てる SVG（パラメトリック）なので、
 * どの倍率でもにじまず、印刷でも線がつぶれない。長いパスデータを持たず、
 * ループで要素を並べるだけにしてファイルを小さく保つ。
 *
 * 文字が載る場所（既定テンプレートの見出し・名前・ハンドル・枠の列）は
 * CALM_ZONES として避け、模様は右上・右端・下端に寄せる。
 * 各配色は文字色（ink / inkSub / accent / onAccent）も持ち、白い地の上で濃いインクの文字にする。
 *
 * 描画結果は React に依存しない要素木（BgNode）。React では BuiltinBackgroundLayer で
 * 要素に起こし、書き出しや検査では builtinBackgroundMarkup で文字列にする。 */
const W = 1074;
const H = 650;

export type BgTag = "g" | "rect" | "circle" | "ellipse" | "path" | "polygon" | "defs"
  | "clipPath" | "mask" | "pattern" | "filter" | "feGaussianBlur";
export interface BgNode { tag: BgTag; attrs: Record<string, string | number>; children?: BgNode[] }

export interface BuiltinBackgroundPalette {
  key: string;
  nameJa: string;
  nameEn: string;
  /** 地の色。名札データの background.color にもこの値を入れる。インク節約のため白かごく淡い色だけ */
  base: string;
  /** 模様の線の色（先頭ほど主役） */
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
const c = (p: BuiltinBackgroundPalette, i: number) => p.colors[i % p.colors.length]!;
const pts = (list: number[][]) => list.map(([a, b]) => `${r1(a!)},${r1(b!)}`).join(" ");

/** 1. ジオメトリック: 輪郭だけの三角形が、右と下の縁からまばらに現れる。右上に細い同心円 */
function drawGeometric(p: BuiltinBackgroundPalette): BgNode[] {
  const rand = rng(11);
  const s = 72, h = s * Math.sqrt(3) / 2;
  const tris: BgNode[] = [];
  for (let j = -1; j * h < H + h; j++) for (let i = -1; i * s < W + s; i++) {
    const x = i * s + (j % 2 ? s / 2 : 0), y = j * h;
    for (const tri of [[[x, y + h], [x + s, y + h], [x + s / 2, y]], [[x + s / 2, y], [x + s * 1.5, y], [x + s, y + h]]]) {
      const cx = (tri[0]![0]! + tri[1]![0]! + tri[2]![0]!) / 3, cy = (tri[0]![1]! + tri[1]![1]! + tri[2]![1]!) / 3;
      const f = calmFactor(cx, cy, 240);
      const roll = rand(), pick = rand(), size = rand();
      if (f < 0.2 || roll > f * 0.5) continue;
      // 重心へ縮めて隙間を空け、1つずつ独立した輪郭に見せる
      const k = 0.55 + 0.3 * size;
      tris.push(el("polygon", {
        points: pts(tri.map(([a, b]) => [cx + (a! - cx) * k, cy + (b! - cy) * k])),
        stroke: c(p, pick < 0.5 ? 0 : pick < 0.8 ? 1 : 2),
      }));
    }
  }
  return [
    full(p.base),
    el("g", { fill: "none", stroke: c(p, 2), "stroke-width": 1 }, [80, 92, 104].map(r => el("circle", { cx: 1040, cy: 30, r }))),
    el("g", { fill: "none", "stroke-width": 1.5, "stroke-linejoin": "round" }, tris),
  ];
}

/** 2. 回路ライン: 右上の角を囲む細い弧と、下端を走る回路のような線。節は白抜きの丸 */
function drawCircuit(p: BuiltinBackgroundPalette): BgNode[] {
  const arcs: BgNode[] = [];
  for (let i = 0; i < 7; i++) {
    const r = 64 + i * 15;
    arcs.push(el("path", { d: `M${W - r} 0A${r} ${r} 0 0 0 ${W} ${r}`, stroke: c(p, i % 2), "stroke-width": i % 3 ? 1 : 1.8 }));
  }
  const nodes = [[700, 618], [742, 600], [760, 634], [22, 470], [22, 180]].map(([x, y], k) =>
    el("circle", { cx: x!, cy: y!, r: 4.5, fill: p.base, stroke: c(p, k % 2), "stroke-width": 1.6 }));
  return [
    full(p.base),
    el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
      ...arcs,
      el("path", { d: `M0 618H700L742 600H${W}`, stroke: c(p, 0), "stroke-width": 1.6 }),
      el("path", { d: `M0 634H${W}`, stroke: c(p, 1), "stroke-width": 1 }),
      el("path", { d: "M22 180V470", stroke: c(p, 1), "stroke-width": 1.2 }),
      el("path", { d: "M10 230V420", stroke: c(p, 0), "stroke-width": 0.8 }),
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

/** 3. 青海波: 重なる同心円の波を細い線で。1枚のタイル（2R×R）を敷き詰め、文字の下はマスクで消す。
 * タイルに掛かる円を上の段から順に描くので、外の円の白い塗りが上の段のうしろを隠し、
 * 無限に並べたときと同じ重なりになる（白はインクを使わない） */
function drawSeigaiha(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  const R = 34, scale: BgNode[] = [];
  for (const cy of [-R / 2, 0, R / 2, R, R * 1.5]) for (const cx of (cy / (R / 2)) % 2 ? [-R, R, 3 * R] : [0, 2 * R]) {
    scale.push(
      el("circle", { cx, cy, r: R, fill: p.base }),
      el("circle", { cx, cy, r: R, stroke: c(p, 0) }),
      el("circle", { cx, cy, r: R * 0.7, stroke: c(p, 1) }),
      el("circle", { cx, cy, r: R * 0.4, stroke: c(p, 1) }),
    );
  }
  return [
    el("defs", {}, [
      el("pattern", { id: `${id}-wave`, width: 2 * R, height: R, patternUnits: "userSpaceOnUse", x: 3, y: 0 },
        [el("g", { fill: "none", "stroke-width": 1 }, scale)]),
      ...calmMask(id, 55),
    ]),
    full(p.base),
    el("g", { mask: `url(#${id}-calm)` }, [full(`url(#${id}-wave)`)]),
  ];
}

/** 4. 麻の葉: 三角格子の各三角形に重心への細い線を引く。文字の下でもごく淡く続く */
function drawAsanoha(p: BuiltinBackgroundPalette): BgNode[] {
  // 濃さを10段に丸め、段ごとに1本のパスにまとめる（要素数とファイルサイズを抑える）
  const s = 66, h = s * Math.sqrt(3) / 2, buckets = new Map<number, string>();
  for (let j = -1; j * h < H + h; j++) for (let i = -1; i * s < W + s; i++) {
    const x = i * s + (j % 2 ? s / 2 : 0), y = j * h;
    const tri = (corners: number[][], edges: boolean) => {
      const cx = (corners[0]![0]! + corners[1]![0]! + corners[2]![0]!) / 3, cy = (corners[0]![1]! + corners[1]![1]! + corners[2]![1]!) / 3;
      const level = Math.round(calmFactor(cx, cy, 230) * 10);
      const P = corners.map(([a1, b1]) => `${Math.round(a1!)} ${Math.round(b1!)}`);
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
    el("g", { fill: "none", "stroke-width": 0.8, "stroke-linejoin": "round" }, [...buckets].sort(([a], [b]) => a - b)
      .map(([level, d]) => el("path", { d, stroke: mixColor(p.base, c(p, 0), 0.06 + 0.05 * level) }))),
  ];
}

/** 5. サイバーグリッド: 細い方眼が右と下の縁で濃くなり、右上に輪郭だけの太陽、下に遠近の床の線 */
function drawCyberGrid(p: BuiltinBackgroundPalette, id: string): BgNode[] {
  let grid = "";
  for (let x = 0; x <= W; x += 40) grid += `M${x} 0V${H}`;
  for (let y = 10; y <= H; y += 40) grid += `M0 ${y}H${W}`;
  const horizon = 600, vx = 930;
  let floor = "";
  for (let x = -2400; x <= 4200; x += 110) floor += `M${vx} ${horizon}L${x} ${H}`;
  for (let k = 1; k <= 4; k++) floor += `M0 ${r1(horizon + (H - horizon) * (k / 4) ** 1.6)}H${W}`;
  const sun = { cx: 1000, cy: 118, r: 56 };
  let cuts = "";
  for (let k = 0; k < 6; k++) cuts += `M${sun.cx - sun.r} ${r1(sun.cy + 6 + k * 9 + k * k * 0.5)}h${sun.r * 2}`;
  // 縁の方眼は、右端と下端の帯の中だけに引き直す
  let edgeGrid = "";
  for (let x = 960; x <= W; x += 20) edgeGrid += `M${x} 0V${H}`;
  for (let y = 490; y <= H; y += 20) edgeGrid += `M0 ${y}H${W}`;
  return [
    el("defs", {}, [
      el("clipPath", { id: `${id}-sunclip` }, [el("circle", sun)]),
      el("clipPath", { id: `${id}-floor` }, [el("rect", { x: 0, y: horizon, width: W, height: H - horizon })]),
    ]),
    full(p.base),
    el("path", { d: grid, stroke: mixColor(p.base, c(p, 0), 0.12), "stroke-width": 0.6, fill: "none" }),
    el("path", { d: edgeGrid, stroke: mixColor(p.base, c(p, 0), 0.3), "stroke-width": 0.6, fill: "none" }),
    el("g", { fill: "none", stroke: c(p, 1) }, [
      el("circle", { ...sun, "stroke-width": 1.6 }),
      el("circle", { ...sun, r: sun.r + 8, "stroke-width": 0.8 }),
      el("path", { d: cuts, "stroke-width": 1, "clip-path": `url(#${id}-sunclip)` }),
    ]),
    el("path", { d: floor, stroke: c(p, 0), "stroke-width": 0.9, "stroke-opacity": 0.6, fill: "none", "clip-path": `url(#${id}-floor)` }),
    el("path", { d: `M0 ${horizon}H${W}`, stroke: c(p, 1), "stroke-width": 1.4, fill: "none" }),
  ];
}

/** 6. 和紙: 細い繊維と、細い二重の枠。どの文字色でも読める静かな地 */
function drawWashi(p: BuiltinBackgroundPalette): BgNode[] {
  const rand = rng(29), fibers: BgNode[] = [];
  for (let k = 0; k < 300; k++) {
    const long = k < 40;
    const x = rand() * W, y = rand() * H, len = long ? 60 + rand() * 70 : 8 + rand() * 34, ang = rand() * Math.PI;
    const bend = (rand() - 0.5) * len * 0.6, calm = 0.35 + 0.65 * calmFactor(x, y, 120);
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    fibers.push(el("path", {
      d: `M${r1(x)} ${r1(y)}q${r1(dx / 2 - dy * bend / len)} ${r1(dy / 2 + dx * bend / len)} ${r1(dx)} ${r1(dy)}`,
      stroke: mixColor(p.base, c(p, 0), ((long ? 0.12 : 0.16) + rand() * 0.18) * calm),
      "stroke-width": r1(0.4 + rand() * (long ? 0.5 : 0.7)),
    }));
  }
  return [
    full(p.base),
    el("g", { fill: "none", "stroke-linecap": "round" }, fibers),
    el("rect", { x: 20, y: 24, width: W - 40, height: H - 44, fill: "none", stroke: c(p, 1), "stroke-width": 1.4 }),
    el("rect", { x: 27, y: 31, width: W - 54, height: H - 58, fill: "none", stroke: c(p, 1), "stroke-width": 0.6 }),
  ];
}

/** 7. ピンストライプ: 右端に細い平行の斜線を束ね、下端に細い横線を数本 */
function drawPinstripe(p: BuiltinBackgroundPalette): BgNode[] {
  const k = 0.25, drop = k * H;
  const lines: BgNode[] = [];
  const stripes: [number, number, number][] = [ // [上端の x, 線の太さ, 色]
    [968, 1, 1], [984, 2, 0], [992, 1, 0], [1000, 1, 0], [1008, 2, 0], [1030, 1, 2],
    [1052, 1, 1], [1062, 2.4, 1], [1072, 1, 1], [1100, 1, 2], [1120, 2, 0], [1130, 1, 0], [1160, 1, 2], [1190, 1.4, 1],
  ];
  for (const [x, w, i] of stripes)
    lines.push(el("path", { d: `M${x} 0L${r1(x - drop)} ${H}`, stroke: c(p, i), "stroke-width": w }));
  for (const [y, w, i] of [[608, 1, 2], [616, 2, 0], [622, 1, 0], [634, 1, 1]] as const)
    lines.push(el("path", { d: `M0 ${y}H${W}`, stroke: c(p, i), "stroke-width": w }));
  return [full(p.base), el("g", { fill: "none" }, lines)];
}

/** 8. ハーフトーン: 右上と左下の角から、輪郭だけの網点が中央に向かって小さくなる */
function drawHalftone(p: BuiltinBackgroundPalette): BgNode[] {
  const step = 22, rings: [string, string][] = [];
  for (let j = 0, y = 0; y <= H + step; j++, y += step * 0.866) for (let x = j % 2 ? step / 2 : 0; x <= W + step; x += step) {
    const a = Math.max(0, 1 - Math.hypot(W - x, y) / 520), b = Math.max(0, 1 - Math.hypot(x, H - y) / 420);
    const r = 8 * Math.max(a, b) ** 1.15 * calmFactor(x, y, 150);
    if (r < 1.6) continue;
    rings.push([a >= b ? "a" : "b", `M${r1(x - r)} ${r1(y)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0`]);
  }
  // 色ごとに1本のパスにまとめる
  const d = (side: string) => rings.filter(([s]) => s === side).map(([, path]) => path).join("");
  return [
    full(p.base),
    el("g", { fill: "none", "stroke-width": 1.1 }, [el("path", { d: d("a"), stroke: c(p, 0) }), el("path", { d: d("b"), stroke: c(p, 1) })]),
  ];
}

/** 9. オーロラ: 右上から右端へ流れる細い等高線と、下端を揺れる細い線。色は配色の順に移り変わる */
function drawAurora(p: BuiltinBackgroundPalette): BgNode[] {
  const lines: BgNode[] = [];
  const shade = (t: number) => {
    const scaled = t * (p.colors.length - 1), i = Math.min(p.colors.length - 2, Math.floor(scaled));
    return mixColor(c(p, i), c(p, i + 1), scaled - i);
  };
  const n = 10;
  for (let k = 0; k < n; k++) {
    const rx = 56 + k * 8.5, ry = 210 + k * 30;
    let d = "";
    for (let s = 0; s <= 48; s++) {
      const th = (s / 48) * Math.PI / 2, wob = 1 + 0.05 * Math.sin(th * 7 + k * 0.6);
      d += `${s ? "L" : "M"}${r1(W - rx * Math.cos(th) * wob)} ${r1(ry * Math.sin(th) * wob)}`;
    }
    lines.push(el("path", { d, stroke: shade(k / (n - 1)), "stroke-width": k % 3 ? 0.9 : 1.6 }));
  }
  for (let k = 0; k < 6; k++) {
    let d = "";
    for (let x = 0; x <= W; x += 18) d += `${x ? "L" : "M"}${x} ${r1(612 + k * 6 + 9 * Math.sin(x / 140 + k * 0.5))}`;
    lines.push(el("path", { d, stroke: shade(1 - k / 5), "stroke-width": k % 2 ? 0.9 : 1.4 }));
  }
  return [full(p.base), el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, lines)];
}

/** 10. 紙吹雪: 角と縁に、輪郭だけの紙片がまばらに舞う。文字の範囲には落とさない */
function drawConfetti(p: BuiltinBackgroundPalette): BgNode[] {
  const rand = rng(7), bits: BgNode[] = [];
  for (let k = 0; k < 420 && bits.length < 80; k++) {
    const x = rand() * W, y = rand() * H, kind = rand(), rot = Math.round(rand() * 180), pick = rand(), size = 0.8 + rand() * 0.6;
    if (rand() > calmFactor(x, y, 110) * 0.6) continue;
    const stroke = c(p, Math.floor(pick * p.colors.length));
    const at = `translate(${r1(x)} ${r1(y)}) rotate(${rot}) scale(${r1(size)})`;
    bits.push(kind < 0.4 ? el("rect", { x: -9, y: -3.5, width: 18, height: 7, rx: 1.5, stroke, transform: at })
      : kind < 0.6 ? el("circle", { r: 4.5, stroke, transform: at })
      : kind < 0.8 ? el("polygon", { points: "0,-7 6.5,5 -6.5,5", stroke, transform: at })
      : el("path", { d: "M-12 0q3-6 6 0t6 0t6 0t6 0", stroke, "stroke-linecap": "round", transform: at }));
  }
  return [full(p.base), el("g", { fill: "none", "stroke-width": 1.4, "stroke-linejoin": "round" }, bits)];
}

const pal = (key: string, nameJa: string, nameEn: string, base: string,
  colors: string[], accent: string, ink = INK, inkSub = INK_SUB): BuiltinBackgroundPalette =>
  ({ key, nameJa, nameEn, base, colors, ink, inkSub, accent, onAccent: "#FFFFFF" });
const INK = "#101827", INK_SUB = "#334155", WHITE = "#FFFFFF";

export const BUILTIN_BACKGROUNDS: readonly BuiltinBackground[] = [
  { key: "geometric", nameJa: "ジオメトリック", nameEn: "Geometric", draw: drawGeometric, palettes: [
    pal("teal", "ティール", "Teal", WHITE, ["#0F766E", "#2DD4BF", "#F59E0B"], "#0F766E"),
    pal("sunset", "サンセット", "Sunset", WHITE, ["#EA580C", "#FB7185", "#FBBF24"], "#9A3412"),
    pal("indigo", "インディゴ", "Indigo", WHITE, ["#4338CA", "#818CF8", "#38BDF8"], "#4338CA"),
  ] },
  { key: "circuit", nameJa: "回路ライン", nameEn: "Circuit Lines", draw: drawCircuit, palettes: [
    pal("daylight", "デイライト", "Daylight", WHITE, ["#0891B2", "#DB2777"], "#0E7490"),
    pal("mint", "ミント", "Mint", WHITE, ["#059669", "#84CC16"], "#047857"),
    pal("violet", "バイオレット", "Violet", WHITE, ["#7C3AED", "#F97316"], "#6D28D9"),
  ] },
  { key: "seigaiha", nameJa: "青海波", nameEn: "Seigaiha Waves", draw: drawSeigaiha, palettes: [
    pal("ai", "藍", "Indigo", WHITE, ["#1E3A8A", "#6B8CEB"], "#1E3A8A"),
    pal("shu", "朱", "Vermilion", WHITE, ["#C2410C", "#F08A7A"], "#B91C1C"),
    pal("matcha", "抹茶", "Matcha", WHITE, ["#4D7C0F", "#9CC25A"], "#3F6212"),
    pal("kin", "金", "Gold", WHITE, ["#A07A2C", "#D9B36A"], "#7C5A12"),
  ] },
  { key: "asanoha", nameJa: "麻の葉", nameEn: "Asanoha", draw: drawAsanoha, palettes: [
    pal("sakura", "桜", "Sakura", WHITE, ["#BE185D"], "#BE185D"),
    pal("ai", "藍", "Indigo", WHITE, ["#1D4ED8"], "#1E40AF"),
    pal("kincha", "金茶", "Gold Tea", WHITE, ["#A16207"], "#92400E"),
    pal("sumi", "墨", "Sumi", WHITE, ["#374151"], "#374151"),
  ] },
  { key: "cybergrid", nameJa: "サイバーグリッド", nameEn: "Cyber Grid", draw: drawCyberGrid, palettes: [
    pal("blueprint", "ブループリント", "Blueprint", WHITE, ["#2563EB", "#F97316"], "#1D4ED8"),
    pal("synth", "シンセ", "Synthwave", WHITE, ["#C026D3", "#F59E0B"], "#A21CAF"),
    pal("matrix", "マトリクス", "Matrix", WHITE, ["#16A34A", "#0891B2"], "#15803D"),
  ] },
  { key: "washi", nameJa: "和紙", nameEn: "Washi Paper", draw: drawWashi, palettes: [
    pal("kinari", "生成り", "Natural", "#FFFDF8", ["#A8977A", "#B9A57E"], "#0F766E", INK, "#44403C"),
    pal("sakura", "桜", "Sakura", "#FFFBFB", ["#C9A0A6", "#D98A98"], "#B4235A", INK, "#4C3A3D"),
    pal("sora", "空", "Sky", "#FBFDFF", ["#94A8C0", "#8FA9D0"], "#1E40AF"),
  ] },
  { key: "pinstripe", nameJa: "ピンストライプ", nameEn: "Pinstripes", draw: drawPinstripe, palettes: [
    pal("teal", "ティール×オレンジ", "Teal & Orange", WHITE, ["#0F766E", "#2DD4BF", "#FB923C"], "#0F766E"),
    pal("royal", "ロイヤル", "Royal", WHITE, ["#1E3A8A", "#3B82F6", "#FBBF24"], "#1E3A8A"),
    pal("berry", "ベリー", "Berry", WHITE, ["#9D174D", "#F472B6", "#F59E0B"], "#9D174D"),
  ] },
  { key: "halftone", nameJa: "ハーフトーン", nameEn: "Halftone Rings", draw: drawHalftone, palettes: [
    pal("pop", "ポップ", "Pop", WHITE, ["#F43F5E", "#F59E0B"], "#E11D48"),
    pal("cyan", "シアン", "Cyan", WHITE, ["#0891B2", "#6366F1"], "#0E7490"),
    pal("ink", "インク", "Ink", WHITE, ["#334155", "#94A3B8"], "#111827"),
  ] },
  { key: "aurora", nameJa: "オーロラライン", nameEn: "Aurora Lines", draw: drawAurora, palettes: [
    pal("northern", "ノーザン", "Northern", WHITE, ["#14B8A6", "#6366F1", "#A855F7"], "#0F766E"),
    pal("dawn", "夜明け", "Dawn", WHITE, ["#F97316", "#EC4899", "#8B5CF6"], "#9A3412"),
    pal("lagoon", "ラグーン", "Lagoon", WHITE, ["#06B6D4", "#10B981", "#3B82F6"], "#0E7490"),
  ] },
  { key: "confetti", nameJa: "紙吹雪", nameEn: "Festival Confetti", draw: drawConfetti, palettes: [
    pal("festival", "フェス", "Festival", WHITE, ["#F43F5E", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6"], "#E11D48"),
    pal("pastel", "パステル", "Pastel", WHITE, ["#EC8FC0", "#8E9CF5", "#4FD1A5", "#E8C547"], "#7C3AED"),
    pal("gold", "ゴールド", "Gold", WHITE, ["#C99A2E", "#E5C76B", "#9A7420", "#475569"], "#111827"),
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
