import { describe, expect, it } from "vitest";
import { isSvgAvatarBytes, parseSvgAvatar } from "@eventer/shared";
import { cropSvgAvatar, prepareSvgCrop } from "./svgAvatarCrop.js";

const BODY = `<script>alert(1)</script><circle cx="50" cy="50" r="40"/>`;
const doc = (attrs: string) => `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${BODY}</svg>\n`;

describe("SVG avatar crop (#576)", () => {
  it("rewrites only the root viewBox/width/height and keeps the content byte-for-byte", () => {
    const source = prepareSvgCrop(doc(`viewBox="10 20 200 100" width="100%" onload="alert(1)"`))!;
    expect(source.box).toEqual({ x: 10, y: 20, width: 200, height: 100 });
    const out = cropSvgAvatar(source, { x: 25, y: 0, width: 50, height: 100 });
    expect(out).toBe(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="60 20 100 100" width="512" height="512">${BODY}</svg>\n`);
    expect(isSvgAvatarBytes(new TextEncoder().encode(out))).toBe(true);
  });
  it("falls back to px width/height when there is no viewBox, and refuses SVGs without a known size", () => {
    expect(prepareSvgCrop(doc(`width="300px" height="150"`))?.box).toEqual({ x: 0, y: 0, width: 300, height: 150 });
    expect(prepareSvgCrop(doc(`width="50%" height="10mm"`))).toBeNull();
    expect(prepareSvgCrop(doc(``))).toBeNull();
  });
  it("parses the minimal document shape: namespaced svg root, balanced tags, one root", () => {
    expect(parseSvgAvatar(`<!DOCTYPE svg [<!ENTITY a "b">]><s:svg xmlns:s="http://www.w3.org/2000/svg"><s:g/><![CDATA[<x>]]></s:svg>`)?.name).toBe("s:svg");
    expect(parseSvgAvatar(`<svg xmlns="http://www.w3.org/2000/svg"><g></svg>`)).toBeNull();
    expect(parseSvgAvatar(`<svg xmlns="http://www.w3.org/2000/svg"/>trailing`)).toBeNull();
    expect(parseSvgAvatar(`<html xmlns="http://www.w3.org/2000/svg"/>`)).toBeNull();
    expect(isSvgAvatarBytes(new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe(false);
  });
});
