import { useEffect, useState } from "react";
import type { CardFont } from "@eventer/shared";
import { loadCardFont, type CardFontStatus } from "../../lib/cardFonts.js";

export function useCardFont(font: CardFont | undefined, bold: boolean, text: string): CardFontStatus {
  const key = JSON.stringify([font, bold, text]);
  const custom = !!font && font !== "default";
  const needed = !!text.trim() && (custom || (typeof document !== "undefined" && typeof document.fonts?.load === "function"));
  const [result, setResult] = useState<{ key: string; status: CardFontStatus }>();
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    void loadCardFont(font, bold, text).then(
      () => { if (!cancelled) setResult({ key, status: "ready" }); },
      () => { if (!cancelled) setResult({ key, status: "error" }); },
    );
    return () => { cancelled = true; };
  }, [font, bold, text, key, needed]);
  return !needed ? "ready" : result?.key === key ? result.status : "loading";
}
