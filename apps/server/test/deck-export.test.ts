import { describe, expect, it } from "vitest";
import { convertDeckImport, DECK_IMPORT_FONTS, deckV2Losses, exportDeckV2, previewDeckImportId, validateDeckImport, type DeckContent } from "@eventer/shared";

/** 書き出し（docs/slide-editor.md 4.1）: 書き出した JSON が公開の検証に通り、取り込み直すと
 * 同じ中身に戻る（id と位置キー pos だけ振り直す。並びは同じ）。AI に直してもらっても元の内容が
 * 変わらないため（kojira 2026-11-28「元の内容が変わるのはよくない」） */
const strip = (c: DeckContent) => c.slides.map((s) => ({
  background: s.background,
  elements: s.elements.map(({ id: _id, pos: _pos, ...rest }) => rest),
}));

describe("deck export (events-lab-deck v2)", () => {
  // 編集画面が作れるもの全部: 文字と画像（URL・アップロード・空枠）、回転、グループ、全部の書体、
  // 太字・斜体・揃え、色、装飾の省略、はみ出した・小数の位置、空の文字、タブ
  const fonts = DECK_IMPORT_FONTS.filter((f) => f !== "default");
  const content: DeckContent = { slides: [
    { id: "s1", pos: "a0", background: "#0E1426", elements: [
      { id: "t1", pos: "a0", type: "text", x: -40.5, y: 30.25, w: 1200, h: 120, rotation: 15.5, groupId: "g",
        text: "events lab\n紹介\tタブ", fontSize: 48, fontFamily: "serif", color: "#F8FAFC", bold: true, italic: false, align: "center" },
      { id: "i1", pos: "a1", type: "image", x: 600, y: 200, w: 320, h: 200, rotation: -90, groupId: "g", src: "/api/decks/d1/images/abc" },
      { id: "i2", pos: "a2", type: "image", x: 40, y: 200, w: 320, h: 200, rotation: 0 },
      { id: "i3", pos: "a3", type: "image", x: 950, y: 530, w: 400, h: 400, rotation: 0, src: "http://example.com/a.png" },
      { id: "t0", pos: "a4", type: "text", x: 0, y: 0, w: 20, h: 20, rotation: 0, text: "" },
      { id: "td", pos: "a5", type: "text", x: 0, y: 0, w: 20, h: 20, rotation: 0, text: "既定", fontFamily: "", italic: true, align: "right" },
    ] },
    { id: "s2", pos: "a1", background: "#ffffff", elements: fonts.map((f, i) => (
      { id: `f${i}`, pos: `b${i}`, type: "text" as const, x: 10, y: i * 15, w: 400, h: 20, rotation: 0, text: f, fontFamily: f, fontSize: 12 + i }
    )) },
  ] };

  it("re-imports to exactly the same content (every editor feature)", () => {
    const exported = exportDeckV2({ title: "紹介", content }, "https://events.kojira.io", { keepSrc: () => true });
    // AI の書き戻しと同じく、今の中身にある画像の src はそのまま受け付ける（routes/deckAgent.ts）
    const current = new Set(content.slides.flatMap((s) => s.elements.flatMap((e) => (e.src ? [e.src] : []))));
    const validated = validateDeckImport(JSON.parse(JSON.stringify(exported)), { uploadedImageSrc: (src) => current.has(src) });
    expect(validated.ok && validated.value.version).toBe(2);
    if (!validated.ok) return;
    const back = convertDeckImport(validated.value, previewDeckImportId);
    expect(back.title).toBe("紹介");
    expect(strip(back.content)).toEqual(strip(content));
    expect(deckV2Losses(content)).toEqual({ truncatedSlides: 0, truncatedElements: 0, overTotalElements: 0, overTotalText: 0 });
  });

  it("the downloaded file makes relative images absolute and writes a placeholder when it cannot", () => {
    const remote = exportDeckV2({ title: "紹介", content }, "https://events.kojira.io");
    expect(remote.slides[0].elements[1]).toMatchObject({ type: "image-url", src: "https://events.kojira.io/api/decks/d1/images/abc" });
    const local = exportDeckV2({ title: "local", content }, "http://localhost:5173");
    expect(local.slides[0].elements[1]).toMatchObject({ type: "image-placeholder" });
    expect(validateDeckImport(local).ok).toBe(true);
  });

  it("reports only the v2 limits as losses", () => {
    const many = { slides: Array.from({ length: 61 }, (_, i) => ({ id: `s${i}`, background: "#ffffff", elements: [] })) };
    expect(deckV2Losses(many).truncatedSlides).toBe(1);
  });
});
