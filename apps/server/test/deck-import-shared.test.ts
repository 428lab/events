import { describe, it, expect } from "vitest";
import { parseDeckImport, parseDeckImportJson, convertDeckImport, previewDeckImportId, DeckImportJsonError, DECK_IMPORT_MAX_BYTES, deckImportJsonSchema, deckImportV2JsonSchema } from "@eventer/shared";

export const sample = {
  format: "events-lab-deck", version: 1, title: "地域勉強会",
  slides: [{ background: "#ABCDEF", elements: [
    { type: "text", x: 0, y: 0, w: 960, h: 540, text: "・話す\n😀 <script> https://example.com", fontSize: 28, font: "default", color: "#112233", bold: true, italic: false, align: "left" },
    { type: "image-placeholder", x: 940, y: 520, w: 20, h: 20 },
  ] }],
};
const parse = (value: unknown) => parseDeckImport(JSON.stringify(value));

describe("deckImport shared contract", () => {
  it("preserves text, order, positions and color; preview IDs and no image src", () => {
    const parsed = parse(sample);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { title, content } = convertDeckImport(parsed.value, previewDeckImportId);
    expect(title).toBe(sample.title);
    expect(content.slides[0].id).toBe("preview-slide-1");
    expect(content.slides[0].background).toBe("#ABCDEF");
    expect(content.slides[0].elements[0]).toMatchObject({ id: "preview-element-1-1", text: sample.slides[0].elements[0].text, fontFamily: "", rotation: 0 });
    expect(content.slides[0].elements[1]).toEqual({ id: "preview-element-1-2", type: "image", x: 940, y: 520, w: 20, h: 20, rotation: 0 });
  });
  it.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":1,"__proto__":2}', '{"x":"\\ud800"}', '{"x":"\\udc00"}', '{"x":1e309}', '{"x":01}', '{"x":1,}', '```json\n{}\n```', '{} explanation', '{/*x*/}', '[[[[[[[]]]]]]]', ''])("rejects malformed JSON %s", (raw) => {
    expect(() => parseDeckImportJson(raw)).toThrow(DeckImportJsonError);
  });
  it("accepts integer notation, JSON whitespace and paired surrogate escapes", () => {
    expect(parseDeckImportJson(' \t\r\n{"x":1e2,"y":1.0,"z":-0,"text":"\\ud83d\\ude00"} ')).toEqual({ x: 100, y: 1, z: 0, text: "😀" });
    expect(parseDeckImportJson('[[[[[[]]]]]]')).toBeDefined();
  });
  it("rejects BOM, invalid UTF-8, pasted lone surrogates before TextEncoder replacement", () => {
    for (const raw of ["\ufeff{}", "\ud800", new Uint8Array([0xc0, 0xaf]), new Uint8Array([0xef, 0xbb, 0xbf, 123, 125])]) {
      expect(() => parseDeckImportJson(raw)).toThrow("invalid_encoding");
    }
  });
  it("measures source UTF-8 bytes including formatting before parse", () => {
    const raw = JSON.stringify(sample);
    const size = new TextEncoder().encode(raw).length;
    expect(parseDeckImport(raw + " ".repeat(DECK_IMPORT_MAX_BYTES - size)).ok).toBe(true);
    expect(() => parseDeckImport(raw + " ".repeat(DECK_IMPORT_MAX_BYTES - size + 1))).toThrow("too_large");
  });
  it("reports syntax line and UTF-16 column without echoing input", () => {
    try { parseDeckImportJson('{\r\n"😀": 1,\n}'); } catch (error) {
      expect(error).toMatchObject({ code: "invalid_json", line: 3, column: 1 });
    }
  });
  it.each([
    { version: 3 }, { version: "2" }, { title: " title" }, { title: "x\t" }, { title: "😀".repeat(61) },
    { ownerId: "injected" }, { slides: [] }, { title: null },
  ])("rejects root constraints %j", (override) => expect(parse({ ...sample, ...override }).ok).toBe(false));
  it.each([
    { src: "data:image/png;base64,abc" }, { fontFamily: "https://example.com" }, { rotation: 0 },
    { x: 941 }, { y: -1 }, { w: 19 }, { h: 541 }, { x: 1 }, { fontSize: 11 },
    { fontSize: 161 }, { font: "Arial" }, { color: "#fff" }, { bold: "true" },
    { text: "" }, { text: "x\r\ny" }, { text: "x\u007f" }, { text: "😀".repeat(5001) },
  ])("rejects text constraints case %#", (override) => {
    const value = structuredClone(sample);
    Object.assign(value.slides[0].elements[0], override);
    expect(parse(value).ok).toBe(false);
  });
  it("bounds deterministic issues and unknown-key display", () => {
    const value = { ...sample, ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`secret${i}`.padEnd(300, "x"), 1])) };
    const result = parse(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(result.issues[0].path.length).toBe(80);
    expect(JSON.stringify(result).length).toBeLessThan(65536);
  });
  it("enforces aggregate element and UTF-16 limits", () => {
    const empty = { type: "image-placeholder", x: 0, y: 0, w: 20, h: 20 };
    const value = { ...sample, slides: Array.from({ length: 20 }, () => ({ background: "#FFFFFF", elements: Array.from({ length: 50 }, () => empty) })) };
    expect(parse(value).ok).toBe(true);
    expect(parse({ ...value, slides: [...value.slides, { background: "#FFFFFF", elements: [empty] }] }).ok).toBe(false);
    const text = { ...sample.slides[0].elements[0], text: "a".repeat(10000) };
    expect(parse({ ...sample, slides: [{ background: "#FFFFFF", elements: Array(10).fill(text) }] }).ok).toBe(true);
    expect(parse({ ...sample, slides: [{ background: "#FFFFFF", elements: Array(11).fill(text) }] }).ok).toBe(false);
  });
  it("accepts v2 HTTPS images without rewriting src and keeps v1 closed", () => {
    const url = "https://EXAMPLE.com:443/photo.png?token=%20#part";
    const image = { type: "image-url", x: 48, y: 180, w: 392, h: 240, src: url };
    const v2 = { ...sample, version: 2, slides: [{ background: "#FFFFFF", elements: [image, sample.slides[0].elements[1]] }] };
    expect(parse({ ...v2, version: 1 }).ok).toBe(false);
    const parsed = parse(v2);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(convertDeckImport(parsed.value, previewDeckImportId).content.slides[0].elements).toEqual([
        { id: "preview-element-1-1", type: "image", x: 48, y: 180, w: 392, h: 240, rotation: 0, src: url },
        { id: "preview-element-1-2", type: "image", x: 940, y: 520, w: 20, h: 20, rotation: 0 },
      ]);
    }
    const prefix = "https://example.com/";
    for (const valid of [prefix + "a".repeat(500 - prefix.length), "https://例え.テスト/a b", "https://127.0.0.1:8443/a#part"]) {
      const result = parse({ ...v2, slides: [{ background: "#FFFFFF", elements: [{ ...image, src: valid }] }] });
      expect(result.ok).toBe(true);
      if (result.ok) expect(convertDeckImport(result.value, previewDeckImportId).content.slides[0].elements[0].src).toBe(valid);
    }
    for (const bad of ["http://example.com/a", "data:image/png;base64,abc", "blob:https://example.com/a", "/relative", "https://user:pass@example.com/a", "https://example.com/\tsecret", "https://example.com/a\u0080", "https://", prefix + "a".repeat(501 - prefix.length), prefix + "😀".repeat(241)]) {
      const result = parse({ ...v2, slides: [{ background: "#FFFFFF", elements: [{ ...image, src: bad }] }] });
      expect(result.ok, bad).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.path === "slides[0].elements[0].src")).toBe(true);
        expect(JSON.stringify(result)).not.toContain(bad);
      }
    }
    for (const badImage of [{ ...image, src: 5 }, { ...image, src: "" }, { ...image, x: 600 }, { ...image, alt: "photo" }, { ...image, src: undefined }]) {
      const result = parse({ ...v2, slides: [{ background: "#FFFFFF", elements: [badImage] }] });
      expect(result.ok).toBe(false);
      if (!result.ok && Object.hasOwn(badImage, "src") && badImage.src !== undefined && badImage.src !== url) {
        expect(result.issues.some((issue) => issue.path === "slides[0].elements[0].src" && issue.code === "invalid_image_url")).toBe(true);
      }
    }
    expect(parse({ ...v2, slides: [{ background: "#FFFFFF", elements: [{ ...sample.slides[0].elements[1], src: url }] }] }).ok).toBe(false);
  });
  it("public v2 schema and actual intro sample validate together", () => {
    const schema = import.meta.glob("../../web/public/deck-import/v2/schema.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    expect(JSON.parse(Object.values(schema)[0])).toEqual(deckImportV2JsonSchema);
    const samples = import.meta.glob("../../web/public/deck-import/v2/sample-*.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    expect(Object.values(samples)).toHaveLength(1);
    const parsed = parseDeckImport(Object.values(samples)[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(convertDeckImport(parsed.value, previewDeckImportId).content.slides.map((slide) => slide.elements.filter((el) => el.type === "image" && el.src).map((el) => el.src))).toEqual([
      ["https://events.kojira.io/og-default.png"], ["https://events.kojira.io/icon-512.png"], [],
    ]);
  });
  it("public schema and samples remain in lockstep with shared definitions", () => {
    const assets = import.meta.glob("../../web/public/deck-import/v1/*.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    const schema = Object.entries(assets).find(([path]) => path.endsWith("/schema.json"));
    expect(schema).toBeDefined();
    expect(JSON.parse(schema![1])).toEqual(deckImportJsonSchema);
    const samples = Object.entries(assets).filter(([path]) => path.includes("/sample-"));
    expect(samples).toHaveLength(3);
    for (const [, raw] of samples) expect(parseDeckImport(raw).ok).toBe(true);
  });
});
