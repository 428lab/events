import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { resolveCardLayout, type CardDesign, type EventNameCard } from "@eventer/shared";
import { cardImageUrls, EventCardSvg, type EventCardContext } from "../licenseCard/EventCardSvg.js";
export type CardPrintStatus = "loading" | "ready" | "error";
export function PrintableEventCard({ design, card, context, onStatus }: {
  design: CardDesign; card: EventNameCard; context: EventCardContext;
  onStatus: (id: string, status: CardPrintStatus) => void;
}) {
  const layout = useMemo(() => resolveCardLayout(design, card.role, card.slotId ?? null), [design, card.role, card.slotId]);
  const urls = cardImageUrls(layout, card, context);
  const [images, setImages] = useState<Record<string, boolean>>({});
  const [fonts, setFonts] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(document.fonts?.ready).then(() => { if (!cancelled) setFonts(true); });
    return () => { cancelled = true; };
  }, []);
  const status = urls.some(url => images[url] === false) ? "error"
    : fonts && urls.every(url => images[url] === true) ? "ready" : "loading";
  useLayoutEffect(() => { onStatus(card.id, status); }, [card.id, status, onStatus]);
  useLayoutEffect(() => () => onStatus(card.id, "loading"), [card.id, onStatus]);
  const loaded = useCallback((url: string, ok: boolean) => {
    setImages(previous => previous[url] === ok ? previous : { ...previous, [url]: ok });
  }, []);
  return <EventCardSvg layout={layout} card={card} context={context} onImageStatus={loaded} />;
}
