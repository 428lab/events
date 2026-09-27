import { describe, expect, it } from "vitest";
import { createLiveSetInput, liveElementSchema, liveSceneSchema, liveSetContentSchema } from "@eventer/shared";
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
  it("rejects cloning together with a style and arbitrary motion", () => {
    expect(createLiveSetInput.safeParse({ baseLiveSetId: "x", templateId: "glow" }).success).toBe(false);
    const base = { id: "x", type: "motif", motif: "lantern", x: 0, y: 0, w: 32, h: 32 };
    expect(liveElementSchema.safeParse({ ...base, motion: { kind: "rotation", seconds: 1, direction: "clockwise" } }).success).toBe(false);
    expect(liveElementSchema.safeParse({ ...base, motion: { kind: "colorCycle", seconds: 18, colors: ["#FFFFFF", "#000000"] } }).success).toBe(false);
    expect(liveElementSchema.safeParse({ ...base, type: "clock", timezone: "Not/AZone" }).success).toBe(false);
    expect(liveElementSchema.safeParse({ ...base, type: "countdown", target: "custom" }).success).toBe(false);
    const moving = { ...base, motion: { kind: "rotation", seconds: 30, direction: "clockwise" } };
    expect(liveSceneSchema.safeParse({ id: "scene", name: "scene", background: "#0E1426", elements: [moving, { ...moving, id: "b" }, { ...moving, id: "c" }] }).success).toBe(false);
  });
});
