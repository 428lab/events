import { describe, expect, it } from "vitest";
import {
  cardDesignAssetIds, cardDesignSchema, cardTemplateIds, createCardTemplate,
  resolveCardLayout,
} from "@eventer/shared";

describe("event card design contract (#506)", () => {
  it.each(cardTemplateIds)("%s is editable and does not share state with another event", (id) => {
    const a = createCardTemplate(id), b = createCardTemplate(id);
    a.common.parts[0].x = 99;
    expect(b.common.parts[0].x).toBe(0);
    expect(cardDesignSchema.safeParse(b).success).toBe(true);
  });

  it("inherits common parts, applies slot changes, then gives staff changes priority", () => {
    const d = createCardTemplate("name");
    const band = d.common.parts.find(p => p.id === "role-band")!;
    d.slots = [{ slotId: "general", rule: {
      parts: [{ ...band, kind: "rect", color: "#0000FF", radius: 0 }], hiddenIds: ["handle"],
    } }];
    const participant = resolveCardLayout(d, "participant", "general");
    const staff = resolveCardLayout(d, "staff", "general");
    expect(participant.parts.find(p => p.id === "role-band")).toHaveProperty("color", "#0000FF");
    expect(staff.parts.find(p => p.id === "role-band")).toHaveProperty("color", "#9D174D");
    expect(staff.parts.some(p => p.id === "handle")).toBe(false);
    expect(staff.parts.find(p => p.id === "name")).toEqual(d.common.parts.find(p => p.id === "name"));
    expect(resolveCardLayout(d, "participant", null)).toEqual(d.common);
  });

  it("tracks assets even in hidden or overridden blocks for ownership checks", () => {
    const d = createCardTemplate("name");
    d.common.background.assetId = "background";
    d.staff!.parts.push({ id: "logo", kind: "image", source: "asset", assetId: "logo",
      x: 0, y: 0, width: 40, height: 40, opacity: 1, fit: "contain" });
    d.staff!.hiddenIds = ["logo"];
    expect(cardDesignAssetIds(d)).toEqual(["background", "logo"]);
  });

  it("rejects executable fields and duplicate ids instead of silently normalizing them", () => {
    const d = createCardTemplate("name");
    expect(cardDesignSchema.safeParse({ ...d, html: "<script>bad()</script>" }).success).toBe(false);
    d.common.parts.push(d.common.parts[0]);
    expect(cardDesignSchema.safeParse(d).success).toBe(false);
  });

  it("rejects coordinates outside print bounds and invalid QR shapes", () => {
    const d = createCardTemplate("name");
    d.common.parts[0].x = 1074;
    expect(cardDesignSchema.safeParse(d).success).toBe(false);
    const qr = createCardTemplate("name");
    qr.common.parts.find(p => p.kind === "qr")!.height = 120;
    expect(cardDesignSchema.safeParse(qr).success).toBe(false);
  });

  it("rejects a foreground part covering the QR quiet zone", () => {
    const d = createCardTemplate("name");
    const qr = d.common.parts.find(p => p.kind === "qr")!;
    d.common.parts.push({ ...qr, id: "cover", kind: "rect", color: "#FFFFFF", radius: 0 });
    expect(cardDesignSchema.safeParse(d).success).toBe(false);
  });

  it("bounds resolved parts, not only each individual rule", () => {
    const d = createCardTemplate("name");
    const block = d.common.parts[0];
    d.common.parts = Array.from({ length: 40 }, (_, i) => ({ ...block, id: `common-${i}` }));
    d.staff = { parts: [{ ...block, id: "additional" }], hiddenIds: [] };
    expect(cardDesignSchema.safeParse(d).success).toBe(false);
  });
});
