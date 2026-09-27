import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DECK_H, DECK_W } from "@eventer/shared";
import type { DeckElement, DeckSlide } from "@eventer/shared";

type ImageStatus = "loaded" | "error";
type ImageStatusChange = (elementId: string, src: string, status: ImageStatus) => void;

function UrlImage({ el, onImageStatus }: { el: DeckElement & { type: "image"; src: string }; onImageStatus?: ImageStatusChange }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"loading" | ImageStatus>("loading");
  const update = (next: ImageStatus) => { setStatus(next); onImageStatus?.(el.id, el.src, next); };
  return <div style={{ width: "100%", height: "100%", position: "relative" }}>
    <img src={el.src} alt="" draggable={false} onLoad={() => update("loaded")} onError={() => update("error")}
      style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", userSelect: "none", visibility: status === "loaded" ? "visible" : "hidden" }} />
    {status !== "loaded" && <div role="status" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 12, textAlign: "center", background: "#e5e7eb", color: "#374151", fontSize: 18 }}>
      {t(status === "error" ? "deckImport.imageFailed" : "deckImport.imageLoading")}
    </div>}
  </div>;
}

/** 要素の中身（テキスト/画像）。位置・サイズは親が持つ */
export function ElementContent({ el, onImageStatus }: { el: DeckElement; onImageStatus?: ImageStatusChange }) {
  const { t } = useTranslation();
  if (el.type === "image") {
    return el.src ? (
      <UrlImage key={el.src} el={el as DeckElement & { type: "image"; src: string }} onImageStatus={onImageStatus} />
    ) : (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: "#e5e7eb",
          color: "#6b7280",
          fontSize: 18,
        }}
      >
        {t("studio.imageUrlUnset")}
      </div>
    );
  }
  const justify =
    el.align === "center"
      ? "center"
      : el.align === "right"
        ? "flex-end"
        : "flex-start";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: justify,
        textAlign: el.align ?? "left",
        color: el.color ?? "#0f172a",
        fontFamily: el.fontFamily || undefined,
        fontSize: el.fontSize ?? 28,
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? "italic" : "normal",
        lineHeight: 1.3,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "hidden",
      }}
    >
      {el.text ?? ""}
    </div>
  );
}

/** スライドを指定幅で読み取り専用描画（ビューア・サムネ用） */
export function SlideStage({
  slide,
  width,
  onImageStatus,
}: {
  slide: DeckSlide;
  width: number;
  onImageStatus?: ImageStatusChange;
}) {
  const scale = width / DECK_W;
  return (
    <div
      style={{
        width,
        height: DECK_H * scale,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: DECK_W,
          height: DECK_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          background: slide.background ?? "#ffffff",
        }}
      >
        {slide.elements.map((el) => (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left: el.x,
              top: el.y,
              width: el.w,
              height: el.h,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
            }}
          >
            <ElementContent el={el} onImageStatus={onImageStatus} />
          </div>
        ))}
      </div>
    </div>
  );
}
