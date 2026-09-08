import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Alert, Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { CardLayout, CardPart, EventNameCard } from "@eventer/shared";
import { cardImageUrls, EventCardSvg, type EventCardContext } from "../licenseCard/EventCardSvg.js";
import { movePart } from "./model.js";

export function CardCanvas({ layout, card, context, selected, onSelect, onChange }: {
  layout: CardLayout; card: EventNameCard; context: EventCardContext; selected: string | null;
  onSelect: (id: string) => void; onChange: (part: CardPart) => void;
}) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const [smallText, setSmallText] = useState(false);
  const [images, setImages] = useState<Record<string, boolean>>({});
  const imageStatus = useCallback((url: string, ok: boolean) => setImages(old => old[url] === ok ? old : { ...old, [url]: ok }), []);
  const drag = useRef<{ part: CardPart; x: number; y: number; resize: boolean; current: CardPart } | null>(null);
  const [preview, setPreview] = useState<CardPart | null>(null);
  const point = (e: PointerEvent) => {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()) : null;
  };
  const start = (e: PointerEvent<SVGRectElement>, part: CardPart, resize: boolean) => {
    if (e.button !== 0) return;
    const p = point(e); if (!p) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    onSelect(part.id); drag.current = { part, x: p.x, y: p.y, resize, current: part };
  };
  const move = (e: PointerEvent<SVGRectElement>) => {
    const d = drag.current, p = point(e); if (!d || !p) return;
    d.current = movePart(d.part, Math.round(p.x - d.x), Math.round(p.y - d.y), d.resize);
    setPreview(d.current);
  };
  const finish = () => {
    if (drag.current) onChange(drag.current.current);
    drag.current = null; setPreview(null);
  };
  const cancel = () => { drag.current = null; setPreview(null); };
  const shown = preview ? { ...layout, parts: layout.parts.map(p => p.id === preview.id ? preview : p) } : layout;
  const active = shown.parts.find(p => p.id === selected);
  useLayoutEffect(() => { setSmallText(Boolean(svg.current?.querySelector('[data-small-text="true"]'))); }, [shown, card]);
  const imageError = cardImageUrls(shown, card, context).some(url => images[url] === false);
  const events = { onPointerMove: move, onPointerUp: finish, onPointerCancel: cancel, onLostPointerCapture: cancel };
  return <Box>
    <Box sx={{ border: "1px solid", borderColor: "divider", background: "#fff", userSelect: "none" }}>
    <EventCardSvg svgRef={svg} layout={shown} card={card} context={context} onImageStatus={imageStatus}>
      <path d="M537 0V650M0 325H1074" stroke="#64748B" strokeDasharray="8 8" strokeOpacity={0.25} pointerEvents="none" />
      {shown.parts.map(p => <rect key={p.id} x={p.x} y={p.y} width={p.width} height={p.height}
        fill="transparent" stroke={p.id === selected ? "#2563EB" : "none"} strokeWidth={3}
        style={{ cursor: "move", touchAction: "none" }} onPointerDown={e => start(e, p, false)} {...events} />)}
      {active && <rect x={active.x + active.width - 48} y={active.y + active.height - 48} width={48} height={48}
        fill="#2563EB" fillOpacity={0.65} style={{ cursor: "nwse-resize", touchAction: "none" }}
        onPointerDown={e => start(e, active, true)} {...events} />}
    </EventCardSvg>
    </Box>
    <Typography variant="caption" color="text.secondary">{t("staffOps.cardEditorEditPreview")}</Typography>
    {smallText && <Alert severity="warning">{t("staffOps.cardEditorSmallText")}</Alert>}
    {imageError && <Alert severity="error">{t("staffOps.cardEditorImageFailed")}</Alert>}
  </Box>;
}
