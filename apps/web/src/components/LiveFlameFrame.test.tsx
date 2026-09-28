import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { FLAME_FRAME_LIMITS, liveElementSchema, liveSetContentSchema, visualLiveSetContent } from "@eventer/shared";
import type { LiveElement, LiveScene } from "@eventer/shared";
import { LiveSceneStage } from "./LiveStage.js";
import { flameFrameSettings } from "./LiveFlameFrame.js";

const flame: LiveElement = { id: "flame", type: "motif", motif: "flameFrame", x: 632, y: 110, w: 276, h: 206, rotation: 0, flamePalette: "ember", flicker: 60, flameHeight: 44, frameThickness: 4, radius: 16, embers: 50 };

describe("flame frame schema (#566)", () => {
  it("accepts the flame frame with every setting at its bounds and as a frame-sized element", () => {
    expect(liveElementSchema.safeParse(flame).success).toBe(true);
    for (const bound of ["min", "max"] as const) {
      const el = { ...flame, flicker: FLAME_FRAME_LIMITS.flicker[bound], flameHeight: FLAME_FRAME_LIMITS.flameHeight[bound], frameThickness: FLAME_FRAME_LIMITS.frameThickness[bound], radius: FLAME_FRAME_LIMITS.radius[bound], embers: FLAME_FRAME_LIMITS.embers[bound] };
      expect(liveElementSchema.safeParse(el).success).toBe(true);
    }
    expect(liveElementSchema.safeParse({ ...flame, x: 44, y: 44, w: 872, h: 452 }).success).toBe(true);
    // settings are optional: a bare flame frame uses the defaults
    expect(liveElementSchema.safeParse({ id: "f", type: "motif", motif: "flameFrame", x: 0, y: 0, w: 300, h: 200 }).success).toBe(true);
  });

  it.each([
    ["flicker", 101], ["flicker", -5], ["flameHeight", 14], ["flameHeight", 74], ["frameThickness", 1], ["frameThickness", 13],
    ["radius", 50], ["embers", 120], ["flamePalette", "green"], ["w", 961], ["h", 541],
  ] as const)("rejects %s = %s", (key, value) => {
    expect(liveElementSchema.safeParse({ ...flame, [key]: value }).success).toBe(false);
  });

  it("rejects CSS motion on the flame frame (it animates itself)", () => {
    expect(liveElementSchema.safeParse({ ...flame, motion: { kind: "rotation", seconds: 30, direction: "clockwise" } }).success).toBe(false);
  });

  it("keeps existing sets and motifs parsing unchanged", () => {
    for (const style of ["glow", "signal", "hakuji"] as const) {
      const content = visualLiveSetContent(style);
      expect(liveSetContentSchema.parse(JSON.parse(JSON.stringify(content)))).toEqual(content);
    }
    const oldMotif = { id: "m", type: "motif", motif: "halo", x: 0, y: 0, w: 40, h: 40, rotation: 0, radius: 200 };
    expect(liveElementSchema.parse(oldMotif)).toEqual(oldMotif);
  });
});

describe("LiveFlameFrame", () => {
  it("fills defaults and uses gold on 白磁 when no color is saved", () => {
    const bare: LiveElement = { id: "f", type: "motif", motif: "flameFrame", x: 0, y: 0, w: 300, h: 200, rotation: 0 };
    expect(flameFrameSettings(bare, false)).toEqual({ palette: "ember", flicker: 60, height: 44, thickness: 4, radius: 16, embers: 50 });
    expect(flameFrameSettings(bare, true).palette).toBe("gold");
  });

  afterEach(() => vi.restoreAllMocks());
  it("draws only the frame line when WebGL is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const scene: LiveScene = { id: "s", name: "s", background: "#0E1426", elements: [flame] };
    const { container } = render(<LiveSceneStage scene={scene} width={960} runtime={{}} />);
    const fallback = container.querySelector("[data-flame-fallback]") as HTMLElement;
    expect(fallback).toBeTruthy();
    expect(fallback.style.border).toContain("4px solid");
    expect(container.querySelector("canvas")).toBeNull();
  });
});
