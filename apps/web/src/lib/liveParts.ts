import { visualParts } from "@eventer/shared";
import type { LiveElement, LiveScene, VisualStyle } from "@eventer/shared";
import { uid } from "./editor/uid.js";
import {
  newCameraElement,
  newDeckElement,
  newEventInfoElement,
  newImageElement,
  newTextElement,
} from "./liveScenes.js";

/**
 * 配信セット編集の「パーツを追加」で選べるもの (#566)。
 *
 * 置いたばかりの既定値はここが持つ。見た目のスタイル（灯り・輪郭・白磁）で色が変わるものは、
 * 開いているシーンから読んだスタイルを受け取る。選ぶ画面（LiveAddPartDialog）は並びと
 * 設定欄だけを持ち、値はここから貰う。
 */
export type LivePartKind =
  | "text" | "image" | "camera" | "deck" | "eventInfo"
  | "chat" | "marquee" | "clock" | "countdown" | "liveIndicator" | "motif" | "flameFrame";

/** 「基本」の並び */
export const LIVE_BASIC_PARTS = ["text", "image", "camera", "deck", "eventInfo"] as const satisfies readonly LivePartKind[];
/** 「配信の演出」の並び */
export const LIVE_STREAM_PARTS = ["chat", "marquee", "clock", "countdown", "liveIndicator", "motif", "flameFrame"] as const satisfies readonly LivePartKind[];

/** 選んだら設定欄を挟まずにそのまま置く種類。置いてから右の設定欄で整える。
 * カメラは映す番号を選ぶので 2 段目を挟む (#570) */
const ADD_WITHOUT_SETTINGS: ReadonlySet<LivePartKind> = new Set(["deck"]);
export const livePartNeedsSettings = (kind: LivePartKind) => !ADD_WITHOUT_SETTINGS.has(kind);

/** 回転装飾の種類。選ぶ画面の並び順 */
export const LIVE_MOTIF_KINDS = ["lantern", "halo", "brackets", "grid", "ticks"] as const;

/** 開いているシーンの見た目のスタイル。テンプレートの id と白磁の地色から読む */
export function sceneVisualStyle(scene: LiveScene | undefined): VisualStyle {
  if (scene?.id.startsWith("v1-hakuji-") || scene?.background === "#F6F2EA") return "hakuji";
  if (scene?.id.startsWith("v1-signal-")) return "signal";
  return "glow";
}

/** 明るい地のシーンか。見本（カメラ・画像の枠）の色を合わせるのに使う */
export const isLightLiveScene = (scene: LiveScene | undefined) =>
  Boolean(scene && (scene.id.startsWith("v1-hakuji-") || scene.background === "#F6F2EA"));

/**
 * 置く要素の既定値。画像は選ばせてから src を入れるので、ここでは空のまま返す。
 * 流れる案内の最初の文言だけは画面の言語で入れるので、呼ぶ側から受け取る。
 */
export function newLivePartElement(kind: LivePartKind, style: VisualStyle, marqueeText: string): LiveElement {
  const ink = style === "hakuji" ? "#203146" : "#EAF0F7";
  const make = (type: LiveElement["type"], props: Partial<LiveElement>): LiveElement => ({ id: uid(), type, x: 100, y: 410, w: 480, h: 48, rotation: 0, ...props });
  switch (kind) {
    case "text": return newTextElement();
    case "image": return newImageElement("");
    case "camera": return newCameraElement();
    case "deck": return newDeckElement();
    case "eventInfo": return newEventInfoElement();
    case "chat": return make("chat", { x: 28, y: 310, w: 380, h: 175, chatStyle: style, chatRows: 3, chatSeconds: 20 });
    case "marquee": return make("marquee", { text: marqueeText, seconds: 20, gap: 32, direction: "left", fill: style === "hakuji" ? "#FFFFFF" : style === "glow" ? "#1A2737" : "#18303B", color: ink });
    case "clock": return make("clock", { x: 680, y: 435, w: 210, timezone: "Asia/Tokyo", showSeconds: true, color: ink, fill: style === "hakuji" ? "#FFFFFF" : undefined });
    case "countdown": return make("countdown", { x: 680, y: 435, w: 210, target: "eventStart", zero: "stop", timezone: "Asia/Tokyo", color: ink, fill: style === "hakuji" ? "#FFFFFF" : undefined });
    case "liveIndicator": return make("liveIndicator", { x: 760, y: 57, w: 130, h: 36, text: "LIVE", color: style === "hakuji" ? "#FFFFFF" : "#2DD4BF", fill: style === "hakuji" ? "#203146" : undefined });
    case "motif": return make("motif", { x: 845, y: 80, w: 55, h: 55, motif: style === "glow" ? "lantern" : "ticks", color: style === "hakuji" ? "#285E91" : style === "glow" ? "#FB923C" : "#2DD4BF", motion: { kind: "rotation", seconds: 30, direction: "clockwise" } });
    case "flameFrame": return make("motif", { x: 632, y: 110, w: 276, h: 206, motif: "flameFrame", flamePalette: style === "hakuji" ? "gold" : "ember", flicker: 60, flameHeight: 44, frameThickness: 4, radius: 16, embers: 50 });
  }
}

/** デザイン部品の並び。開いているシーンのスタイルを先に、残りをその後ろに */
export function orderedVisualParts(style: VisualStyle) {
  const families: VisualStyle[] = [style, ...(["glow", "signal", "hakuji"] as VisualStyle[]).filter(family => family !== style)];
  return families.flatMap(family => visualParts(family).map(part => ({ family, part })));
}
