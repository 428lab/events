import { describe, expect, it } from "vitest";
import { convertDeckImport, exportDeckV2, previewDeckImportId, validateDeckImport, type DeckContent } from "@eventer/shared";

/** 書き出し（docs/slide-editor.md 4.1）: 書き出した JSON が公開の検証に通り、
 * 取り込み直すと同じページ・要素に戻る（v2 が持たない回転・グループ・pos・書体名だけ落ちる） */
describe("deck export (events-lab-deck v2)", () => {
  const content: DeckContent = { slides: [
    { id: "s1", pos: "a0", background: "#0E1426", elements: [
      { id: "t1", pos: "a0", type: "text", x: 40, y: 30, w: 880, h: 120, rotation: 15, groupId: "g",
        text: "events lab\n紹介", fontSize: 48, fontFamily: "serif", color: "#F8FAFC", bold: true, italic: false, align: "center" },
      { id: "i1", pos: "a1", type: "image", x: 600, y: 200, w: 320, h: 200, rotation: 0, src: "/api/decks/d1/images/abc" },
      { id: "i2", pos: "a2", type: "image", x: 40, y: 200, w: 320, h: 200, rotation: 0 },
    ] },
    { id: "s2", pos: "a1", background: "#FFFFFF", elements: [
      { id: "t2", pos: "a0", type: "text", x: 950, y: 530, w: 400, h: 400, rotation: 0, text: "はみ出し", fontFamily: "Noto Serif JP" },
    ] },
  ] };

  it("produces a valid v2 file that re-imports to the same slides, except the documented lossy fields", () => {
    const exported = exportDeckV2({ title: "紹介", content }, "https://events.kojira.io");
    const validated = validateDeckImport(JSON.parse(JSON.stringify(exported)));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const back = convertDeckImport(validated.value, previewDeckImportId).content;

    expect(back.slides.map((s) => s.background)).toEqual(["#0E1426", "#FFFFFF"]);
    const [t1, i1, i2] = back.slides[0].elements;
    // 文字: 位置・中身・装飾は戻る。回転とグループは v2 に無いので落ちる
    expect(t1).toMatchObject({ type: "text", x: 40, y: 30, w: 880, h: 120, text: "events lab\n紹介",
      fontSize: 48, fontFamily: "serif", color: "#F8FAFC", bold: true, align: "center", rotation: 0 });
    expect(t1.groupId).toBeUndefined();
    // 相対の画像は表示中のオリジンで絶対 URL に、画像の無い枠は空枠のまま
    expect(i1).toMatchObject({ type: "image", src: "https://events.kojira.io/api/decks/d1/images/abc" });
    expect(i2.src).toBeUndefined();
    // v2 の範囲に収めて書き出す（右下へはみ出した要素は内側へ、書体名は既定へ）
    const t2 = back.slides[1].elements[0];
    expect(t2.x + t2.w).toBeLessThanOrEqual(960);
    expect(t2.y + t2.h).toBeLessThanOrEqual(540);
    expect(t2.fontFamily).toBe("");
  });

  it("writes an image placeholder when the image cannot become an absolute HTTPS URL", () => {
    const exported = exportDeckV2({ title: "local", content }, "http://localhost:5173");
    expect(exported.slides[0].elements[1]).toMatchObject({ type: "image-placeholder" });
    expect(validateDeckImport(exported).ok).toBe(true);
  });
});
