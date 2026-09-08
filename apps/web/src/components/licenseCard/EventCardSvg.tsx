import { useId, useMemo, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { BADGE_DEFS, CARD_DESIGN_HEIGHT, CARD_DESIGN_WIDTH, type CardLayout, type CardPart, type EventNameCard } from "@eventer/shared";
import { FONT_SANS } from "./cardTheme.js";
import { textUnits } from "./cardText.js";
import { fitCardText } from "./eventCardText.js";
import { roleLabel } from "../../lib/format.js";

export interface EventCardContext {
  eventId: string;
  title: string;
  eventUrl: string;
  origin: string;
  communityName: string;
  communityLogo: string | null;
}
export function cardAssetUrl(eventId: string, assetId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/name-card-assets/${encodeURIComponent(assetId)}`;
}
export function partImageUrl(part: Extract<CardPart, { kind: "image" }>, card: EventNameCard, context: EventCardContext): string | null {
  return part.source === "avatar" ? card.avatarUrl : part.source === "community" ? context.communityLogo
    : part.assetId ? cardAssetUrl(context.eventId, part.assetId) : null;
}
export function cardImageUrls(layout: CardLayout, card: EventNameCard, context: EventCardContext): string[] {
  const result = new Set<string>();
  if (layout.background.assetId) result.add(cardAssetUrl(context.eventId, layout.background.assetId));
  for (const part of layout.parts) if (part.kind === "image") {
    const url = partImageUrl(part, card, context); if (url) result.add(url);
  }
  return [...result];
}
function qrPath(url: string) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
    if (data[y * size + x]) path += `M${x + 4} ${y + 4}h1v1h-1z`;
  return { path, size: size + 8 };
}
function CardQr({ url, part }: { url: string; part: CardPart }) {
  const qr = useMemo(() => qrPath(url), [url]);
  return <svg x={part.x} y={part.y} width={part.width} height={part.height} viewBox={`0 0 ${qr.size} ${qr.size}`}>
    <rect width={qr.size} height={qr.size} fill="#fff" />
    <path d={qr.path} fill="#000" shapeRendering="crispEdges" />
  </svg>;
}
function FitText({ text, part }: { text: string; part: Extract<CardPart, { kind: "text" }> }) {
  const { lines, size } = fitCardText(text, part.width, part.height, part.fontSize);
  return <g data-small-text={text && size < 18 ? "true" : undefined} fontFamily={FONT_SANS} fontSize={size} fontWeight={part.bold ? 700 : 400} fill={part.color}>
    {lines.map((line, i) => <text key={i}
      x={part.x + (part.align === "middle" ? part.width / 2 : part.align === "end" ? part.width : 0)}
      y={part.y + size + i * size * 1.25} textAnchor={part.align}
      textLength={line ? Math.min(part.width, textUnits(line) * size) : undefined}
      lengthAdjust="spacingAndGlyphs">{line}</text>)}
  </g>;
}

/** Event-only drawing. The legacy personal card remains independent. */
export function EventCardSvg({ layout, card, context, svgRef, children, imageData, onImageStatus }: {
  layout: CardLayout;
  card: EventNameCard;
  context: EventCardContext;
  svgRef?: Ref<SVGSVGElement>;
  children?: ReactNode;
  /** Optional preloaded/embedded images used by print/export. */
  imageData?: Readonly<Record<string, string>>;
  onImageStatus?: (url: string, ok: boolean) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const { t, i18n } = useTranslation();
  const background = layout.background;
  const picture = (url: string, props: { x: number; y: number; width: number; height: number; preserveAspectRatio: string; opacity?: number }) =>
    <image {...props} href={imageData?.[url] ?? url} onLoad={() => onImageStatus?.(url, true)} onError={() => onImageStatus?.(url, false)} />;
  const sourceText = (p: Extract<CardPart, { kind: "text" }>) => ({
    literal: p.text, name: card.name, handle: `@${card.handle}`, event: context.title,
    community: context.communityName, role: roleLabel(card.role), slot: card.slotName ?? "",
  })[p.source];
  const render = (p: CardPart): ReactNode => {
    if (p.kind === "rect") return <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={p.radius} fill={p.color} />;
    if (p.kind === "text") return <FitText text={sourceText(p)} part={p} />;
    if (p.kind === "image") {
      const url = partImageUrl(p, card, context);
      return url ? picture(url, { x: p.x, y: p.y, width: p.width, height: p.height,
        preserveAspectRatio: `xMidYMid ${p.fit === "cover" ? "slice" : "meet"}` })
        : p.source === "community" ? null : <g>
          <rect x={p.x} y={p.y} width={p.width} height={p.height} fill="#E2E8F0" />
          {p.source === "avatar" && <FitText text={[...card.name][0] ?? "?"} part={{ ...p,
            kind: "text", source: "literal", text: "", color: "#475569", bold: true, align: "middle",
            y: p.y + p.height * 0.15, height: p.height * 0.7, fontSize: Math.min(p.width, p.height) * 0.55 }} />}
        </g>;
    }
    if (p.kind === "qr") return <CardQr part={p} url={p.source === "event" ? context.eventUrl : `${context.origin}/users/${encodeURIComponent(card.handle)}?ref=card`} />;
    const badgeNames = card.gamification.badges.map(b => {
      const def = BADGE_DEFS.find(d => d.key === b.key);
      return def ? (i18n.language.startsWith("ja") ? def.name : def.nameEn) : "";
    }).filter(Boolean).slice(0, 3).join(" / ");
    return <FitText text={[
      t("staffOps.cardEditorStatsLine", { level: card.gamification.level, xp: card.gamification.xp }),
      t("staffOps.cardEditorActivityLine", card.participation), badgeNames,
    ].filter(Boolean).join("\n")} part={{ ...p, kind: "text", source: "literal", text: "", bold: false, align: "start" }} />;
  };
  return <svg ref={svgRef} viewBox={`0 0 ${CARD_DESIGN_WIDTH} ${CARD_DESIGN_HEIGHT}`} width={CARD_DESIGN_WIDTH} height={CARD_DESIGN_HEIGHT}
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label={t("profile.cardAriaLabel", { name: card.name })}
    style={{ display: "block", width: "100%", height: "auto" }}>
    <defs>
      <clipPath id={`${uid}-card`}><rect width={CARD_DESIGN_WIDTH} height={CARD_DESIGN_HEIGHT} /></clipPath>
      {layout.parts.map(p => <clipPath key={p.id} id={`${uid}-${p.id}`}><rect x={p.x} y={p.y} width={p.width} height={p.height} /></clipPath>)}
    </defs>
    <g clipPath={`url(#${uid}-card)`}>
      <rect width={CARD_DESIGN_WIDTH} height={CARD_DESIGN_HEIGHT} fill={background.color} />
      {background.assetId && picture(cardAssetUrl(context.eventId, background.assetId), {
        x: 0, y: 0, width: CARD_DESIGN_WIDTH, height: CARD_DESIGN_HEIGHT, opacity: background.opacity,
        preserveAspectRatio: `${background.positionX < 0.33 ? "xMin" : background.positionX > 0.67 ? "xMax" : "xMid"}${background.positionY < 0.33 ? "YMin" : background.positionY > 0.67 ? "YMax" : "YMid"} ${background.fit === "cover" ? "slice" : "meet"}`,
      })}
      {layout.parts.map(p => <g key={p.id} data-card-part={p.id} opacity={p.opacity} clipPath={`url(#${uid}-${p.id})`}>{render(p)}</g>)}
    </g>
    {children}
  </svg>;
}
