import { describe, expect, it } from "vitest";
import { defaultLiveSetContent, liveCameraSlotOf, liveElementSchema, liveSetContentSchema, updateLiveSetInput, usedCameraSlots, visualLiveSetContent } from "@eventer/shared";
import type { LiveScene, LiveSetContent } from "@eventer/shared";
import {
  LEGACY_CAMERA_DEVICE_KEY,
  cameraMapStorageKey,
  cameraSlotChoices,
  defaultCameraSlotForScene,
  readCameraMap,
  resolveCameraDevice,
  resolveCameraSlots,
  withCameraLabel,
  withCameraMapEntry,
  writeCameraMap,
} from "./liveCameraMapping.js";

const camera = (id: string, cameraSlot?: number) => ({ id, type: "camera" as const, x: 0, y: 0, w: 100, h: 100, rotation: 0, ...(cameraSlot !== undefined ? { cameraSlot } : {}) });
const scene = (id: string, elements: LiveScene["elements"]): LiveScene => ({ id, name: id, background: "#000000", elements });

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe("配信セットのカメラ番号のスキーマ (#570)", () => {
  it("#570 以前のセット（番号も呼び名も無い）はそのまま通り、カメラ1 として読む", () => {
    for (const content of [defaultLiveSetContent(), visualLiveSetContent("glow"), visualLiveSetContent("hakuji")]) {
      const parsed = liveSetContentSchema.parse(JSON.parse(JSON.stringify(content)));
      expect(parsed).not.toHaveProperty("cameras");
      expect(parsed.scenes.flatMap(s => s.elements).filter(e => e.type === "camera").every(e => e.cameraSlot === undefined)).toBe(true);
      expect(usedCameraSlots(parsed)).toEqual([1]);
    }
    expect(liveCameraSlotOf(camera("old"))).toBe(1);
  });

  it("番号と呼び名を保つ（保存の入力でも落とさない）", () => {
    const content = { scenes: [scene("a", [camera("c1", 2)])], cameras: [{ slot: 2, label: "会場" }] };
    const parsed = updateLiveSetInput.parse({ content });
    expect(parsed.content?.scenes[0].elements[0].cameraSlot).toBe(2);
    expect(parsed.content?.cameras).toEqual([{ slot: 2, label: "会場" }]);
  });

  it("番号は1〜4の整数、呼び名は20文字、呼び名は4つまで", () => {
    for (const slot of [0, 5, 1.5]) expect(liveElementSchema.safeParse(camera("c", slot)).success, String(slot)).toBe(false);
    for (const slot of [1, 4]) expect(liveElementSchema.safeParse(camera("c", slot)).success).toBe(true);
    expect(liveSetContentSchema.safeParse({ scenes: [], cameras: [{ slot: 1, label: "あ".repeat(20) }] }).success).toBe(true);
    expect(liveSetContentSchema.safeParse({ scenes: [], cameras: [{ slot: 1, label: "あ".repeat(21) }] }).success).toBe(false);
    expect(liveSetContentSchema.safeParse({ scenes: [], cameras: [1, 2, 3, 4, 1].map(slot => ({ slot, label: "x" })) }).success).toBe(false);
    expect(liveSetContentSchema.safeParse({ scenes: [], cameras: [{ slot: 5, label: "x" }] }).success).toBe(false);
  });
});

describe("番号を機器に解決する (#570)", () => {
  const devices = [{ deviceId: "id-a", label: "USB Camera A" }, { deviceId: "id-b", label: "Capture B" }];

  it("未割り当ては既定のカメラ", () => {
    expect(resolveCameraDevice(undefined, devices)).toEqual({ device: "", via: "unmapped" });
  });
  it("保存した deviceId があればそれを使う", () => {
    expect(resolveCameraDevice({ deviceId: "id-b", label: "Capture B" }, devices)).toEqual({ device: "id-b", via: "deviceId" });
  });
  it("deviceId が変わっていたら同じ名前の機器を探し直す", () => {
    expect(resolveCameraDevice({ deviceId: "old-id", label: "USB Camera A" }, devices)).toEqual({ device: "id-a", via: "label" });
  });
  it("名前でも見つからなければ既定のカメラ", () => {
    expect(resolveCameraDevice({ deviceId: "old-id", label: "Gone" }, devices)).toEqual({ device: "", via: "missing" });
    expect(resolveCameraDevice({ deviceId: "old-id", label: "" }, devices)).toEqual({ device: "", via: "missing" });
  });
  it("許可前（一覧に ID も名前も無い）は保存した deviceId で開いてみる", () => {
    expect(resolveCameraDevice({ deviceId: "id-a", label: "USB Camera A" }, [{ deviceId: "", label: "" }])).toEqual({ device: "id-a", via: "deviceId" });
    expect(resolveCameraDevice({ deviceId: "id-a", label: "USB Camera A" }, [])).toEqual({ device: "id-a", via: "deviceId" });
  });
  it("未割り当ての番号がいくつあっても、既定のカメラという同じ1台に解決する", () => {
    const resolved = resolveCameraSlots([1, 2, 3], { 2: { deviceId: "id-b", label: "Capture B" } }, devices);
    expect(new Set([...resolved.values()].map(r => r.device))).toEqual(new Set(["", "id-b"]));
  });
});

describe("このPCの割り当ての保存 (#570)", () => {
  it("配信セットごとに別のキーへ書き、読み戻せる", () => {
    const storage = new MemoryStorage();
    const map = withCameraMapEntry({}, 2, { deviceId: "id-b", label: "Capture B" });
    writeCameraMap("set-1", map, storage);
    expect(storage.getItem(cameraMapStorageKey("set-1"))).toBe(JSON.stringify({ 2: { deviceId: "id-b", label: "Capture B" } }));
    expect(readCameraMap("set-1", storage)).toEqual(map);
    expect(readCameraMap("set-2", storage)).toEqual({});
    expect(withCameraMapEntry(map, 2, null)).toEqual({});
  });
  it("割り当てのないセットは、以前の1台の選択をカメラ1 にする（書き込まない）", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_CAMERA_DEVICE_KEY, "legacy-id");
    expect(readCameraMap("set-1", storage)).toEqual({ 1: { deviceId: "legacy-id", label: "" } });
    expect(storage.getItem(cameraMapStorageKey("set-1"))).toBeNull();
    // 一度保存したら以前の選択は使わない（未割り当てに戻したものを復活させない）
    writeCameraMap("set-1", {}, storage);
    expect(readCameraMap("set-1", storage)).toEqual({});
  });
  it("壊れた値は捨てる", () => {
    const storage = new MemoryStorage();
    storage.setItem(cameraMapStorageKey("set-1"), "{");
    expect(readCameraMap("set-1", storage)).toEqual({});
    storage.setItem(cameraMapStorageKey("set-1"), JSON.stringify({ 1: { deviceId: 3 }, 9: { deviceId: "x", label: "" }, 2: { deviceId: "id", label: 5 } }));
    expect(readCameraMap("set-1", storage)).toEqual({ 2: { deviceId: "id", label: "" } });
  });
});

describe("編集画面のカメラ番号の割り当て (#570)", () => {
  it("シーンにカメラが無ければ1、あればそのシーンで使っていない一番小さい番号", () => {
    expect(defaultCameraSlotForScene(undefined)).toBe(1);
    expect(defaultCameraSlotForScene(scene("a", []))).toBe(1);
    expect(defaultCameraSlotForScene(scene("a", [camera("c")]))).toBe(2);
    expect(defaultCameraSlotForScene(scene("a", [camera("c", 2)]))).toBe(1);
    expect(defaultCameraSlotForScene(scene("a", [camera("c1"), camera("c2", 2), camera("c3", 4)]))).toBe(3);
    expect(defaultCameraSlotForScene(scene("a", [1, 2, 3, 4].map(n => camera(`c${n}`, n))))).toBe(1);
  });
  it("候補はセットにある番号と「新しいカメラ」。4つ使えば新しいカメラは出ない", () => {
    const content: LiveSetContent = { scenes: [scene("a", [camera("c1")]), scene("b", [camera("c2", 3)])], cameras: [{ slot: 2, label: "会場" }] };
    expect(cameraSlotChoices(content)).toEqual({ existing: [1, 2, 3], next: 4 });
    expect(cameraSlotChoices({ scenes: [scene("a", [1, 2, 3, 4].map(n => camera(`c${n}`, n)))] })).toEqual({ existing: [1, 2, 3, 4], next: null });
    // 新しいカメラを選んだ状態は「新しいカメラ」のまま見せる
    expect(cameraSlotChoices({ scenes: [scene("a", [camera("c1")])] }, 2)).toEqual({ existing: [1], next: 2 });
  });
  it("呼び名はセット共通。空にしたら消し、最後の1つなら欄ごと消す", () => {
    const base: LiveSetContent = { scenes: [] };
    const one = withCameraLabel(base, 2, "会場");
    expect(one.cameras).toEqual([{ slot: 2, label: "会場" }]);
    const two = withCameraLabel(one, 1, "登壇者");
    expect(two.cameras).toEqual([{ slot: 1, label: "登壇者" }, { slot: 2, label: "会場" }]);
    expect(withCameraLabel(two, 1, "").cameras).toEqual([{ slot: 2, label: "会場" }]);
    expect(withCameraLabel(one, 2, "")).not.toHaveProperty("cameras");
  });
});
