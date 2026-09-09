import { afterEach, describe, expect, it, vi } from "vitest";
import { createCardTemplate } from "@eventer/shared";
import { api } from "../../api/client.js";
import { copyEventDesign } from "./copyDesign.js";

afterEach(() => vi.restoreAllMocks());
const sourceId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
function source() {
  const design = createCardTemplate("name");
  design.common.background.assetId = "one";
  design.common.parts.find(p => p.kind === "text")!.font = "Reggae One";
  design.slots = [{ slotId: "old-slot", rule: { parts: [], hiddenIds: [], background: { ...design.common.background, assetId: "two" } } }];
  vi.spyOn(api, "get").mockResolvedValueOnce({ event: { id: sourceId } })
    .mockResolvedValueOnce({ revision: 1, design }).mockResolvedValueOnce({ slots: [{ id: "old-slot", name: "General" }] });
  return design;
}
const asset = (id: string) => ({ id, url: `/api/events/${targetId}/name-card-assets/${id}`, width: 100, height: 100, contentType: "image/png" });

describe("copying reusable event designs (#506)", () => {
  it("rebinds slots and all image references without modifying the source", async () => {
    const original = source();
    const post = vi.spyOn(api, "post").mockResolvedValueOnce({ asset: asset("new-one") }).mockResolvedValueOnce({ asset: asset("new-two") });
    const result = await copyEventDesign(targetId, sourceId, [{ id: "new-slot", name: "General" }]);
    expect(result.design.common.background.assetId).toBe("new-one");
    expect(result.design.slots[0].slotId).toBe("new-slot");
    expect(result.design.slots[0].rule.background?.assetId).toBe("new-two");
    expect(original.common.background.assetId).toBe("one");
    expect(result.design.common.parts).toEqual(original.common.parts);
    expect(post).toHaveBeenCalledWith(`/events/${targetId}/name-card-assets/copy`, { sourceEventId: sourceId, assetId: "one" });
  });
  it("cleans up already-copied files if a later copy fails", async () => {
    source();
    vi.spyOn(api, "post").mockResolvedValueOnce({ asset: asset("new-one") }).mockRejectedValueOnce(new Error("offline"));
    const del = vi.spyOn(api, "del").mockResolvedValue({ ok: true });
    await expect(copyEventDesign(targetId, sourceId, [{ id: "new-slot", name: "General" }])).rejects.toThrow("offline");
    expect(del).toHaveBeenCalledWith(`/events/${targetId}/name-card-assets/new-one`);
  });
});
