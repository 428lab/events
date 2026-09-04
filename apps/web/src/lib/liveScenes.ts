import type { LiveElement, LiveScene } from "@eventer/shared";
import { copyPage } from "./editor/collection.js";
import { uid } from "./editor/uid.js";

/**
 * 配信セット **固有** の操作。
 *
 * 画面から切り離した純粋な関数として置く。React にも MUI にも依存しない。
 * 差し込む・入れ替える・重なり順・まとめて動かす、といった型を見ない式は
 * スライド編集と共通なので `editor/collection.ts` にある。ここには置かない。
 *
 * ここに残るのは「配信セットにしか無いもの」＝シーンの名前の付け方と、
 * 置いたばかりの要素の既定値（カメラ・スライド・イベント情報を含む5種類）。
 */

// ===== シーン =====

/** 新しいシーン。名前は保存されるデータなので訳さない（方針は #364 / #367） */
export function newScene(count: number): LiveScene {
  return {
    id: uid(),
    name: `シーン ${count + 1}`,
    background: "#0E1426",
    elements: [],
  };
}

/**
 * シーンの写し。id の振り直しは共通の `copyPage` に任せ、
 * ここは名前に「のコピー」を足すぶんだけ。
 * 一覧では名前しか見えないので、写しと元が同名だと見分けが付かない。
 */
export function copyScene(scene: LiveScene): LiveScene {
  return { ...copyPage(scene), name: `${scene.name}のコピー` };
}

/**
 * 背景が単色かどうか。単色のときだけカラーピッカーの値として出せる
 * （グラデーションの指定は色として読めないので、既定色を出しておく）。
 */
export function isColorBackground(background: string | undefined): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(background ?? "");
}

// ===== 置いたばかりの要素 =====
// 文言は保存されるデータなので訳さない（方針は #364 / #367）

export function newTextElement(): LiveElement {
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
    color: "#EAF0F7",
    align: "left",
  };
}

/** 上げ終わった画像 */
export function newImageElement(src: string): LiveElement {
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

/** カメラ映像の窓。既定は角丸の小窓（ワイプ）にしておく */
export function newCameraElement(): LiveElement {
  return {
    id: uid(),
    type: "camera",
    x: 640,
    y: 340,
    w: 280,
    h: 180,
    rotation: 0,
    fit: "cover",
    radius: 12,
  };
}

/** スライドの投影窓。16:9 のまま左上に置く */
export function newDeckElement(): LiveElement {
  return {
    id: uid(),
    type: "deck",
    x: 0,
    y: 0,
    w: 720,
    h: 405,
    rotation: 0,
  };
}

/** イベント情報の差し込み。既定は見出しとしてのイベント名 */
export function newEventInfoElement(): LiveElement {
  return {
    id: uid(),
    type: "eventInfo",
    field: "title",
    x: 120,
    y: 40,
    w: 720,
    h: 80,
    rotation: 0,
    fontSize: 36,
    color: "#EAF0F7",
    bold: true,
    align: "center",
  };
}

// ===== 画面から呼ぶ操作のまとまり =====

/** シーンに対する操作。左の一覧が受け取る */
export interface LiveSceneCommands {
  add: () => void;
  duplicate: () => void;
  remove: () => void;
  /** -1 で前へ、1 で後ろへ */
  move: (d: number) => void;
}

/**
 * 選んだ要素に対する操作。キャンバスと右の設定欄が受け取る。
 * スライド編集と違って選択は常に 1 つなので、まとめる/解除は無い。
 */
export interface LiveElementCommands {
  patch: (elId: string, patch: Partial<LiveElement>) => void;
  remove: () => void;
  duplicate: () => void;
  toFront: () => void;
  toBack: () => void;
  moveZ: (elId: string, dir: 1 | -1) => void;
  nudge: (dx: number, dy: number) => void;
  /** つかんで動かし終えた位置 */
  moveTo: (elId: string, x: number, y: number) => void;
}
