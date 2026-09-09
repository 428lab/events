import { afterEach, describe, expect, it, vi } from "vitest";
import { cardFontCssUrl, cardFontSpec, loadCardFont, parseCardFontCss } from "./cardFonts.js";
import { DISPLAY_FONTS } from "@eventer/shared";
import { FONTS } from "./imageTemplates.js";

const css = `@font-face { font-family: 'Original'; font-weight: 400;
  src: url(https://fonts.gstatic.com/s/example.woff2) format('woff2'); unicode-range: U+3000-9FFF; }`;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("organizer card fonts", () => {
  it("shares all 26 image-studio choices without exposing participant text in the CSS URL", () => {
    expect(DISPLAY_FONTS).toEqual(FONTS);
    expect(DISPLAY_FONTS).toHaveLength(26);
    for (const f of DISPLAY_FONTS) {
      const url = new URL(cardFontCssUrl(f.family));
      expect(url.origin).toBe("https://fonts.googleapis.com");
      expect([...url.searchParams.keys()]).toEqual(["family", "display"]);
      expect(cardFontSpec(f.family, false).alias).not.toBe(f.family);
      if (f.weight === 400) expect(cardFontSpec(f.family, true).weight).toBe(400);
    }
  });

  it("retains Unicode ranges and refuses executable CSS or other font origins", () => {
    expect(parseCardFontCss(css)[0].descriptors.unicodeRange).toBe("U+3000-9FFF");
    expect(() => parseCardFontCss(css.replace("fonts.gstatic.com", "example.com"))).toThrow("invalid_font_origin");
    expect(() => parseCardFontCss(css.replace("fonts.gstatic.com", "fonts.gstatic.com:444"))).toThrow("invalid_font_origin");
    expect(() => parseCardFontCss("body { background: url(https://example.com); }")).toThrow("missing_font_faces");
  });

  it("waits for actual glyphs after registration and does not request fonts for the legacy choice", async () => {
    const original = Object.getOwnPropertyDescriptor(document, "fonts");
    let finish!: (faces: FontFace[]) => void;
    const load = vi.fn((_font: string, _text: string) => new Promise<FontFace[]>(resolve => { finish = resolve; }));
    const add = vi.fn();
    Object.defineProperty(document, "fonts", { configurable: true, value: { load, add } });
    vi.stubGlobal("FontFace", class { constructor(public family: string) {} });
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => new Response(css)); vi.stubGlobal("fetch", fetcher);
    try {
      await loadCardFont(undefined, true, "𠮷野 龍之介");
      expect(fetcher).not.toHaveBeenCalled();
      let ready = false;
      const pending = loadCardFont("Noto Serif JP", false, "𠮷野 龍之介").then(() => { ready = true; });
      await vi.waitFor(() => expect(load).toHaveBeenCalled());
      expect(ready).toBe(false);
      expect(load.mock.calls[0]).toEqual(['400 64px "EventCardFont11"', "𠮷野 龍之介"]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("龍");
      finish([]); await pending;
      expect(ready).toBe(true);
      expect(add).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(document, "fonts", original);
      else Reflect.deleteProperty(document, "fonts");
    }
  });
});
