import type { LiveElement, LiveScene, LiveSetContent } from "./liveSets.js";
export type VisualStyle = "glow" | "signal";
const colors = {
  glow: { bg: "#0E1426", panel: "#1A2737", ink: "#EAF0F7", accent: "#FB923C", pale: "#F4E8DA" },
  signal: { bg: "#0A1120", panel: "#18303B", ink: "#F1F4EF", accent: "#2DD4BF", pale: "#E9F0EC" },
};
type P = Partial<LiveElement>;
function el(id: string, type: LiveElement["type"], x: number, y: number, w: number, h: number, props: P = {}): LiveElement {
  return { id, type, x, y, w, h, rotation: 0, ...props };
}
function text(id: string, label: string, x: number, y: number, w: number, h: number, color: string, size = 24, props: P = {}): LiveElement {
  return el(id, "text", x, y, w, h, { text: label, color, fontSize: size, fontFamily: "Plus Jakarta Sans", ...props });
}
function info(id: string, field: "title" | "datetime", x: number, y: number, w: number, h: number, color: string, size: number, props: P = {}): LiveElement {
  return el(id, "eventInfo", x, y, w, h, { field, color, fontSize: size, fontFamily: "Plus Jakarta Sans", ...props });
}
function shape(id: string, x: number, y: number, w: number, h: number, fill: string, props: P = {}): LiveElement {
  return el(id, "shape", x, y, w, h, { shape: "rectangle", fill, ...props });
}
function motif(id: string, kind: "lantern" | "halo" | "brackets" | "grid" | "ticks", x: number, y: number, w: number, h: number, color: string, props: P = {}): LiveElement {
  return el(id, "motif", x, y, w, h, { motif: kind, color, ...props });
}
function parts(style: VisualStyle) {
  const c = colors[style];
  const isGlow = style === "glow";
  const label = (id: string, value: string, x: number, y: number, w: number, h: number, size = 20, color = c.ink) => text(id, value, x, y, w, h, color, size);
  return isGlow ? [
    { id: "name", title: "琥珀の氏名帯", elements: [shape("bg", 0, 0, 330, 84, c.panel, { radius: 14 }), shape("rail", 0, 0, 5, 84, c.accent), motif("light", "lantern", 16, 18, 32, 38, c.accent), label("name", "氏名を入力", 58, 8, 260, 38, 24), label("role", "役割を入力", 58, 48, 258, 30, 16, c.pale), shape("line", 58, 81, 245, 2, c.accent)] },
    { id: "camera", title: "提灯カメラ額", elements: [shape("frame", 0, 0, 304, 188, c.accent, { radius: 16 }), el("camera", "camera", 6, 6, 292, 164, { radius: 12, fit: "cover" }), motif("light", "lantern", 266, -18, 30, 46, c.accent), label("caption", "", 16, 167, 268, 20, 16)] },
    { id: "chapter", title: "祭り章リボン", elements: [shape("back", 0, 0, 490, 110, c.panel, { radius: 12 }), shape("rail", 0, 0, 95, 110, c.accent), label("number", "01", 16, 20, 65, 62, 38, c.bg), label("kind", "章タイトル", 115, 14, 340, 27, 17, c.accent), label("title", "タイトルを入力", 115, 42, 355, 58, 32), shape("line", 115, 103, 345, 2, c.accent)] },
    { id: "break", title: "灯籠の休憩札", elements: [shape("back", 0, 0, 470, 160, c.panel, { radius: 16 }), motif("light", "lantern", 24, 38, 54, 78, c.accent), label("title", "休憩中", 110, 24, 330, 72, 42), label("message", "", 110, 101, 325, 38, 18), shape("chip", 450, 18, 4, 120, c.accent)] },
  ] : [
    { id: "name", title: "氏名レール", elements: [shape("back", 0, 0, 340, 86, c.panel), shape("rail", 0, 0, 5, 86, c.accent), label("index", "", 16, 8, 34, 30, 16, c.accent), label("name", "氏名を入力", 58, 9, 255, 39, 25), label("role", "役割を入力", 58, 48, 250, 29, 16), shape("line", 58, 80, 250, 2, c.accent)] },
    { id: "camera", title: "開放カメラ角", elements: [el("camera", "camera", 9, 9, 300, 170, { fit: "cover" }), motif("top", "brackets", 0, 0, 36, 36, c.accent), motif("bottom", "brackets", 282, 152, 36, 36, c.accent, { rotation: 180 }), label("caption", "", 14, 160, 260, 26, 16)] },
    { id: "chapter", title: "番号付き章カード", elements: [shape("back", 0, 0, 490, 112, c.pale), shape("numberBack", 0, 0, 98, 112, c.accent), label("number", "01", 21, 27, 62, 61, 38, c.bg), label("title", "タイトルを入力", 120, 15, 350, 66, 34, c.bg), label("kind", "", 120, 79, 350, 28, 17, c.bg)] },
    { id: "info", title: "情報レール", elements: [shape("back", 0, 0, 510, 94, c.panel), shape("rail", 0, 0, 5, 94, c.accent), info("title", "title", 20, 10, 470, 45, c.ink, 23), label("detail", "", 20, 54, 470, 32, 16), shape("line", 20, 89, 465, 2, c.accent)] },
  ];
}
export function visualParts(style: VisualStyle) { return parts(style); }

/** Version 1: fixed editable primitives expanded only at creation, never injected into old sets. */
export function visualLiveSetContent(style: VisualStyle): LiveSetContent {
  const c = colors[style], glow = style === "glow";
  const scene = (id: string, name: string, elements: LiveElement[]): LiveScene => ({ id: `v1-${style}-${id}`, name, background: glow ? id === "op" ? "linear-gradient(125deg, #0E1426 25%, #4A2B27 66%, #0E1426 100%)" : "linear-gradient(130deg, #10263D 0%, #0E1426 54%, #253039 100%)" : c.bg, elements: [...(!glow && ["wait", "op", "keynote", "break", "ed"].includes(id) ? [motif("ambient-grid", "grid", 28, 36, 910, 456, c.accent, { opacity: 0.08 })] : []), ...elements].map(e => ({ ...e, id: `v1-${style}-${id}-${e.id}` })) });
  const top = (id: string) => [
    ...(!glow ? [el(`${id}-outline`, "shape", 32, 30, 896, 480, { shape: "rectangle", stroke: "#607C83", strokeWidth: 1, opacity: 0.5 }), shape(`${id}-rail`, 32, 30, 6, 480, c.accent)] : []),
    shape(`${id}-top`, 48, 42, 864, 2, c.accent),
    text(`${id}-style`, glow ? "灯り / GLOW" : "輪郭 / SIGNAL", glow ? 60 : 65, 58, 215, 29, c.ink, 16, { bold: true }),
    motif(`${id}-mark`, glow ? "lantern" : "ticks", 848, 44, 40, 40, c.accent, !glow ? { motion: { kind: "colorCycle", seconds: 18, colors: ["#2DD4BF", "#7DD3FC"] } } : {}),
  ];
  const foot = (id: string) => [shape(`${id}-foot`, 48, 498, 864, 2, c.accent)];
  const deck = (id: string, x: number, y: number, w: number, h: number) => [shape(`${id}-panel`, x - 7, y - 7, w + 14, h + 14, c.pale, { radius: glow ? 12 : 2 }), el(`${id}-deck`, "deck", x, y, w, h)];
  // No empty speaker strip in a new set. Staff may insert and edit the separate name-band card.
  const keynote = glow ? [
    motif("key-halo", "halo", 692, 73, 210, 210, c.accent, { opacity: 0.33 }),
    text("key-label", "講演", 328, 62, 160, 31, c.accent, 18, { bold: true }),
    ...deck("key", 56, 115, 536, 299), shape("key-deck-accent", 56, 105, 536, 4, c.accent),
    shape("cam-frame", 608, 115, 304, 252, c.accent, { radius: 14 }), el("cam", "camera", 614, 121, 292, 240, { fit: "cover", radius: 10 }),
    motif("key-lamp", "lantern", 911, 91, 29, 50, c.accent, { opacity: 0.8 }),
  ] : [
    text("key-label", "講演", 328, 62, 160, 31, c.accent, 18, { bold: true }),
    shape("cam-panel", 58, 123, 316, 263, c.panel),
    el("cam", "camera", 66, 132, 300, 246, { fit: "cover" }),
    motif("cam-corner-top", "brackets", 57, 123, 44, 44, c.accent),
    motif("cam-corner-bottom", "brackets", 338, 347, 44, 44, c.accent, { rotation: 180 }),
    ...deck("key", 397, 116, 501, 282), shape("key-deck-accent", 390, 105, 515, 4, c.accent),
  ];
  const keynoteFooter = [shape("key-footer", 58, 435, 844, 52, c.panel), shape("key-footer-rail", 58, 435, 5, 52, c.accent), info("key-event", "title", 82, 443, 787, 35, c.ink, 19)];
  const live = el("live", "liveIndicator", glow ? 766 : 75, 59, 125, 36, { text: "LIVE", color: c.accent, fontSize: 19 });
  return { scenes: [
    scene("wait", "開始前待機", [
      ...(glow ? [motif("wait-halo", "halo", 682, 82, 224, 224, c.accent, { opacity: 0.3 })] : []),
      ...top("wait"),
      shape("wait-panel", 48, 129, glow ? 660 : 535, glow ? 302 : 267, c.panel, { radius: glow ? 20 : 0, ...(glow ? { stroke: "#607C83", strokeWidth: 1 } : {}) }),
      text("wait-label", "開始前待機", 78, 150, 180, 28, c.accent, 16, { bold: true }),
      info("wait-title", "title", 76, glow ? 187 : 154, glow ? 604 : 470, glow ? 155 : 210, c.ink, glow ? 49 : 40, { bold: true }),
      ...(glow ? [
        shape("wait-divider", 78, 349, 574, 1, c.pale, { opacity: 0.42 }),
        info("wait-date", "datetime", 78, 365, 587, 47, c.accent, 21, { requiresEventDatetime: true }),
        motif("wait-light-near", "lantern", 743, 156, 54, 92, c.accent, { motion: { kind: "rotation", direction: "clockwise", seconds: 30 } }),
        motif("wait-light-far", "lantern", 841, 218, 54, 92, c.accent),
      ] : [
        shape("wait-underline", 76, 350, 166, 4, c.accent),
        shape("date-panel", 598, 143, 315, 166, c.panel, { requiresEventDatetime: true, stroke: "#607C83", strokeWidth: 1 }),
        text("date-label", "イベント日時", 610, 154, 267, 24, c.accent, 16, { bold: true, requiresEventDatetime: true }),
        info("wait-date", "datetime", 610, 184, 286, 68, c.accent, 25, { bold: true, requiresEventDatetime: true }),
        shape("date-divider", 610, 260, 268, 1, c.accent, { opacity: 0.4, requiresEventDatetime: true }),
        info("date-title", "title", 610, 269, 286, 27, c.ink, 16, { requiresEventDatetime: true }),
      ]), live, ...foot("wait"),
    ]),
    scene("op", "オープニング", [...top("op"), shape("op-panel", 60, 140, 830, 230, c.panel), info("op-title", "title", 85, 163, 775, 145, c.ink, 48, { bold: true }), info("op-date", "datetime", 85, 317, 750, 41, c.accent, 22, { requiresEventDatetime: true }), ...foot("op")]),
    scene("keynote", "講演", [...top("key"), ...keynote, ...keynoteFooter, live, ...foot("key")]),
    scene("deck", "全画面資料", [...deck("full", 56, 55, 848, 427), ...foot("deck")]),
    scene("camera", "全画面カメラ", [el("full-camera", "camera", 56, 55, 848, 370, { fit: "cover", radius: glow ? 12 : 0 }), shape("cam-footer", 56, 438, 848, 49, c.panel), shape("cam-footer-rail", 56, 438, 5, 49, c.accent), info("cam-event", "title", 79, 445, 795, 34, c.ink, 19), ...foot("cam")]),
    scene("break", "休憩中", [...top("break"), shape("break-panel", 115, 148, 730, 246, c.panel, { radius: glow ? 20 : 0 }), text("break-label", "休憩中", 170, 209, 620, 102, c.ink, 55, { bold: true, align: "center" }), motif("break-center", glow ? "lantern" : "ticks", 772, 181, 45, 57, c.accent), ...foot("break")]),
    scene("ed", "エンディング", [...top("ed"), text("thanks", "ご視聴ありがとうございました", 95, 176, 770, 90, c.ink, 42, { bold: true, align: "center" }), info("ed-title", "title", 115, 299, 730, 75, c.accent, 27, { align: "center" }), ...foot("ed")]),
  ] };
}
