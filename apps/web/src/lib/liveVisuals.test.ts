import { describe, expect, it } from "vitest";
import { createLiveSetInput, defaultLiveSetContent, liveElementSchema, liveSceneSchema, liveSetContentSchema, visualParts } from "@eventer/shared";
import { visualLiveSetContent } from "@eventer/shared";

describe("visual live sets", () => {
  it.each(["glow", "signal"] as const)("creates seven independent editable %s scenes", (style) => {
    const content = visualLiveSetContent(style);
    expect(liveSetContentSchema.safeParse(content).success).toBe(true);
    const scenes = content.scenes;
    expect(scenes).toHaveLength(7);
    expect(new Set(scenes.flatMap(s => s.elements.map(e => e.id))).size, scenes.flatMap(s => s.elements.map(e => e.id)).filter((id, i, ids) => ids.indexOf(id) !== i).join(", ")).toBe(scenes.flatMap(s => s.elements).length);
    expect(scenes.every(s => s.elements.length <= 50)).toBe(true);
    expect(scenes.find(s => s.name === "講演")?.elements.map(e => e.type)).toEqual(expect.arrayContaining(["camera", "deck", "shape"]));
    expect(scenes[0].elements.some(e => e.type === "eventInfo" && e.field === "datetime")).toBe(true);
    expect(scenes[2].elements.some(e => e.id.includes("name-") || e.text?.includes("氏名を入力"))).toBe(false);
    expect(scenes[4].elements.some(e => e.id.includes("name-") || e.text?.includes("氏名を入力"))).toBe(false);
    const keynoteFooter = scenes[2].elements.find(e => e.id.endsWith("-key-footer"));
    expect(keynoteFooter).toMatchObject({ y: 435, h: 52 });
    expect(scenes[2].elements.find(e => e.id.endsWith("-key-event"))).toMatchObject({ y: 443, h: 35 });
    if (style === "glow") {
      expect(scenes[0].elements.filter(e => e.type === "motif" && e.motif === "lantern")).toHaveLength(3);
      expect(scenes[0].elements.some(e => e.type === "motif" && e.motif === "halo")).toBe(true);
      expect(scenes[2].elements.some(e => e.type === "motif" && e.motif === "halo")).toBe(true);
    }
    if (style === "signal") {
      expect(scenes[0].elements.some(e => e.type === "motif" && e.motif === "grid")).toBe(true);
      expect(scenes[2].elements.some(e => e.type === "motif" && e.motif === "grid")).toBe(true);
      expect(scenes[0].elements.some(e => e.id.endsWith("-rail") && e.h >= 400)).toBe(true);
      const ids = scenes[0].elements.map(e => e.id);
      expect(ids.indexOf("v1-signal-wait-date-panel")).toBeLessThan(ids.indexOf("v1-signal-wait-wait-date"));
      const date = scenes[0].elements.find(e => e.id === "v1-signal-wait-wait-date")!;
      const smallTitle = scenes[0].elements.find(e => e.id === "v1-signal-wait-date-title")!;
      expect(date.requiresEventDatetime).toBe(true);
      expect(date.y + date.h).toBeLessThan(smallTitle.y);
      expect(smallTitle.fontSize).toBeLessThan(date.fontSize!);
    }
  });
  it("creates only the new allowlisted 白磁 template without changing old sets", () => {
    const legacy = JSON.stringify({ default: defaultLiveSetContent(), glow: visualLiveSetContent("glow"), signal: visualLiveSetContent("signal") });
    const content = visualLiveSetContent("hakuji");
    expect(createLiveSetInput.safeParse({ templateId: "hakuji" }).success).toBe(true);
    expect(createLiveSetInput.safeParse({ templateId: "hakuji", baseLiveSetId: "saved" }).success).toBe(false);
    expect(createLiveSetInput.safeParse({ templateId: "custom-light" }).success).toBe(false);
    expect(liveSetContentSchema.parse(JSON.parse(JSON.stringify(content)))).toEqual(content);
    expect(content.scenes).toHaveLength(7);
    expect(content.scenes.every(scene => scene.background === "#F6F2EA" && scene.elements.length <= 50)).toBe(true);
    const ids = content.scenes.flatMap(scene => scene.elements.map(element => element.id));
    expect(new Set(ids).size).toBe(ids.length);
    const keynote = content.scenes[2].elements;
    expect(keynote.filter(element => element.type === "deck" || element.type === "camera").map(element => [element.x, element.y, element.w, element.h])).toEqual([[52, 109, 558, 307], [633, 105, 279, 246]]);
    expect(content.scenes[0].elements.find(element => element.field === "datetime")?.requiresEventDatetime).toBe(true);
    expect(content.scenes.every(scene => scene.elements.every(element => !element.text?.includes("役割を入力") && !element.text?.includes("氏名を入力")))).toBe(true);
    for (const [index, cameraId, nameY, nameH] of [[2, "keynote-camera", 356, 89], [4, "camera-main", 431, 49]] as const) {
      const elements = content.scenes[index].elements;
      const camera = elements.find(element => element.id === `v1-hakuji-${index === 2 ? "keynote" : "camera"}-${cameraId}`)!;
      const prefix = `v1-hakuji-${index === 2 ? "keynote" : "camera"}-`;
      const back = elements.find(element => element.id === `${prefix}${index === 2 ? "keynote" : "camera"}-name-back`)!;
      const name = elements.find(element => element.id === `${prefix}${index === 2 ? "keynote" : "camera"}-name`)!;
      const role = elements.find(element => element.id === `${prefix}${index === 2 ? "keynote" : "camera"}-role`)!;
      expect(back).toMatchObject({ type: "shape", y: nameY, h: nameH, fill: "#203146" });
      expect(name).toMatchObject({ type: "text", text: "", color: "#FFFFFF" });
      expect(role).toMatchObject({ type: "text", text: "", color: "#FFFFFF" });
      expect(elements.indexOf(back)).toBeLessThan(elements.indexOf(name));
      expect(elements.indexOf(name)).toBeLessThan(elements.indexOf(role));
      expect(camera.y + camera.h).toBeLessThan(back.y);
      expect(name.x).toBeGreaterThanOrEqual(back.x);
      expect(name.x + name.w).toBeLessThanOrEqual(back.x + back.w);
      expect(role.y + role.h).toBeLessThanOrEqual(back.y + back.h);
    }
    expect(JSON.stringify({ default: defaultLiveSetContent(), glow: visualLiveSetContent("glow"), signal: visualLiveSetContent("signal") })).toBe(legacy);
  });
  it("expands four independent 白磁 cards into schema-valid layers", () => {
    const cards = visualParts("hakuji");
    expect(cards.map(card => [card.id, card.elements.length])).toEqual([["name", 4], ["camera", 5], ["chapter", 4], ["break", 4]]);
    expect(cards[0].elements.find(element => element.id === "name")).toMatchObject({ fontSize: 22, maxLines: 2, w: 269 });
    for (const card of cards) {
      expect(card.elements.every(element => liveElementSchema.safeParse(element).success)).toBe(true);
      expect(new Set(card.elements.map(element => element.id)).size).toBe(card.elements.length);
    }
  });
  it("rejects cloning together with a style and arbitrary motion", () => {
    expect(createLiveSetInput.safeParse({ baseLiveSetId: "x", templateId: "glow" }).success).toBe(false);
    const base = { id: "x", type: "motif", motif: "lantern", x: 0, y: 0, w: 32, h: 32 };
    expect(liveElementSchema.safeParse({ ...base, motion: { kind: "rotation", seconds: 1, direction: "clockwise" } }).success).toBe(false);
    expect(liveElementSchema.safeParse({ ...base, motion: { kind: "colorCycle", seconds: 18, colors: ["#FFFFFF", "#000000"] } }).success).toBe(false);
    expect(liveElementSchema.safeParse({ ...base, type: "clock", timezone: "Not/AZone" }).success).toBe(false);
    expect(liveElementSchema.safeParse({ ...base, type: "countdown", target: "custom", targetEpochMs: -1 }).success).toBe(false);
    const moving = { ...base, motion: { kind: "rotation", seconds: 30, direction: "clockwise" } };
    expect(liveSceneSchema.safeParse({ id: "scene", name: "scene", background: "#0E1426", elements: [moving, { ...moving, id: "b" }, { ...moving, id: "c" }] }).success).toBe(false);
  });
});
