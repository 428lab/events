import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { resolveCardLayout, type CardDesign, type EventNameCard } from "@eventer/shared";
import { cardAvatarUrl, cardImageUrls, EventCardSvg, type EventCardContext } from "../licenseCard/EventCardSvg.js";
export type CardPrintStatus = "loading" | "ready" | "error";
export function PrintableEventCard({ design, card: member, context, onStatus, onAvatarFailed }: {
  design: CardDesign; card: EventNameCard; context: EventCardContext;
  onStatus: (id: string, status: CardPrintStatus) => void;
  /** The member's icon could not load, so the card prints the initial instead (2026-11-25: one dead external icon
   * must not block the whole sheet). Organizer assets and fonts still block. */
  onAvatarFailed?: (id: string, failed: boolean) => void;
}) {
  const layout = useMemo(() => resolveCardLayout(design, member.role, member.slotId ?? null), [design, member.role, member.slotId]);
  const avatar = cardAvatarUrl(layout, member);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatarFailed = avatar !== null && failedAvatar === avatar;
  // Without the icon URL, EventCardSvg draws the grey box with the initial, and the URL drops out of the wait list
  const card = useMemo(() => avatarFailed ? { ...member, avatarUrl: null } : member, [avatarFailed, member]);
  useLayoutEffect(() => { onAvatarFailed?.(member.id, avatarFailed); }, [member.id, avatarFailed, onAvatarFailed]);
  useLayoutEffect(() => () => onAvatarFailed?.(member.id, false), [member.id, onAvatarFailed]);
  const urls = cardImageUrls(layout, card, context);
  const [images, setImages] = useState<Record<string, boolean>>({});
  const [fonts, setFonts] = useState(false);
  const [textStatus, setTextStatus] = useState<Record<string, CardPrintStatus>>({});
  const textIds = layout.parts.filter(p => p.kind === "text").map(p => p.id);
  const textLoaded = useCallback((id: string, status: CardPrintStatus) => {
    setTextStatus(previous => previous[id] === status ? previous : { ...previous, [id]: status });
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(document.fonts?.ready).then(() => { if (!cancelled) setFonts(true); });
    return () => { cancelled = true; };
  }, []);
  const status = urls.some(url => images[url] === false) || textIds.some(id => textStatus[id] === "error") ? "error"
    : fonts && urls.every(url => images[url] === true) && textIds.every(id => textStatus[id] === "ready") ? "ready" : "loading";
  useLayoutEffect(() => { onStatus(member.id, status); }, [member.id, status, onStatus]);
  useLayoutEffect(() => () => onStatus(member.id, "loading"), [member.id, onStatus]);
  const loaded = useCallback((url: string, ok: boolean) => {
    if (!ok && url === avatar) { setFailedAvatar(url); return; }
    setImages(previous => previous[url] === ok ? previous : { ...previous, [url]: ok });
  }, [avatar]);
  return <EventCardSvg layout={layout} card={card} context={context} onImageStatus={loaded} onFontStatus={textLoaded} />;
}
